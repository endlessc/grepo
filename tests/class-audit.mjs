/* 列出 index.html 与 app.js 里出现的全部 class，用于确认样式覆盖率 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.join(HERE, "..", "extension", "pages", "dashboard");
const html = fs.readFileSync(path.join(DASH, "index.html"), "utf8");
const js = fs.readFileSync(path.join(DASH, "app.js"), "utf8");
const css = fs.readFileSync(path.join(DASH, "app.css"), "utf8");

const set = new Set();
for (const m of html.matchAll(/class="([^"]+)"/g)) {
  m[1].split(/\s+/).forEach((c) => c && set.add(c));
}
for (const m of js.matchAll(/class="([^"]+)"/g)) {
  m[1].split(/\s+/).forEach((c) => c && set.add(c));
}
for (const m of js.matchAll(/className\s*=\s*["']([^"']+)["']/g)) {
  m[1].split(/\s+/).forEach((c) => c && set.add(c));
}
for (const m of js.matchAll(/classList\.(add|toggle|remove|contains)\(\s*["']([A-Za-z0-9_-]+)["']/g)) {
  set.add(m[2]);
}

const list = [...set].sort();
const cssClasses = new Set([...css.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]));

const styled = list.filter((c) => cssClasses.has(c));
const unstyled = list.filter((c) => !cssClasses.has(c));

console.log(`页面用到的 class：${list.length} 个`);
console.log("");
console.log(`已有样式：${styled.length}`);
console.log("");
console.log(`没有样式：${unstyled.length}${unstyled.length ? " → " + unstyled.join(", ") : ""}`);
