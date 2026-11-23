/* 验证「第二轮起就是增量」：状态文案应显示「增量同步」，且只翻 1 页星标。 */
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
const { cdp, proc } = await launchChrome(newProfile("mode"));

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

// 采集一轮同步过程中出现过的状态文案
const capture = `(async () => {
  window.__mock.reset();
  const seen = new Set();
  const el = document.getElementById('syncState');
  el.textContent = '';
  document.getElementById('syncBtn').click();
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    if (el.textContent) seen.add(el.textContent);
    if (!document.getElementById('syncBtn').disabled && Date.now() - t0 > 800) break;
    await new Promise(r => setTimeout(r, 40));
  }
  return JSON.stringify({ seen: [...seen], stats: window.__mock.stats });
})()`;

console.log("\n【第二次点同步（应走增量）】");
const r2 = JSON.parse(await cdp.eval(capture, true));
const texts = r2.seen.join(" | ");
check("状态行出现「增量同步」", texts.includes("增量同步"), true);
check("状态行没有出现「全量同步」", texts.includes("全量同步"), false);
check("星标只翻 1 页", r2.stats.starPages, 1);
check("总请求 ≤ 3", r2.stats.requests <= 3, true);
console.log(`    状态文案：${texts}`);

console.log("\n【清掉全量时间戳后（应退回全量）】");
await cdp.eval(`chrome.storage.local.remove(['grepo.lastFullSync'])`, true);
await sleep(300);
const r3 = JSON.parse(await cdp.eval(capture, true));
const texts3 = r3.seen.join(" | ");
check("状态行出现「全量同步」", texts3.includes("全量同步"), true);
check("翻完所有星标分页", r3.stats.starPages >= 38, true);
console.log(`    状态文案：${texts3}`);

console.log("\n【再点一次（增量时间戳已写回）】");
const r4 = JSON.parse(await cdp.eval(capture, true));
check("又回到增量", r4.seen.join(" ").includes("增量同步"), true);
check("星标只翻 1 页", r4.stats.starPages, 1);

cdp.close();
proc.kill();
server.close();
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
