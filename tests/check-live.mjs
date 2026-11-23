/* 真实联调：让扩展在真实 github.com 上跑一遍趋势抓取。
 *
 * 直接从普通标签页导航到 chrome-extension:// 会被拦成错误页，
 * 所以先连上扩展的 service worker，在那里写 token 并 chrome.tabs.create 打开页面。
 */
import { launchChrome, newProfile, CDP } from "./cdp.mjs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* MV3 的 service worker 是惰性的（没有事件就不启动），所以不能靠它找 ID。
 * 未打包扩展的 ID 可直接由绝对路径推出来：sha256(path) 前 32 个 hex 位映射到 a-p。 */
function extIdFromPath(p) {
  const hex = crypto.createHash("sha256").update(p).digest("hex").slice(0, 32);
  return hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "..", "extension");
process.env.EXT_ARGS = "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listTargets = (port) => fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());

const profile = newProfile("live");
const { cdp: tab, proc, port } = await launchChrome(profile, [
  `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`,
]);
const extId = extIdFromPath(EXT);
console.log("扩展 ID:", extId);

const pageUrl = `chrome-extension://${extId}/pages/dashboard/index.html`;
await tab.send("Page.enable");
await tab.send("Runtime.enable");
await tab.send("Page.navigate", { url: pageUrl });
await sleep(2000);

const cdp = tab;
const logs = [];
cdp.on("Runtime.consoleAPICalled", (p) => {
  logs.push(`[${p.type}] ` + (p.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
});
cdp.on("Runtime.exceptionThrown", (p) => {
  logs.push("[exception] " + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
});

/* 首次进入会是配置页，写个假 token 让它进主视图（趋势视图本身不需要 token） */
const boot = JSON.parse(await cdp.eval(`JSON.stringify({
  href: location.href,
  hasStorage: !!(typeof chrome !== 'undefined' && chrome.storage),
  appShown: document.getElementById('app') ? !document.getElementById('app').classList.contains('hidden') : null,
})`));
console.log("进入页面:", JSON.stringify(boot));

if (boot.hasStorage && !boot.appShown) {
  await cdp.eval(`chrome.storage.local.set({ 'grepo.token': 'ghp_fake_for_ui_only' })`, true);
  await cdp.send("Page.reload");
  await sleep(2500);
}

const ctx = JSON.parse(await cdp.eval(`JSON.stringify({
  href: location.href,
  hasStorage: !!(typeof chrome !== 'undefined' && chrome.storage),
  appShown: document.getElementById('app') ? !document.getElementById('app').classList.contains('hidden') : null,
})`));
console.log("页面上下文:", JSON.stringify(ctx));

/* 4) 真实网络探测 */
const net = JSON.parse(await cdp.eval(`(async () => {
  const out = {};
  async function probe(name, url) {
    try {
      const r = await fetch(url, { credentials: 'omit' });
      const t = await r.text();
      out[name] = { ok: r.ok, status: r.status, bytes: t.length };
    } catch (e) {
      out[name] = { error: String((e && e.message) || e) };
    }
  }
  await probe('trending', 'https://github.com/trending?since=daily');
  await probe('api', 'https://api.github.com/rate_limit');
  return JSON.stringify(out);
})()`, true));
console.log("网络探测:", JSON.stringify(net, null, 1));

/* 5) 用真实 HTML 跑一遍解析器 */
if (net.trending && net.trending.ok) {
  const parsed = JSON.parse(await cdp.eval(`(async () => {
    const res = await fetch('https://github.com/trending?since=daily', { credentials: 'omit' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const arts = [...doc.querySelectorAll('article.Box-row')];
    const g = (el) => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
    const f = arts[0];
    return JSON.stringify({
      articles: arts.length,
      firstName: f ? (f.querySelector('h2 a[href]') || { getAttribute: () => null }).getAttribute('href') : null,
      firstStars: f ? g(f.querySelector('a[href$="/stargazers"]')) : null,
      firstGain: f ? g(f.querySelector('span.float-sm-right')) : null,
      firstLang: f ? g(f.querySelector('[itemprop="programmingLanguage"]')) : null,
      firstDesc: f ? (g(f.querySelector('p')) || '').slice(0, 40) : null,
    });
  })()`, true));
  console.log("真实页面解析:", JSON.stringify(parsed, null, 1));
}

/* 6) 点趋势视图 */
await cdp.eval(`document.querySelector('#viewPick button[data-view="trend"]').click()`);
await sleep(4500);

const view = JSON.parse(await cdp.eval(`JSON.stringify({
  rows: document.querySelectorAll('#list .row').length,
  deltas: document.querySelectorAll('#list .row .delta').length,
  note: (document.getElementById('trendNote') || {}).textContent || '',
  toast: (document.getElementById('toast') || {}).textContent || '',
  first: (function(){ const a = document.querySelector('#list .row .repo'); return a ? a.textContent : null; })(),
  firstDelta: (function(){ const a = document.querySelector('#list .row .delta'); return a ? a.textContent : null; })(),
})`));
console.log("趋势视图:", JSON.stringify(view, null, 1));

console.log("\n控制台（最近 15 条）:");
console.log(logs.slice(-15).join("\n") || "（无）");

cdp.close();
proc.kill();
