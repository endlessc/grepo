/* 验证语言下拉的计数随页签与归档开关变化，并与独立统计一致。 */
import { startServer } from "./server.mjs";
import { launchChrome, newProfile } from "./cdp.mjs";
import { HARNESS } from "./harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(HERE, "repos.json"), "utf8"));

/* 参考实现：与页面同样的口径 */
const recs = [];
for (const s of data.stars) recs.push({ lang: s.repo.language, kind: "star", archived: !!s.repo.archived });
for (const r of data.own) recs.push({ lang: r.language, kind: r.fork ? "fork" : "owned", archived: !!r.archived });

function expectCounts(kind, showArchived) {
  const m = new Map();
  for (const r of recs) {
    if (!r.lang) continue;
    if (kind && r.kind !== kind) continue;
    if (!showArchived && r.archived) continue;
    m.set(r.lang, (m.get(r.lang) || 0) + 1);
  }
  return m;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, got, want) {
  if (String(got) === String(want)) { pass++; console.log(`  ✓ ${name}：${got}`); }
  else { fail++; console.log(`  ✗ ${name}：得到 ${got}，期望 ${want}`); }
}

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const { cdp, proc } = await launchChrome(newProfile("langcount"));

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

async function readOptions() {
  return JSON.parse(await cdp.eval(`(function(){
    const sel = document.getElementById('lang');
    const out = {};
    for (const o of sel.options) {
      if (!o.value) continue;
      const m = o.text.match(/^(.*) \\((\\d+)\\)$/);
      if (m) out[m[1]] = Number(m[2]);
    }
    return JSON.stringify(out);
  })()`));
}

async function switchTab(kind) {
  await cdp.eval(`document.querySelector('#tabs button[data-kind="${kind}"]').click()`);
  await sleep(700);
}

async function setArchived(on) {
  await cdp.eval(`(function(){
    const cb = document.getElementById('showArchived');
    cb.checked = ${on};
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(700);
}

function compare(label, got, want) {
  const keys = new Set([...Object.keys(got), ...want.keys()]);
  let diffs = [];
  for (const k of keys) {
    const a = got[k] ?? 0;
    const b = want.get(k) ?? 0;
    if (a !== b) diffs.push(`${k}: ${a}≠${b}`);
  }
  if (diffs.length) {
    fail++;
    console.log(`  ✗ ${label}：${diffs.length} 项不一致 → ${diffs.slice(0, 5).join("，")}`);
  } else {
    pass++;
    console.log(`  ✓ ${label}：${keys.size} 种语言全部吻合`);
  }
}

console.log("\n【全部页签】");
compare("语言分布与参考一致", await readOptions(), expectCounts("", false));

console.log("\n【星标页签】");
await switchTab("star");
const starOpts = await readOptions();
compare("语言分布与参考一致", starOpts, expectCounts("star", false));

const allOpts = expectCounts("", false);
const starOnly = expectCounts("star", false);
const changed = [...starOnly.keys()].some((k) => starOnly.get(k) !== allOpts.get(k));
check("星标页签的数字确实变了（不再沿用全部）", changed, true);

console.log("\n【fork 页签】");
await switchTab("fork");
compare("语言分布与参考一致", await readOptions(), expectCounts("fork", false));

console.log("\n【自建页签】");
await switchTab("owned");
compare("语言分布与参考一致", await readOptions(), expectCounts("owned", false));

console.log("\n【勾选包含已归档】");
await switchTab("");
await setArchived(true);
compare("含归档后分布与参考一致", await readOptions(), expectCounts("", true));

await setArchived(false);
console.log("\n【选中的语言在切页签后仍保留】");
await cdp.eval(`(function(){
  const sel = document.getElementById('lang');
  const target = [...sel.options].find(o => o.value === 'Python');
  sel.value = target ? target.value : sel.options[1].value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(600);
const picked = await cdp.eval(`document.getElementById('lang').value`);
await switchTab("owned");
const stillPicked = await cdp.eval(`document.getElementById('lang').value`);
check("切到自建后仍停留在所选语言", stillPicked, picked);

const label = await cdp.eval(`(function(){
  const sel = document.getElementById('lang');
  return sel.options[sel.selectedIndex].textContent;
})()`);
check(`选项仍可读（${label}）`, /\(\d+\)$/.test(label), true);

cdp.close();
proc.kill();
server.close();
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
