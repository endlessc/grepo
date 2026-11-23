/* 专项验证 sortSelect：模拟用户真实点击自定义下拉，确认排序真的切换。
 * 判据四项：原生 select 值变了、列表重排了、触发器标签同步了、has-value 生效了。
 */
import { startServer } from "./server.mjs";
import { launchChrome, newProfile } from "./cdp.mjs";
import { HARNESS } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const { proc, cdp } = await launchChrome(newProfile("sort"));

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
    const wrap = document.getElementById('sortSelect');
    const sel = document.getElementById('sort');
    const trigger = wrap.querySelector('.select-trigger');
    const label = wrap.querySelector('.select-label');
    const firstRow = () => {
      const a = document.querySelector('#list .row .repo');
      return a ? a.textContent : null;
    };
    const before = {
      value: sel.value,
      label: label.textContent.trim(),
      first: firstRow(),
      hasValue: wrap.classList.contains('has-value'),
    };

    // 1) 点开自定义下拉
    trigger.click();
    await new Promise(r => setTimeout(r, 150));
    const opened = wrap.classList.contains('is-open');
    const options = [...wrap.querySelectorAll('.select-option')].map(o => ({
      value: o.dataset.value, text: o.textContent.trim(),
    }));

    // 2) 点「星标最多」
    const target = wrap.querySelector('.select-option[data-value="stars"]');
    if (!target) return { error: '找不到 stars 选项', options, opened };
    target.click();
    await new Promise(r => setTimeout(r, 1200));

    const after = {
      value: sel.value,
      label: label.textContent.trim(),
      first: firstRow(),
      hasValue: wrap.classList.contains('has-value'),
      closed: !wrap.classList.contains('is-open'),
    };
    return { opened, options, before, after };
  })()`,
  true
);

console.log(JSON.stringify(r, null, 2));

const a = r.after || {};
const ok =
  r.opened === true &&
  a.value === "stars" &&
  a.label === "星标最多" &&
  a.closed === true &&
  a.hasValue === true &&
  a.first !== r.before.first;

console.log("");
console.log(ok ? "✓ sortSelect 端到端可用：点开→选中→排序生效→标签与状态同步" : "✗ sortSelect 存在问题");

cdp.close();
proc.kill();
server.close();
process.exit(ok ? 0 : 1);
