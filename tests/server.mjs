/* 自动化测试用静态服务器：将 extension/ 挂载在 /ext 下，
 * /test/live 自动注入 mock.js 与资源前缀用于无头 Chrome 端到端验收。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(HERE, "..", "extension");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "not found");
    send(res, 200, buf, MIME[path.extname(file)] || "application/octet-stream");
  });
}

/* 生成测试页：替换相对路径并注入 mock.js */
function buildPage(dir, appPrefix) {
  const pageDir = path.join(dir, "pages", "dashboard");
  const pagePrefix = `${appPrefix}/pages/dashboard`;
  const html = fs.readFileSync(path.join(pageDir, "index.html"), "utf8");
  return html
    .replace('href="app.css"', `href="${pagePrefix}/app.css"`)
    .replace(/href="\.\.\/\.\.\/assets\//g, `href="${appPrefix}/assets/`)
    .replace(/src="\.\.\/\.\.\/vendor\//g, `src="${appPrefix}/vendor/`)
    .replace(
      /<script([^>]*?)src="app\.js"([^>]*?)><\/script>/,
      `<script src="/mock.js"></script><script$1src="${pagePrefix}/app.js"$2></script>`
    );
}

export function startServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const p = decodeURIComponent(u.pathname);

    if (p === "/test/live") return send(res, 200, buildPage(EXT, "/ext"), MIME[".html"]);
    if (p === "/mock.js") return serveFile(res, path.join(HERE, "mock.js"));
    if (p === "/data/repos.json") return serveFile(res, path.join(HERE, "repos.json"));
    if (p.startsWith("/ext/")) return serveFile(res, path.join(EXT, p.slice(5)));

    send(res, 404, "not found");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}
