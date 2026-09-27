import { config } from "../config.js";

/** Meta's media download is two hops (PRD 6.2: "download the audio with the tenant's token before the link
 * expires"): the webhook gives a media ID, GET /{media-id} resolves it to a short-lived signed URL, then that
 * URL is fetched with the same access token. Both must happen quickly -- the URL is time-limited. */
export async function downloadWhatsAppMedia(mediaId: string, accessToken: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const metaRes = await fetch(`${config.WHATSAPP_GRAPH_BASE_URL}/${mediaId}`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const fileRes = await fetch(meta.url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!fileRes.ok) return null;
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return { buffer, mimeType: meta.mime_type ?? fileRes.headers.get("content-type") ?? "audio/ogg" };
  } catch {
    return null;
  }
}
