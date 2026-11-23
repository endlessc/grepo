/* 冒烟：验证回退后的扩展（/test/live）在 4000 条数据下能正常同步、渲染、检索、筛选。
 * 只做关键几项，作为回退是否成功的判据。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";
import { launchChrome, newProfile } from "./cdp.mjs";
import { HARNESS } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(HERE, "repos.json"), "utf8"));
const total = data.stars.length + data.own.length;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
function check(name, got, want) {
  if (String(got) === String(want)) {
    pass++;
    console.log(`  ✓ ${name}：${got}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}：得到 ${got}，期望 ${want}`);
  }
}

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const profile = newProfile("live");
const { proc, cdp } = await launchChrome(profile);

cdp.on("Runtime.exceptionThrown", (p) => {
  console.log("  [页面异常]", p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
});
cdp.on("Runtime.consoleAPICalled", (p) => {
  if (p.type === "error") {
    console.log("  [页面错误]", (p.args || []).map((a) => a.value ?? a.description).join(" "));
  }
});

await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
await cdp.send("Page.navigate", { url: `${base}/test/live` });

console.log("\n【首次同步并渲染】");
let ok = false;
for (let i = 0; i < 900; i++) {
  if ((await cdp.eval("window.__h.rows()")) > 0) {
    ok = true;
    break;
  }
  await sleep(200);
}
check("首屏渲染出列表", ok, true);
await sleep(1000);

check("仓库总数", await cdp.eval("window.__h.hits()"), total);
check("每页条数", await cdp.eval("window.__h.rows()"), 80);

console.log("\n【检索】");
for (const term of ["llama", "pdf", "转换"]) {
  await cdp.eval(`window.__h.search(${JSON.stringify(term)})`, true);
  await sleep(250);
  const hits = await cdp.eval("window.__h.hits()");
  check(`「${term}」有结果`, hits > 0, true);
}
await cdp.eval("window.__h.clearSearch()");
await sleep(600);

console.log("\n【筛选与排序】");
await cdp.eval("window.__h.clickTab('fork')");
await sleep(800);
const forkHits = await cdp.eval("window.__h.hits()");
check("fork 分栏有结果", forkHits > 0 && forkHits < total, true);
await cdp.eval("window.__h.clickTab('')");
await sleep(800);

await cdp.eval(`window.__h.setSelect('sort', 'name')`);
await sleep(800);
const first = await cdp.eval("document.querySelector('#list .row .repo').textContent");
check("按名称排序首行非空", first.length > 0, true);

console.log("\n【翻页】");
const before = await cdp.eval("window.__h.rows()");
const more = await cdp.eval("window.__h.scrollMore()", true);
check("滚动加载更多", more.rows > before, true);

console.log("\n【本地持久化】");
const stored = JSON.parse(await cdp.eval(`(async () => {
  const keys = window.__mock ? await window.__mock.shardKeys() : [];
  const g = await chrome.storage.local.get(keys.concat(['grepo.syncedAt', 'grepo.repos']));
  let n = 0;
  for (const k of keys) if (Array.isArray(g[k])) n += g[k].length;
  return JSON.stringify({
    shards: keys.length,
    n,
    legacy: g['grepo.repos'] === undefined ? 'none' : 'exists',
    at: g['grepo.syncedAt'] || 0,
  });
})()`, true));
check("仓库写入分片", stored.n, total);
check("拆成 32 个分片", stored.shards, 32);
check("没有遗留整块 key", stored.legacy, "none");
check("记录了同步时间", stored.at > 0, true);

await cdp.send("Page.reload");
await sleep(1200);
for (let i = 0; i < 300; i++) {
  if ((await cdp.eval("window.__h.rows()")) > 0) break;
  await sleep(150);
}
check("刷新后直接出结果（不必重新同步）", (await cdp.eval("window.__h.rows()")) > 0, true);

cdp.close();
proc.kill();
server.close();

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
