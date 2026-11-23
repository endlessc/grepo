/* 验证主题选择能记住：点青瓷 → 刷新 → 仍是青瓷，且 aria-checked 正确。 */
import { startServer } from "./server.mjs";
import { launchChrome, newProfile } from "./cdp.mjs";
import { HARNESS } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const { cdp, proc } = await launchChrome(newProfile("theme"));

await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});
await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
await cdp.send("Page.navigate", { url: `${base}/test/live` });
for (let i = 0; i < 900; i++) {
  if ((await cdp.eval("window.__h.rows()")) > 0) break;
  await sleep(200);
}
await sleep(1200);

const read = `(function(){
  const checked = document.querySelector('#themePick .swatch[aria-checked="true"]');
  const cs = getComputedStyle(document.documentElement);
  return JSON.stringify({
    dataTheme: document.documentElement.dataset.theme || '(默认)',
    checked: checked ? checked.dataset.theme : null,
    ground: cs.getPropertyValue('--ground').trim(),
    accent: cs.getPropertyValue('--accent').trim(),
  });
})()`;

console.log("初始:", await cdp.eval(read));

await cdp.eval(`document.querySelector('.swatch[data-theme="celadon"]').click()`);
await sleep(500);
console.log("点击青瓷:", await cdp.eval(read));

await cdp.send("Page.reload");
await sleep(1500);
for (let i = 0; i < 400; i++) {
  if ((await cdp.eval("window.__h.rows()")) > 0) break;
  await sleep(150);
}
await sleep(800);
console.log("刷新后:", await cdp.eval(read));

await cdp.eval(`document.querySelector('.swatch[data-theme="paper"]').click()`);
await sleep(400);
await cdp.send("Page.reload");
await sleep(1500);
for (let i = 0; i < 400; i++) {
  if ((await cdp.eval("window.__h.rows()")) > 0) break;
  await sleep(150);
}
await sleep(800);
console.log("切回纸面后刷新:", await cdp.eval(read));

cdp.close();
proc.kill();
server.close();
