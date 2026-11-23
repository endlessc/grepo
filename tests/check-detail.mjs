/* 详情弹窗验收：
 *   1) 点行弹窗出现，先用本地数据渲染
 *   2) 随后拉 /repos 补齐（issue/许可/分支/大小 出现）
 *   3) 在 GitHub 打开 / 复制链接 / 关闭
 *   4) 弹窗打开时全局快捷键让位
 *   5) 趋势视图的行也能开详情，且隐藏「编辑标签」
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
const { cdp, proc } = await launchChrome(newProfile("detail"));

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

console.log("\n【点击仓库行】");
await cdp.eval("window.__mock.stats.repoDetailReqs = 0");
const opened = JSON.parse(await cdp.eval(`(function(){
  const row = document.querySelector('#list .row');
  const full = row.querySelector('.repo').textContent;
  row.click();
  return JSON.stringify({ full, visible: !document.getElementById('repoDialog').classList.contains('hidden') });
})()`));
check("弹窗立即出现", opened.visible, true);
await sleep(200);
const early = JSON.parse(await cdp.eval(`JSON.stringify({
  title: document.getElementById('repoTitle').textContent,
  owner: document.getElementById('repoOwner').textContent,
  desc: document.getElementById('repoDesc').textContent.slice(0, 12),
  cells: document.querySelectorAll('#repoGrid > div').length,
})`));
check("标题已填", early.title.length > 0, true);
check("owner 已填", early.owner.length > 0, true);
check("本地阶段已有若干字段", early.cells >= 2, true);

console.log("\n【API 补齐】");
await sleep(1200);
const enriched = JSON.parse(await cdp.eval(`JSON.stringify({
  cells: document.querySelectorAll('#repoGrid > div').length,
  note: document.getElementById('repoNote').textContent,
  text: document.getElementById('repoGrid').textContent,
  reqs: window.__mock.stats.repoDetailReqs || 0,
  tags: document.querySelectorAll('#repoTags .t').length,
  tagBtnHidden: document.getElementById('repoTagBtn').classList.contains('hidden'),
})`));
check("发起了详情请求", enriched.reqs, 1);
check("字段数量合理（≥6）", enriched.cells >= 6, true);
check("出现许可 MIT", enriched.text.includes("MIT"), true);
check("出现未关闭 issue", enriched.text.includes("未关闭 issue"), true);
check("备注说明数据来源", enriched.note.includes("GitHub"), true);
check("标签/话题已渲染", enriched.tags > 0, true);
check("收藏视图下显示「编辑标签」", enriched.tagBtnHidden, false);
console.log(`    备注：${enriched.note}`);

console.log("\n【弹窗占用键盘】");
const guard = await cdp.eval(`(function(){
  const before = document.getElementById('q').value;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  return document.getElementById('q').value === before &&
    !document.getElementById('repoDialog').classList.contains('hidden');
})()`);
check("对话框打开时 / 不抢焦点", guard, true);

console.log("\n【关闭】");
await cdp.eval(`document.getElementById('repoClose').click()`);
await sleep(300);
check("弹窗已关闭", await cdp.eval(`document.getElementById('repoDialog').classList.contains('hidden')`), true);

console.log("\n【趋势视图的行也能开详情】");
await cdp.eval(`document.querySelector('#viewPick button[data-view="trend"]').click()`);
await sleep(3000);
await cdp.eval(`document.querySelector('#list .row').click()`);
await sleep(1200);
const trendDetail = JSON.parse(await cdp.eval(`JSON.stringify({
  visible: !document.getElementById('repoDialog').classList.contains('hidden'),
  tagBtnHidden: document.getElementById('repoTagBtn').classList.contains('hidden'),
  note: document.getElementById('repoNote').textContent,
})`));
check("趋势行能开详情", trendDetail.visible, true);
check("趋势行隐藏「编辑标签」", trendDetail.tagBtnHidden, true);
check("同样拿到了 API 数据", trendDetail.note.includes("GitHub"), true);

cdp.close();
proc.kill();
server.close();
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
