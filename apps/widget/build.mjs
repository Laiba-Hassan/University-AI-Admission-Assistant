// Builds the widget into dist/: loader.js (vanilla, runs in the host page) and widget.js (the Preact iframe app),
// plus copies widget.html and styles.css alongside them. `--serve` also starts a static dev server.
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, "dist");
mkdirSync(outdir, { recursive: true });

const watch = process.argv.includes("--watch");
const serve = process.argv.includes("--serve");
const production = process.env.NODE_ENV === "production";

const common = { bundle: true, minify: production, sourcemap: !production, target: "es2020", jsx: "automatic", jsxImportSource: "preact" };
const entries = [
  { entryPoints: [join(root, "src/loader.ts")], outfile: join(outdir, "loader.js"), format: "iife" },
  { entryPoints: [join(root, "src/widget.tsx")], outfile: join(outdir, "widget.js"), format: "esm" },
];

function copyStatics() {
  copyFileSync(join(root, "widget.html"), join(outdir, "widget.html"));
  copyFileSync(join(root, "src/styles.css"), join(outdir, "styles.css"));
}

if (watch) {
  const ctxs = await Promise.all(entries.map((e) => context({ ...common, ...e })));
  await Promise.all(ctxs.map((c) => c.watch()));
  copyStatics();
  console.log("watching…");
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
  copyStatics();
  console.log(`built to ${outdir}${production ? " (production)" : ""}`);
}

if (serve) {
  const port = Number(process.env.PORT ?? 5174);
  const types = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html" };
  http.createServer((req, res) => {
    const path = join(outdir, (req.url === "/" ? "/widget.html" : req.url).split("?")[0]);
    if (!existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); res.end("not found"); return; }
    res.setHeader("content-type", types[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream");
    // Local dev only: any origin may load the widget files themselves (not the API, which enforces its own
    // origin allowlist separately) so any demo-site port can embed them without a CORS error.
    res.setHeader("access-control-allow-origin", "*");
    createReadStream(path).pipe(res);
  }).listen(port, () => console.log(`serving ${outdir} on http://localhost:${port}`));
}
