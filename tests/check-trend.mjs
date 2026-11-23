/* 趋势（实时抓取）验收：
 *   1) 进入趋势视图会抓一次 github.com/trending 并解析出条目
 *   2) 涨幅角标来自页面文案，排行按涨幅降序
 *   3) 切周期（本周/本月）会重新抓
 *   4) 5 分钟缓存生效：短时间内重复进入不重复抓
 *   5) 切回收藏视图数据完好
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
const { cdp, proc } = await launchChrome(newProfile("trend"));

cdp.on("Runtime.exceptionThrown", (p) =>
  console.log("  [异常]", p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)
);
cdp.on("Runtime.consoleAPICalled", (p) => {
  if (p.type === "error") console.log("  [错误]", (p.args || []).map((a) => a.value ?? a.description).join(" "));
});

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

console.log("\n【进入趋势视图】");
await cdp.eval("window.__mock.stats.trendReqs = 0");
await cdp.eval(`document.querySelector('#viewPick button[data-view="trend"]').click()`);
await sleep(2500);

const t1 = JSON.parse(await cdp.eval(`(function(){
  const rows = [...document.querySelectorAll('#list .row')];
  const first = rows[0];
  return JSON.stringify({
    trendReqs: window.__mock.stats.trendReqs || 0,
    rows: rows.length,
    deltas: [...document.querySelectorAll('#list .row .delta')].map(e => Number(e.textContent.replace('+',''))),
    firstName: first ? first.querySelector('.repo').textContent : null,
    firstHref: first ? first.querySelector('a.repo-link').getAttribute('href') : null,
    firstDesc: first ? first.querySelector('.desc').textContent.slice(0, 20) : null,
    firstStars: first ? first.querySelector('.stars').textContent.trim() : null,
    note: (document.getElementById('trendNote') || {}).textContent || '',
    tabsHidden: document.getElementById('tabs').classList.contains('hidden'),
  });
})()`));

check("触发一次抓取", t1.trendReqs, 1);
check("解析出条目", t1.rows > 0, true);
check("每行都有涨幅角标", t1.deltas.length, t1.rows);
check("涨幅按降序排列", t1.deltas.every((v, i) => i === 0 || t1.deltas[i - 1] >= v), true);
check("仓库链接指向 github.com/owner/repo", /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(t1.firstHref || ""), true);
check("仓库名已渲染", (t1.firstName || "").length > 0, true);
check("描述已解析", (t1.firstDesc || "").length > 3, true);
check("星数已解析（含千分位）", /\d/.test(t1.firstStars || ""), true);
check("说明里标注了来源", t1.note.includes("github.com/trending"), true);
check("藏品页签隐藏", t1.tabsHidden, true);
console.log(`    首行：${t1.firstName} · ${t1.firstStars} · +${t1.deltas[0]}`);
console.log(`    说明：${t1.note}`);

console.log("\n【切到本周会重新抓】");
await cdp.eval("window.__mock.stats.trendReqs = 0");
await cdp.eval(`document.querySelector('#periodPick button[data-period="week"]').click()`);
await sleep(2500);
const t2 = JSON.parse(await cdp.eval(`(function(){
  const deltas = [...document.querySelectorAll('#list .row .delta')].map(e => Number(e.textContent.replace('+','')));
  return JSON.stringify({ trendReqs: window.__mock.stats.trendReqs || 0, top: deltas.slice(0,3), n: deltas.length });
})()`));
check("重新抓取一次", t2.trendReqs, 1);
check("本周涨幅数值变大（页面按周口径）", t2.top[0] > t1.deltas[0], true);
console.log(`    本周前三：${t2.top.join(", ")}`);

console.log("\n【本月】");
await cdp.eval("window.__mock.stats.trendReqs = 0");
await cdp.eval(`document.querySelector('#periodPick button[data-period="month"]').click()`);
await sleep(2500);
const t3 = JSON.parse(await cdp.eval(`(function(){
  const deltas = [...document.querySelectorAll('#list .row .delta')].map(e => Number(e.textContent.replace('+','')));
  return JSON.stringify({ trendReqs: window.__mock.stats.trendReqs || 0, top: deltas.slice(0,3) });
})()`));
check("重新抓取一次", t3.trendReqs, 1);
check("本月涨幅再次变大", t3.top[0] > t2.top[0], true);
console.log(`    本月前三：${t3.top.join(", ")}`);

console.log("\n【缓存：短时间内重复进入不重复抓】");
await cdp.eval(`document.querySelector('#viewPick button[data-view="mine"]').click()`);
await sleep(600);
await cdp.eval("window.__mock.stats.trendReqs = 0");
await cdp.eval(`document.querySelector('#viewPick button[data-view="trend"]').click()`);
await sleep(1500);
const t4 = JSON.parse(await cdp.eval(`JSON.stringify({ trendReqs: window.__mock.stats.trendReqs || 0, rows: document.querySelectorAll('#list .row').length })`));
check("命中缓存，没有再抓", t4.trendReqs, 0);
check("列表仍可用", t4.rows > 0, true);

console.log("\n【手动刷新会强制抓】");
await cdp.eval("window.__mock.stats.trendReqs = 0");
await cdp.eval(`document.getElementById('trendRefresh').click()`);
await sleep(2200);
const t5 = JSON.parse(await cdp.eval(`JSON.stringify({ trendReqs: window.__mock.stats.trendReqs || 0 })`));
check("强制刷新抓到新数据", t5.trendReqs, 1);

console.log("\n【抓取失败时退回 API 近似榜】");
await cdp.eval("window.__mock.blockGithub = true");
await cdp.eval("window.__mock.reset()");
await cdp.eval(`document.getElementById('trendRefresh').click()`);
await sleep(3000);
const fb = JSON.parse(await cdp.eval(`(function(){
  return JSON.stringify({
    rows: document.querySelectorAll('#list .row').length,
    deltas: document.querySelectorAll('#list .row .delta').length,
    note: (document.getElementById('trendNote') || {}).textContent || '',
    toast: (document.getElementById('toast') || {}).textContent || '',
    searchReqs: window.__mock.stats.searchReqs || 0,
  });
})()`));
check("兜底后仍有列表", fb.rows > 0, true);
check("兜底数据没有涨幅角标", fb.deltas, 0);
check("确实走了 Search API", fb.searchReqs > 0, true);
check("状态行标明是 API 近似榜", fb.note.includes("API 近似榜"), true);
check("提示里说明了抓取失败", fb.toast.includes("已切到 API 近似榜"), true);
console.log(`    说明：${fb.note}`);
await cdp.eval("window.__mock.blockGithub = false");

console.log("\n【带页签筛选切趋势】");
// 先在收藏视图选「星标」页签，再切趋势：残留的 kind 不能把趋势行全部过滤成空列表
await cdp.eval(`document.querySelector('#viewPick button[data-view="mine"]').click()`);
await sleep(800);
await cdp.eval(`document.querySelector('#tabs button[data-kind="star"]').click()`);
await sleep(800);
check("已切到星标页签",
  await cdp.eval(`document.querySelector('#tabs button[data-kind="star"]').classList.contains('on')`),
  true);

await cdp.eval(`document.querySelector('#viewPick button[data-view="trend"]').click()`);
await sleep(2600);
const withKind = JSON.parse(await cdp.eval(`JSON.stringify({
  rows: window.__h.rows(),
  hint: (document.querySelector('#list .list-hint') || {}).textContent || '',
  empty: !!document.querySelector('#list .empty'),
  periodOn: (document.querySelector('#periodPick button.on') || {}).textContent || '',
})`));
check("趋势列表没有被页签筛空", withKind.rows > 0, true);
check("没有停在「正在抓取」", /正在抓取/.test(withKind.hint), false);
check("没有显示空态", withKind.empty, false);

console.log("\n【切回我的收藏】");
await cdp.eval(`document.querySelector('#viewPick button[data-view="mine"]').click()`);
await sleep(1000);
const mine = JSON.parse(await cdp.eval(`JSON.stringify({
  total: window.__h.hits(),
  tabsShown: !document.getElementById('tabs').classList.contains('hidden'),
  deltas: document.querySelectorAll('#list .row .delta').length,
  rows: document.querySelectorAll('#list .row').length,
})`));
check("收藏总数仍是 4000", mine.total, 4000);
check("藏品页签恢复", mine.tabsShown, true);
check("列表无涨幅角标", mine.deltas, 0);

cdp.close();
proc.kill();
server.close();
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
