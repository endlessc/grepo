/* 核对 index.html 与 app.js 之间的 id 依赖关系。
 *
 * 只看 `$("x")` 和 `getElementById("x")` 是不够的 —— app.js 还会把 id 当字符串
 * 参数传给工厂函数（例如 initCustomSelect("langSelect", "lang")），
 * 那种写法会被漏掉，从而误报「HTML 里有但 JS 没用」。
 * 所以这里把「任意出现在 app.js 里的带引号 id」都算作已引用（保守，宁多勿漏）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.join(HERE, "..", "extension", "pages", "dashboard");
const js = fs.readFileSync(path.join(DASH, "app.js"), "utf8");
const html = fs.readFileSync(path.join(DASH, "index.html"), "utf8");

const htmlIds = new Set([...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));

/* 直接取用的 id —— 这两个是真正会在运行时解引用、拿不到就报错的 */
const direct = new Set();
for (const m of js.matchAll(/\$\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g)) direct.add(m[1]);
for (const m of js.matchAll(/getElementById\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g)) direct.add(m[1]);

/* 作为参数传递的 id —— 同上，但不会直接抛错 */
const viaArg = new Set();
for (const m of js.matchAll(/["']([A-Za-z0-9_-]+)["']/g)) {
  const v = m[1];
  if (htmlIds.has(v) && !direct.has(v)) viaArg.add(v);
}

const missing = [...direct].filter((id) => !htmlIds.has(id)).sort();
const referenced = new Set([...direct, ...viaArg]);
const htmlOnly = [...htmlIds].filter((id) => !referenced.has(id)).sort();

console.log("=== id 依赖核对 ===");
console.log(`HTML 定义 ${htmlIds.size} 个 id`);
console.log(`app.js 直接取用 ${direct.size} 个：${[...direct].sort().join(", ")}`);
console.log(`app.js 作为参数传入 ${viaArg.size} 个：${[...viaArg].sort().join(", ") || "无"}`);
console.log("");
console.log(`运行时会解引用但 HTML 缺失：${missing.length ? "⚠ " + missing.join(", ") : "无"}`);
console.log(`HTML 有、app.js 完全没提到：${htmlOnly.length ? htmlOnly.join(", ") : "无"}`);

process.exit(missing.length ? 1 : 0);
