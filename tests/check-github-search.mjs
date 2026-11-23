/* 搜索建议面板 + GitHub 全站搜索验收：
 *   1) 输入即弹出面板：本地命中最多 6 条，顶部是「搜索整个 GitHub」入口
 *   2) 点本地条目直接开详情
 *   3) 点入口进入全站搜索：本地专属控件让位，列表换成远程结果
 *   4) 全站模式下再输入，面板顶部变成「只看本地收藏」，点它回到本地
 *   5) 防抖只发一次请求，重复查询走缓存
 *   6) 趋势视图自动复位到本地
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
const { cdp, proc } = await launchChrome(newProfile("ghsearch"));
cdp.on("Runtime.exceptionThrown", (p) =>
  console.log("  [异常]", p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)
);

const setQ = (v) => cdp.eval(`(function(){
  const q = document.getElementById('q');
  q.value = ${JSON.stringify(v)};
  q.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

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

console.log("\n【输入即出面板】");
await setQ("loader");
await sleep(500);
const panel = JSON.parse(await cdp.eval(`(function(){
  const box = document.getElementById('suggest');
  const action = box.querySelector('.suggest-action');
  return JSON.stringify({
    open: !box.classList.contains('hidden'),
    actionText: action ? action.textContent : '',
    items: box.querySelectorAll('.suggest-item').length,
    label: (box.querySelector('.suggest-label') || {}).textContent || '',
  });
})()`));
check("输入后弹出面板", panel.open, true);
check("顶部是「搜索整个 GitHub」", /搜索整个 GitHub/.test(panel.actionText), true);
check("列出了本地命中", panel.items > 0, true);
check("命中数不超过 6 条", panel.items <= 6, true);
check("有「仓库」分组标题", panel.label, "仓库");

console.log("\n【名称命中优先】");
// 第一页应当全是「名字里带 loader」的；描述里提到 loader 的不许混进来
const firstPage = JSON.parse(await cdp.eval(`JSON.stringify(
  [...document.querySelectorAll('#list .row .repo')].map((e) => e.textContent)
)`));
check("首页结果非空", firstPage.length > 0, true);
check("首页全部是名称命中",
  firstPage.every((n) => /loader/i.test(n)), true);
check("首页没有描述命中混入",
  firstPage.some((n) => n === "modern-client"), false);
console.log(`    首页 ${firstPage.length} 条，示例 ${firstPage.slice(0, 3).join(" / ")}`);

// 换成只在描述里出现的词：结果应当全是描述层，且列表开头不插分隔线
await setQ("opinionated");
await sleep(700);
const descOnly = JSON.parse(await cdp.eval(`JSON.stringify({
  rows: window.__h.rows(),
  dividers: document.querySelectorAll('#list .match-divider').length,
  names: [...document.querySelectorAll('#list .row .repo')].map((e) => e.textContent).slice(0, 5),
})`));
check("描述词也能搜到", descOnly.rows > 0, true);
check("描述词结果里没有名称命中",
  descOnly.names.every((n) => !/opinionated/i.test(n)), true);
check("全是描述命中时不插分隔线", descOnly.dividers, 0);
await setQ("loader");
await sleep(700);

console.log("\n【点本地条目直接开详情】");
await cdp.eval(`document.querySelector('#suggest .suggest-item').click()`);
await sleep(800);
const opened = JSON.parse(await cdp.eval(`JSON.stringify({
  dialog: !document.getElementById('repoDialog').classList.contains('hidden'),
  title: document.getElementById('repoTitle').textContent,
  panelClosed: document.getElementById('suggest').classList.contains('hidden'),
})`));
check("详情弹窗打开", opened.dialog, true);
check("弹的是刚才那条", /loader/.test(opened.title), true);
check("面板已收起", opened.panelClosed, true);
await cdp.eval(`document.getElementById('repoClose').click()`);
await sleep(400);

console.log("\n【进入全站搜索】");
await cdp.eval("window.__mock.reset()");
// 远程样本里有 agent-os，本地样本里没有：正好验证「本地无匹配也能去搜全站」
await setQ("agent");
await sleep(400);
await cdp.eval(`document.querySelector('#suggest [data-act="scope-github"]').click()`);
await sleep(1600);
const gh = JSON.parse(await cdp.eval(`JSON.stringify({
  reqs: window.__mock.stats.searchReqs || 0,
  tabsHidden: document.getElementById('tabs').classList.contains('hidden'),
  langHidden: document.getElementById('langSelect').classList.contains('hidden'),
  archivedHidden: document.getElementById('showArchived').closest('.check').classList.contains('hidden'),
  placeholder: document.getElementById('q').placeholder,
  stat: document.getElementById('stat').textContent,
  rows: window.__h.rows(),
  tagBtns: document.querySelectorAll('#list .row-act[data-act="tag"]').length,
})`));
check("发出了搜索请求", gh.reqs, 1);
check("页签让位", gh.tabsHidden, true);
check("语言筛选让位", gh.langHidden, true);
check("归档开关让位", gh.archivedHidden, true);
check("提示改成搜全站", /GitHub/.test(gh.placeholder), true);
check("状态行标注来源", /GitHub/.test(gh.stat), true);
check("渲染出远程结果", gh.rows > 0, true);
check("远程行没有「标签」按钮", gh.tagBtns, 0);
check("进入全站后建议面板收起",
  await cdp.eval(`document.getElementById('suggest').classList.contains('hidden')`), true);
check("状态行给出返回本地入口",
  await cdp.eval(`!document.getElementById('scopeBack').classList.contains('hidden')`), true);

console.log("\n【远程结果可以 star】");
const beforeStar = JSON.parse(await cdp.eval(`JSON.stringify({
  starText: (document.querySelector('#list .row [data-act="star"] span') || {}).textContent || '',
  onClass: !!document.querySelector('#list .row .row-star.on'),
})`));
check("远程行有 Star 按钮", beforeStar.starText, "Star");
check("默认未 star", beforeStar.onClass, false);

// 乐观更新：点下去立刻变，不等网络返回
await cdp.eval(`document.querySelector('#list .row [data-act="star"]').click()`);
await sleep(250);
const optimistic = JSON.parse(await cdp.eval(`JSON.stringify({
  text: (document.querySelector('#list .row [data-act="star"] span') || {}).textContent || '',
  onClass: !!document.querySelector('#list .row .row-star.on'),
  savedBadge: !!document.querySelector('#list .row .kind-saved'),
})`));
check("点击后立即变成「已 Star」", optimistic.text, "已 Star");
check("星标进入选中态", optimistic.onClass, true);
check("立即出现「已收藏」徽章", optimistic.savedBadge, true);

await sleep(1100);
check("后台调用的是 PUT", await cdp.eval("window.__mock.starMethod"), "PUT");

console.log("\n【取消 star 可以撤销】");
await cdp.eval(`document.querySelector('#list .row [data-act="star"]').click()`);
await sleep(1100);
const afterUnstar = JSON.parse(await cdp.eval(`JSON.stringify({
  method: window.__mock.starMethod,
  text: (document.querySelector('#list .row [data-act="star"] span') || {}).textContent || '',
  savedBadge: !!document.querySelector('#list .row .kind-saved'),
  toast: document.getElementById('toast').textContent,
})`));
check("调用的是 DELETE", afterUnstar.method, "DELETE");
check("按钮变回 Star", afterUnstar.text, "Star");
check("「已收藏」徽章消失", afterUnstar.savedBadge, false);
check("toast 提供撤销", /撤销/.test(afterUnstar.toast), true);

await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))`);
await sleep(1100);
const undone = JSON.parse(await cdp.eval(`JSON.stringify({
  text: (document.querySelector('#list .row [data-act="star"] span') || {}).textContent || '',
  savedBadge: !!document.querySelector('#list .row .kind-saved'),
})`));
check("⌘Z 撤销后回到已 Star", undone.text, "已 Star");
check("撤销后徽章回来", undone.savedBadge, true);

console.log("\n【全站模式下的面板】");
await sleep(300);
await setQ("loa");
await sleep(900);
const ghPanel = JSON.parse(await cdp.eval(`(function(){
  const box = document.getElementById('suggest');
  const action = box.querySelector('.suggest-action');
  return JSON.stringify({
    open: !box.classList.contains('hidden'),
    actionText: action ? action.textContent : '',
  });
})()`));
check("全站模式下仍给本地建议", ghPanel.open, true);
check("顶部变成「只看本地收藏」", /只看本地收藏/.test(ghPanel.actionText), true);

await cdp.eval(`document.querySelector('#suggest [data-act="scope-local"]').click()`);
await sleep(700);
const back = JSON.parse(await cdp.eval(`JSON.stringify({
  tabs: !document.getElementById('tabs').classList.contains('hidden'),
  rows: window.__h.rows(),
  tagBtns: document.querySelectorAll('#list .row-act[data-act="tag"]').length,
  statNotGithub: !/GitHub/.test(document.getElementById('stat').textContent),
})`));
check("页签恢复", back.tabs, true);
check("本地列表恢复", back.rows > 0, true);
check("本地行重新有「标签」按钮", back.tagBtns > 0, true);
check("状态行不再标 GitHub", back.statNotGithub, true);

console.log("\n【防抖：连续输入只发一次】");
await setQ("");
await sleep(600);
await cdp.eval("window.__mock.reset()");
await setQ("loader");
await sleep(300);
await cdp.eval(`document.querySelector('#suggest [data-act="scope-github"]').click()`);
await sleep(1200);
await cdp.eval("window.__mock.reset()");
await setQ("mc");
await sleep(120);
await setQ("mcp");
await sleep(120);
await setQ("mcp-");
await sleep(1600);
const debounce = await cdp.eval("window.__mock.stats.searchReqs || 0");
check("三次输入只请求一次", debounce, 1);

console.log("\n【缓存：同一查询不重复请求】");
await cdp.eval("window.__mock.reset()");
await setQ("loader");
await sleep(1600);
const cached = await cdp.eval("window.__mock.stats.searchReqs || 0");
check("回到搜过的词走缓存", cached, 0);

console.log("\n【本地收藏也能取消 star】");
// 先确保回到本地模式（状态行的「返回本地收藏」幂等，本地模式点了也不会出错）
await cdp.eval(`document.getElementById('scopeBack')?.click()`);
await sleep(700);
const localStar = JSON.parse(await cdp.eval(`JSON.stringify({
  hasBtn: !!document.querySelector('#list .row [data-act="star"]'),
  text: (document.querySelector('#list .row [data-act="star"] span') || {}).textContent || '',
  on: !!document.querySelector('#list .row .row-star.on'),
  index: document.getElementById('indexCount').textContent,
  writesBefore: window.__mock.stats.starWrites,
})`));
check("本地行有取消入口", localStar.hasBtn, true);
check("显示为已 star 状态", localStar.on, true);
check("按钮文字是「已 Star」", localStar.text, "已 Star");

await cdp.eval(`document.querySelector('#list .row [data-act="star"]').click()`);
await sleep(300);
const armedLocal = JSON.parse(await cdp.eval(`JSON.stringify({
  writes: window.__mock.stats.starWrites,
  confirm: !!document.querySelector('#list .row .row-star.is-confirm'),
})`));
check("本地取消直接生效（可撤销）", armedLocal.confirm, false);
check("点击后直接发请求", armedLocal.writes - localStar.writesBefore, 1);

await cdp.eval(`document.querySelector('#list .row [data-act="star"]').click()`);
await sleep(1200);
const afterLocal = JSON.parse(await cdp.eval(`JSON.stringify({
  method: window.__mock.starMethod,
  index: document.getElementById('indexCount').textContent,
})`));
check("调用的是 DELETE", afterLocal.method, "DELETE");
check("索引数 -1", afterLocal.index, "3,999 索引");

console.log("\n【趋势视图复位】");
await setQ(""); // 搜索词会连带过滤趋势列表，先清掉
await sleep(700);
await cdp.eval(`document.querySelector('#viewPick button[data-view="trend"]').click()`);
await sleep(2600);
const trend = JSON.parse(await cdp.eval(`JSON.stringify({
  tabsHidden: document.getElementById('tabs').classList.contains('hidden'),
  periodShown: !document.getElementById('periodPick').classList.contains('hidden'),
})`));
check("趋势视图隐藏页签", trend.tabsHidden, true);
check("趋势视图显示周期切换", trend.periodShown, true);

// 趋势行没收藏的应该是 Star 而不是「取消」，且没有标签按钮
const trendRow = JSON.parse(await cdp.eval(`(function(){
  const rows = [...document.querySelectorAll('#list .row')];
  const plain = rows.find((el) => !el.querySelector('.kind-saved'));
  if (!plain) return JSON.stringify({ none: true });
  const btn = plain.querySelector('[data-act="star"]');
  return JSON.stringify({
    text: btn ? btn.querySelector('span').textContent : '',
    on: btn ? btn.classList.contains('on') : false,
    hasTag: !!plain.querySelector('[data-act="tag"]'),
  });
})()`));
check("未收藏的趋势行显示 Star", trendRow.text, "Star");
check("未收藏的趋势行不是选中态", trendRow.on, false);
check("趋势行没有标签按钮", trendRow.hasTag, false);

// 趋势数据只有 full_name 当 id，star 时要补拉一次详情再入库
await cdp.eval(`(function(){
  const rows = [...document.querySelectorAll('#list .row')];
  const plain = rows.find((el) => !el.querySelector('.kind-saved'));
  plain?.querySelector('[data-act="star"]')?.click();
})()`);
await sleep(350);
await cdp.eval(`(function(){
  const rows = [...document.querySelectorAll('#list .row')];
  const plain = rows.find((el) => !el.querySelector('.kind-saved'));
  plain?.querySelector('[data-act="star"]')?.click();
})()`);
await sleep(1500);
const trendStarred = JSON.parse(await cdp.eval(`JSON.stringify({
  detailReqs: window.__mock.stats.repoDetailReqs || 0,
  method: window.__mock.starMethod,
  savedBadge: !!document.querySelector('#list .row .kind-saved'),
})`));
check("趋势行 star 调用的是 PUT", trendStarred.method, "PUT");
check("趋势行 star 补拉了仓库详情", trendStarred.detailReqs > 0, true);
check("趋势行出现「已收藏」徽章", trendStarred.savedBadge, true);

await cdp.eval(`document.querySelector('#viewPick button[data-view="mine"]').click()`);
await sleep(700);
const restore = JSON.parse(await cdp.eval(`JSON.stringify({
  tabs: !document.getElementById('tabs').classList.contains('hidden'),
  lang: !document.getElementById('langSelect').classList.contains('hidden'),
})`));
check("切回收藏后页签回来", restore.tabs, true);
check("切回收藏后语言筛选回来", restore.lang, true);

cdp.close();
proc.kill();
server.close();
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
