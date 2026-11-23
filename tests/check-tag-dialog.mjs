/* 标签对话框验收：打开、改值、保存、清除、Esc 取消、键盘让位。
 * 同时截一张打开态。
 */
import { startServer } from "./server.mjs";
import { launchChrome, newProfile } from "./cdp.mjs";
import { HARNESS } from "./harness.mjs";
import fs from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log(`  ✓ ${name}：${got}`); }
  else { fail++; console.log(`  ✗ ${name}：得到 ${got}，期望 ${want}`); }
}

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const { cdp, proc } = await launchChrome(newProfile("tagdlg"));

cdp.on("Runtime.exceptionThrown", (p) =>
  console.log("  [异常]", p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)
);

await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 900, deviceScaleFactor: 2, mobile: false,
});
await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
await cdp.send("Page.navigate", { url: `${base}/test/live` });
for (let i = 0; i < 900; i++) {
  if ((await cdp.eval("window.__h.rows()")) > 0) break;
  await sleep(200);
}
await sleep(1200);

// 选中第一行（单击会同时打开详情弹窗，先关掉它，好让全局快捷键可用）
await cdp.eval(`document.querySelector('#list .row').click()`);
await sleep(400);
await cdp.eval(`document.getElementById('repoClose').click()`);
await sleep(250);

// 用快捷键 t 打开
await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))`);
await sleep(500);

const opened = await cdp.eval(`(function(){
  const d = document.getElementById('tagDialog');
  const input = document.getElementById('tagInput');
  return JSON.stringify({
    visible: !d.classList.contains('hidden'),
    focused: document.activeElement === input,
    repo: document.getElementById('tagRepo').textContent,
    value: input.value,
    cardBg: getComputedStyle(document.querySelector('.dialog-card')).backgroundColor,
  });
})()`);
const o = JSON.parse(opened);
console.log("\n【打开】");
check("对话框可见", o.visible, true);
check("输入框自动聚焦", o.focused, true);
check("显示仓库名", o.repo.length > 0, true);
check("卡片用主题底色", o.cardBg, "rgb(255, 255, 255)");

// 截图
const shot = await cdp.send("Page.captureScreenshot", {
  format: "png",
  clip: { x: 400, y: 230, width: 640, height: 440, scale: 1 },
});
fs.writeFileSync("/tmp/dialog.png", Buffer.from(shot.data, "base64"));
console.log("  已截图 /tmp/dialog.png");

// 全局快捷键不应生效
const guarded = await cdp.eval(`(function(){
  const before = document.getElementById('q').value;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  return document.getElementById('q').value === before &&
         document.activeElement === document.getElementById('tagInput');
})()`);
console.log("\n【键盘让位】");
check("对话框打开时 / 不抢焦点", guarded, true);

// 输入并保存
await cdp.eval(`(function(){
  const i = document.getElementById('tagInput');
  i.value = 'UI 重做   文档';
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await cdp.eval(`document.getElementById('tagSave').click()`);
await sleep(900);

const saved = await cdp.eval(`(function(){
  const chips = [...document.querySelectorAll('#list .row .t.mine')].map(e=>e.textContent).join(' ');
  const d = document.getElementById('tagDialog');
  return JSON.stringify({
    hidden: d.classList.contains('hidden'),
    chip: chips || null,
    toast: (document.getElementById('toast') || {}).textContent || '',
  });
})()`);
const sv = JSON.parse(saved);
console.log("\n【保存】");
check("对话框关闭", sv.hidden, true);
check("标签已归一（多空格合一）", sv.chip, "#ui #重做 #文档");
check("有成功提示", sv.toast.includes("标签已更新"), true);

// 搜索能命中新标签
await cdp.eval(`(function(){
  const q = document.getElementById('q');
  q.value = '重做';
  q.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(900);
console.log("\n【可检索】");
check("按新标签能搜到", await cdp.eval("window.__h.hits()"), 1);

// Esc 取消
await cdp.eval(`(function(){
  const q = document.getElementById('q');
  q.value = '';
  q.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(800);
await cdp.eval(`document.querySelector('#list .row').click()`);
await sleep(400);
// 走真实路径：详情弹窗里点「编辑标签」
await cdp.eval(`document.getElementById('repoTagBtn').click()`);
await sleep(400);
await cdp.eval(`(function(){
  const i = document.getElementById('tagInput');
  i.value = '不该保存';
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
})()`);
await sleep(400);
const afterEsc = await cdp.eval(`(function(){
  const chips = [...document.querySelectorAll('#list .row .t.mine')].map(e=>e.textContent).join(' ');
  return JSON.stringify({
    hidden: document.getElementById('tagDialog').classList.contains('hidden'),
    chip: chips || null,
  });
})()`);
const ae = JSON.parse(afterEsc);
console.log("\n【Esc 取消】");
check("对话框关闭", ae.hidden, true);
check("标签未被改动", ae.chip, "#ui #重做 #文档");

// 清空即删除
await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))`);
await sleep(400);
await cdp.eval(`(function(){ document.getElementById('tagInput').value = ''; })()`);
await cdp.eval(`document.getElementById('tagSave').click()`);
await sleep(900);
console.log("\n【清空即删除】");
check("标签已移除", await cdp.eval(`document.querySelectorAll('#list .row .t.mine').length`), 0);

cdp.close();
proc.kill();
server.close();
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
