/* 视觉体检：一次性量出排版刻度、颜色对比度、溢出，以及关键元素的实际计算值。
 * 用法：node audit.mjs [宽] [高]
 */
import { startServer } from "./server.mjs";
import { launchChrome, newProfile } from "./cdp.mjs";
import { HARNESS } from "./harness.mjs";

const W = Number(process.argv[2] || 1440);
const THEME_ARG = process.argv.find((a) => a.startsWith("--theme="));
const themeName = THEME_ARG ? THEME_ARG.slice(8) : "";
const H = Number(process.argv[3] || 900);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `
(function(){
  function rgb(s){
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r:p[0], g:p[1], b:p[2], a: p.length>3 ? p[3] : 1 };
  }
  function lum(c){
    const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);
  }
  function ratio(fg,bg){
    const L1=lum(fg), L2=lum(bg);
    const a=Math.max(L1,L2), b=Math.min(L1,L2);
    return (a+0.05)/(b+0.05);
  }
  // 沿祖先链找到第一个不透明背景
  function bgOf(el){
    let n = el;
    while (n && n !== document.documentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.6) return c;
      n = n.parentElement;
    }
    return rgb(getComputedStyle(document.body).backgroundColor) || {r:255,g:255,b:255,a:1};
  }
  function probe(sel, label){
    const el = document.querySelector(sel);
    if (!el) return { label, sel, missing: true };
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color);
    const bg = bgOf(el);
    return {
      label, sel,
      font: parseFloat(cs.fontSize),
      weight: cs.fontWeight,
      lh: cs.lineHeight,
      color: cs.color,
      bg: 'rgb('+bg.r+','+bg.g+','+bg.b+')',
      ratio: fg && bg ? Math.round(ratio(fg,bg)*100)/100 : null,
      rect: (function(){const r=el.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};})(),
    };
  }
  const out = { probes: [], sizes: {}, overflow: null, rowH: null };

  // 字体刻度
  const set = new Set();
  document.querySelectorAll('#app *, #setup *').forEach(el=>{
    const s = parseFloat(getComputedStyle(el).fontSize);
    if (s) set.add(s);
  });
  out.sizes = [...set].sort((a,b)=>a-b);
  // 找出不在既定刻度上的元素，便于定位漏网的尺寸
  const allowed = new Set([10.5,11.5,12.5,13.5,15,17,20,22,24]);
  out.offScale = [];
  document.querySelectorAll('#app *').forEach(el=>{
    const sz = parseFloat(getComputedStyle(el).fontSize);
    if (!sz || allowed.has(sz)) return;
    if (out.offScale.length > 8) return;
    out.offScale.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '') || '',
      size: Math.round(sz*100)/100,
    });
  });

  out.probes.push(probe('.brand','品牌字'));
  out.probes.push(probe('.repo','仓库名'));
  out.probes.push(probe('.owner','归属'));
  out.probes.push(probe('.desc','描述'));
  out.probes.push(probe('.stars','星数'));
  out.probes.push(probe('.lang','语言'));
  out.probes.push(probe('.date','日期'));
  out.probes.push(probe('.tags .t','topic 标签'));
  out.probes.push(probe('.kind-owned','自建徽章'));

  out.probes.push(probe('.sub','结果行'));
  out.probes.push(probe('.tabs button.on','当前页签'));
  out.probes.push(probe('.tabs button:not(.on)','其他页签'));
  out.probes.push(probe('.foot span','页脚提示'));
  out.probes.push(probe('.index-count','索引计数'));

  // 行高
  const row = document.querySelector('.row');
  if (row) out.rowH = Math.round(row.getBoundingClientRect().height);

  // 溢出：找出超出视口宽度的元素
  const vw = document.documentElement.clientWidth;
  const bad = [];
  function inScroller(el){
    let n = el.parentElement;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') &&
          n.scrollWidth > n.clientWidth + 1) return true;
      n = n.parentElement;
    }
    return false;
  }
  document.querySelectorAll('#app *').forEach(el=>{
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    if (inScroller(el)) return;
    if (r.right > vw + 1 || r.left < -1) {
      bad.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '',
        left: Math.round(r.left), right: Math.round(r.right),
      });
    }
  });
  out.overflow = {
    vw,
    docScrollW: document.documentElement.scrollWidth,
    hasHScroll: document.documentElement.scrollWidth > vw + 1,
    count: bad.length,
    sample: bad.slice(0, 6),
  };
  return JSON.stringify(out);
})()
`;

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
const { proc, cdp } = await launchChrome(newProfile("audit"));

await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: W,
  height: H,
  deviceScaleFactor: 2,
  mobile: W < 500,
});
await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HARNESS });
await cdp.send("Page.navigate", { url: `${base}/test/live` });
for (let i = 0; i < 900; i++) {
  if ((await cdp.eval("window.__h.rows()")) > 0) break;
  await sleep(200);
}

if (themeName) {
  await cdp.eval("(function(){var b=document.querySelector('.swatch[data-theme=\"" + themeName + "\"]'); if(b) b.click(); })()");
  await sleep(600);
}
await sleep(1500);

const raw = await cdp.eval(PAGE);
const d = JSON.parse(raw);

console.log(`\n视口 ${d.overflow.vw}px ｜ 横向滚动 ${d.overflow.hasHScroll ? "有 ⚠" : "无"} ｜ 越界元素 ${d.overflow.count}`);
if (d.overflow.count) console.log("  样例:", JSON.stringify(d.overflow.sample));

console.log(`\n字号刻度: ${d.sizes.join(" / ")}  （共 ${d.sizes.length} 档）`);
if (d.offScale && d.offScale.length) {
  console.log('  刻度外元素:');
  for (const o of d.offScale) console.log(`    ${o.size}px  <${o.tag}> .${o.cls}`);
}
console.log(`行高: ${d.rowH}px`);

console.log("\n文本对比度（WCAG AA 正文需 ≥4.5，大字 ≥3）:");
let fails = 0;
for (const p of d.probes) {
  if (p.missing) { console.log(`  ⚠ ${p.label} 未找到 (${p.sel})`); continue; }
  const ok = p.ratio === null ? true : p.ratio >= 4.5;
  if (!ok) fails++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${p.label.padEnd(6)} ${String(p.font).padStart(5)}px w${p.weight}` +
    `  ${String(p.ratio).padStart(5)}:1   ${p.color}`
  );
}
console.log(`\n对比度未达标：${fails} 项`);

cdp.close();
proc.kill();
server.close();
