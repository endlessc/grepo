/* 针对新加的 #langSelect 包装做一次专项检查：
 * id 存在不等于功能没坏 —— 确认改语言后结果确实被筛掉。
 */
import { startServer } from "./server.mjs";
import { launchChrome, newProfile } from "./cdp.mjs";
import { HARNESS } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const { proc, cdp } = await launchChrome(newProfile("lang"));

cdp.on("Runtime.exceptionThrown", (p) =>
  console.log("  [异常]", p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)
);
cdp.on("Runtime.consoleAPICalled", (p) => {
  if (p.type === "error")
    console.log("  [错误]", (p.args || []).map((a) => a.value ?? a.description).join(" "));
});

await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
await cdp.send("Page.navigate", { url: `${base}/test/live` });
for (let i = 0; i < 900; i++) {
  if ((await cdp.eval("window.__h.rows()")) > 0) break;
  await sleep(200);
}
await sleep(1000);

const r = await cdp.eval(
  `(async () => {
    const sel = document.getElementById('lang');
    const wrap = document.getElementById('langSelect');
    const opts = [...sel.options].map(o => o.value).filter(Boolean);
    const before = window.__h.hits();
    const pick = opts.find(v => v === 'TypeScript') || opts[0];
    sel.value = pick;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1000));
    const after = window.__h.hits();
    return {
      wrapExists: !!wrap,
      wrapClass: wrap ? wrap.className : null,
      selectVisible: sel.getBoundingClientRect().height > 0,
      optionCount: opts.length,
      pick,
      before,
      after,
      filtered: after < before,
      stat: document.getElementById('stat').textContent.trim(),
    };
  })()`,
  true
);

console.log("语言筛选专项：");
console.log(JSON.stringify(r, null, 2));

const ok = r.wrapExists && r.selectVisible && r.filtered;
console.log(ok ? "\n✓ #langSelect 包装下语言筛选正常" : "\n✗ 语言筛选可能已失效");

cdp.close();
proc.kill();
server.close();
process.exit(ok ? 0 : 1);
