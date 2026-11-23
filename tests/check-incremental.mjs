/* 增量同步验收：
 *   1) 首次全量
 *   2) 无变化时点同步 → 请求数应极少、总数不变
 *   3) 注入 2 个新星标 → 增量只翻 1 页、总数 +2、标签保留
 *   4) 按住 ⇧ 点同步 → 全量，请求数回到满页数
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
const { cdp, proc } = await launchChrome(newProfile("incr"));

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

console.log("\n【首次同步】");
const first = JSON.parse(await cdp.eval(`JSON.stringify({
  total: window.__h.hits(),
  stats: window.__mock.stats,
})`));
check("仓库总数", first.total, 4000);
check("首次走全量（翻完全部分页）", first.stats.starPages >= 38, true);

// 无变化再同步
await cdp.eval("window.__mock.reset()");
await cdp.eval(`document.getElementById('syncBtn').click()`);
await sleep(4000);
const second = JSON.parse(await cdp.eval(`JSON.stringify({
  total: window.__h.hits(),
  stats: window.__mock.stats,
  toast: (document.getElementById('toast') || {}).textContent || '',
})`));
console.log("\n【无变化再同步】");
check("总数不变", second.total, 4000);
check("星标只翻了 1 页", second.stats.starPages, 1);
check("自有仓库只翻了 1 页", second.stats.ownPages, 1);
check("总请求数 ≤ 2", second.stats.requests <= 2, true);

// 注入 2 个新星标
await cdp.eval("window.__mock.reset()");
await cdp.eval("window.__mock.addStars(2)");
await sleep(300);
await cdp.eval(`document.getElementById('syncBtn').click()`);
await sleep(4500);
const third = JSON.parse(await cdp.eval(`JSON.stringify({
  total: window.__h.hits(),
  stats: window.__mock.stats,
  toast: (document.getElementById('toast') || {}).textContent || '',
})`));
console.log("\n【新增 2 个星标后增量】");
check("总数 +2", third.total, 4002);
check("星标只翻 1 页", third.stats.starPages, 1);
check("总请求数 ≤ 2", third.stats.requests <= 2, true);
check("提示为增量口径", third.toast.includes("增量") || third.toast.includes("最新"), true);

// 按住 ⇧ 全量
await cdp.eval("window.__mock.reset()");
await cdp.eval(`document.getElementById('syncBtn').dispatchEvent(
  new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
await sleep(6000);
const fourth = JSON.parse(await cdp.eval(`JSON.stringify({
  total: window.__h.hits(),
  stats: window.__mock.stats,
})`));
console.log("\n【按住 ⇧ 全量】");
check("总数仍为 4002（全量不丢数据）", fourth.total, 4002);
check("确实翻完了所有分页", fourth.stats.starPages >= 38, true);

cdp.close();
proc.kill();
server.close();
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
