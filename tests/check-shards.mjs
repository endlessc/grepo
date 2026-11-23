/* 分片存储验收：
 *   1) 首次同步后数据落在 32 个分片里，旧的整块 key 不存在
 *   2) 增量同步只写命中的分片（写入字节数远小于整份数据）
 *   3) 改一个标签只写 1 个分片
 *   4) 全量同步写满 32 个分片
 *   5) 旧版整块 blob 能自动迁移成分片
 */
import { startServer } from "./server.mjs";
import { launchChrome, newProfile } from "./cdp.mjs";
import { HARNESS } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, got, want, ok) {
  const good = ok === undefined ? String(got) === String(want) : ok;
  if (good) { pass++; console.log(`  ✓ ${name}：${got}`); }
  else { fail++; console.log(`  ✗ ${name}：得到 ${got}，期望 ${want}`); }
}

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const { cdp, proc } = await launchChrome(newProfile("shard"));

cdp.on("Runtime.exceptionThrown", (p) =>
  console.log("  [异常]", p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)
);

await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});
await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
await cdp.send("Page.navigate", { url: `${base}/test/live` });
for (let i = 0; i < 1200; i++) {
  if ((await cdp.eval("window.__h.rows()")) > 0) break;
  await sleep(200);
}
await sleep(1800);

console.log("\n【首次同步后的存储形态】");
const shape = JSON.parse(await cdp.eval(`(async () => {
  const keys = await window.__mock.shardKeys();
  const g = await chrome.storage.local.get(['grepo.repos']);
  return JSON.stringify({ shards: keys.length, legacy: g['grepo.repos'] === undefined ? 'none' : 'exists' });
})()`, true));
check("数据被拆进 32 个分片", shape.shards, 32);
check("旧的整块 key 已不存在", shape.legacy, "none");

console.log("\n【增量同步的写入量】");
await cdp.eval("window.__mock.reset()");
await cdp.eval("window.__mock.addStars(2)");
await sleep(200);
await cdp.eval(`document.getElementById('syncBtn').click()`);
await sleep(4500);
const incr = JSON.parse(await cdp.eval(`JSON.stringify({
  total: window.__h.hits(),
  stats: window.__mock.stats,
})`));
check("总数 +2", incr.total, 4002);
check("只写了 ≤3 个 key（命中的分片 + 时间戳）", incr.stats.setKeys <= 3, true);
check("写入字节 < 300KB（整份约 2MB+）", incr.stats.setBytes < 300 * 1024, true);
console.log(`    实际写了 ${incr.stats.setKeys} 个 key、${(incr.stats.setBytes / 1024).toFixed(1)} KB`);

console.log("\n【改标签只写 1 个分片】");
await cdp.eval(`document.querySelector('#list .row').click()`);
await sleep(400);
await cdp.eval(`document.getElementById('repoClose').click()`); // 单击行会开详情，先关掉
await sleep(250);
await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))`);
await sleep(400);
await cdp.eval(`(function(){ document.getElementById('tagInput').value = '分片测试'; })()`);
await cdp.eval(`window.__mock.reset()`);
await cdp.eval(`document.getElementById('tagSave').click()`);
await sleep(1200);
const tagged = JSON.parse(await cdp.eval(`JSON.stringify(window.__mock.stats)`));
check("只写了 ≤2 个 key（1 分片 + 时间戳）", tagged.setKeys <= 2, true);
check("标签已落地", await cdp.eval(`document.querySelectorAll('#list .row .t.mine').length`), 1);
console.log(`    实际写了 ${tagged.setKeys} 个 key、${(tagged.setBytes / 1024).toFixed(1)} KB`);

console.log("\n【全量同步写满所有分片】");
await cdp.eval("window.__mock.reset()");
await cdp.eval(`document.getElementById('syncBtn').dispatchEvent(
  new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
await sleep(6500);
const fullStats = JSON.parse(await cdp.eval(`JSON.stringify(window.__mock.stats)`));
check("写满 32 个分片 + 时间戳", fullStats.setKeys >= 32, true);
check("总数保持不变", await cdp.eval("window.__h.hits()"), 4002);

console.log("\n【旧版整块 blob 自动迁移】");
// 把当前分片拼回一个整块 blob，删掉分片，然后刷新
await cdp.eval(`(async () => {
  const keys = await window.__mock.shardKeys();
  const g = await chrome.storage.local.get(keys);
  const all = [];
  for (const k of keys) if (Array.isArray(g[k])) all.push(...g[k]);
  await chrome.storage.local.set({ 'grepo.repos': all });
  await chrome.storage.local.remove(keys);
})()`, true);
await sleep(400);
const before = JSON.parse(await cdp.eval(`(async () => {
  const keys = await window.__mock.shardKeys();
  const g = await chrome.storage.local.get(['grepo.repos']);
  return JSON.stringify({ shards: keys.length, legacyLen: (g['grepo.repos'] || []).length });
})()`, true));
check("准备：只剩整块 blob", before.shards, 0);
check("准备：blob 里有 4002 条", before.legacyLen, 4002);

await cdp.send("Page.reload");
await sleep(2000);
for (let i = 0; i < 600; i++) {
  if ((await cdp.eval("window.__h.rows()")) > 0) break;
  await sleep(150);
}
await sleep(1200);
const after = JSON.parse(await cdp.eval(`(async () => {
  const keys = await window.__mock.shardKeys();
  const g = await chrome.storage.local.get(['grepo.repos']);
  return JSON.stringify({
    shards: keys.length,
    legacy: g['grepo.repos'] === undefined ? 'none' : 'exists',
    total: window.__h.hits(),
    taggedChip: document.querySelectorAll('#list .row .t.mine').length,
  });
})()`, true));
check("刷新后迁移成 32 个分片", after.shards, 32);
check("旧的整块 key 被删除", after.legacy, "none");
check("数据一条不少", after.total, 4002);

cdp.close();
proc.kill();
server.close();
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
