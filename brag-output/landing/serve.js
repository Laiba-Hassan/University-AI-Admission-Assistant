// Minimal static file server for previewing the landing page locally. No dependencies.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = import.meta.dirname;
const PORT = 5500;
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const path = urlPath === "/" ? "/index.html" : urlPath;
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(PORT, () => console.log(`Landing page: http://localhost:${PORT}`));
