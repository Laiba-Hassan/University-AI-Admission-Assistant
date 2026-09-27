import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);

// Gemini accepts these audio mime types inline without conversion (PRD 6.1/6.2: "convert if needed"). WhatsApp
// voice notes are already audio/ogg (Opus) in the common case; only the web mic's browser-native formats
// (WebM/Opus, MP4/AAC) reliably need normalizing.
const GEMINI_NATIVE_MIME_TYPES = new Set(["audio/wav", "audio/mp3", "audio/mpeg", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac"]);
export function needsConversion(mimeType: string): boolean {
  return !GEMINI_NATIVE_MIME_TYPES.has(mimeType.split(";")[0]!.trim().toLowerCase());
}

/** Normalizes any browser/WhatsApp audio format ffmpeg can read into Ogg/Opus, entirely via temp files (ffmpeg's
 * pipe I/O is unreliable for compressed container formats on Windows). Both files are removed in a `finally`,
 * whether conversion succeeds or throws -- the whole point of this pipeline is that audio never lingers on disk. */
export async function convertToOgg(input: Buffer, sourceExtHint = "bin"): Promise<Buffer> {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not resolve a binary for this platform");
  const dir = await mkdtemp(join(tmpdir(), "enrollium-voice-"));
  const inPath = join(dir, `in.${sourceExtHint}`);
  const outPath = join(dir, "out.ogg");
  try {
    await writeFile(inPath, input);
    await run(ffmpegPath, ["-y", "-i", inPath, "-c:a", "libopus", "-b:a", "32k", "-ar", "16000", "-ac", "1", outPath], { timeout: 30_000 });
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** ffmpeg-static bundles ffmpeg, not ffprobe, so duration comes from parsing ffmpeg's own stderr banner
 * ("Duration: 00:01:23.45, ..."), which it prints for any input even when not asked to transcode one. */
export async function probeDurationSeconds(input: Buffer, sourceExtHint = "bin"): Promise<number | null> {
  if (!ffmpegPath) return null;
  const dir = await mkdtemp(join(tmpdir(), "enrollium-voice-probe-"));
  const inPath = join(dir, `in.${sourceExtHint}`);
  try {
    await writeFile(inPath, input);
    // The Duration: line is on stderr regardless of whether ffmpeg exits 0 (most builds, "-f null -" succeeds)
    // or non-zero (some builds/inputs) -- read it from whichever path actually happened.
    let stderr = "";
    try {
      stderr = (await run(ffmpegPath, ["-i", inPath, "-f", "null", "-"], { timeout: 15_000 })).stderr;
    } catch (err) {
      stderr = (err as { stderr?: string }).stderr ?? "";
    }
    const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    if (!match) return null;
    const [, h, m, s] = match;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
