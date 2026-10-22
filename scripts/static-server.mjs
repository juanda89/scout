// Servidor estático mínimo para previsualizar carpetas (diseño, builds). Uso: node scripts/static-server.mjs <dir> <port>
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
const [dir = ".", port = "8787"] = process.argv.slice(2);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let p = path.join(path.resolve(dir), url);
    if ((await stat(p)).isDirectory()) p = path.join(p, "index.html");
    res.writeHead(200, { "Content-Type": types[path.extname(p)] ?? "application/octet-stream" });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(Number(port), () => console.log(`static ${dir} on http://localhost:${port}`));
