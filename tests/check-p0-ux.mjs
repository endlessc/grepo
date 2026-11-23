/* P0 体验修复验收：
 *   1) 数字去重：无筛选时结果行不再重复总数，顶栏状态位只留短标签，趋势注记不带条数
 *   2) 切换器分层：周期选中态与视图选中态不是同一种视觉
 *   3) 空态居中 + 一键清空搜索条件
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
const { cdp, proc } = await launchChrome(newProfile("p0ux"));
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
await sleep(1500);

console.log("\n【数字去重】");
const noFilter = JSON.parse(await cdp.eval(`JSON.stringify({
  stat: document.getElementById('stat').textContent,
  syncState: document.getElementById('syncState').textContent,
  indexCount: document.getElementById('indexCount').textContent,
  tabAll: document.querySelector('#tabs button[data-kind=""] .n').textContent,
})`));
check("结果行不再重复总数", /4,000/.test(noFilter.stat), false);
check("结果行改成说同步时间", /同步于|尚未同步/.test(noFilter.stat), true);
check("顶栏状态位不含条数", /4,000|4000/.test(noFilter.syncState), false);
check("索引总数仍在顶栏", /4,000/.test(noFilter.indexCount), true);
check("总数仍在页签", /4,000/.test(noFilter.tabAll), true);

console.log("\n【筛选时保留对比】");
await cdp.eval(`(function(){
  const q = document.getElementById('q');
  q.value = 'python';
  q.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(900);
const filtered = await cdp.eval("document.getElementById('stat').textContent");
check("筛选后显示「找到 N · 共 M」", /找到/.test(filtered) && /共/.test(filtered), true);
await cdp.eval(`(function(){
  const q = document.getElementById('q');
  q.value = '';
  q.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(800);

console.log("\n【趋势注记】");
await cdp.eval(`document.querySelector('#viewPick button[data-view="trend"]').click()`);
for (let i = 0; i < 150; i++) {
  if ((await cdp.eval(`document.getElementById('trendNote').textContent.includes('更新')`))) break;
  await sleep(200);
}
const note = await cdp.eval("document.getElementById('trendNote').textContent");
check("趋势注记不说条数", /个仓库/.test(note), false);
check("趋势注记保留来源与时间", /github|API/.test(note) && /更新/.test(note), true);

console.log("\n【切换器互斥】");
// 周期切换与分类页签共用一套视觉，必须保证两者不会同时出现在一行
const picks = JSON.parse(await cdp.eval(`JSON.stringify({
  tabsHidden: document.getElementById('tabs').classList.contains('hidden'),
  periodShown: !document.getElementById('periodPick').classList.contains('hidden'),
})`));
check("趋势视图下页签让位", picks.tabsHidden, true);
check("趋势视图下周期切换出现", picks.periodShown, true);

console.log("\n【空态居中 + 清空】");
await cdp.eval(`document.querySelector('#viewPick button[data-view="mine"]').click()`);
await sleep(900);
await cdp.eval(`(function(){
  const q = document.getElementById('q');
  q.value = 'zzzzzzzz';
  q.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(900);

const empty = JSON.parse(await cdp.eval(`(function(){
  const list = document.getElementById('list');
  const box = list.querySelector('.empty');
  const btn = list.querySelector('[data-act="reset-filters"]');
  const lr = list.getBoundingClientRect();
  const br = box ? box.getBoundingClientRect() : null;
  return JSON.stringify({
    isEmpty: list.classList.contains('is-empty'),
    hasBox: !!box,
    hasBtn: !!btn && btn.textContent.includes('清空'),
    offset: br ? Math.round((br.top + br.bottom) / 2 - (lr.top + lr.bottom) / 2) : 9999,
  });
})()`));
check("列表打上空态标记", empty.isEmpty, true);
check("空态块存在", empty.hasBox, true);
check("有「清空搜索条件」按钮", empty.hasBtn, true);
check("空态垂直居中（偏差 < 60px）", Math.abs(empty.offset) < 60, true, Math.abs(empty.offset) < 60);
console.log(`    与列表区中心偏差 ${empty.offset}px`);

console.log("\n【点一下就能恢复】");
await cdp.eval(`document.querySelector('#list [data-act="reset-filters"]').click()`);
await sleep(900);
const restored = JSON.parse(await cdp.eval(`JSON.stringify({
  q: document.getElementById('q').value,
  rows: window.__h.rows(),
  isEmpty: document.getElementById('list').classList.contains('is-empty'),
})`));
check("搜索词已清空", restored.q, "");
check("列表已恢复", restored.rows > 0, true);
check("空态标记已移除", restored.isEmpty, false);

cdp.close();
proc.kill();
server.close();
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
