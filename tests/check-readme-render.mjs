/* README 渲染验收：
 *   1) 原始 HTML 块（<p align>、<table>、<br><sub>）被消化，不当文本显示
 *   2) 图片真实渲染，但全部懒加载且不发送 referrer
 *   3) GFM 表格与 HTML 表格都能出表
 *   4) 相对链接补成 GitHub 绝对地址
 *   5) 嵌套列表还原层级
 *   6) javascript: 链接与注入脚本都无效
 *   7) 弹窗确实变大了
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
const { cdp, proc } = await launchChrome(newProfile("readme"));

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
await sleep(800);

console.log("\n【打开详情，渲染 README】");
await cdp.eval("window.__mock.stats.readmeReqs = 0");
await cdp.eval(`document.querySelector('#list .row').click()`);
for (let i = 0; i < 80; i++) {
  if (await cdp.eval(`document.getElementById('repoReadme').textContent.includes('项目说明')`)) break;
  await sleep(150);
}
await sleep(300);

const r = JSON.parse(await cdp.eval(`(function(){
  const body = document.getElementById('repoReadme');
  const card = document.querySelector('#repoDialog .dialog-card');
  return JSON.stringify({
    html: body.innerHTML,
    text: body.textContent,
    readmeReqs: window.__mock.stats.readmeReqs || 0,
    imgs: body.querySelectorAll('img').length,
    noRefImgs: body.querySelectorAll('img[referrerpolicy="no-referrer"]').length,
    lazyImgs: body.querySelectorAll('img[loading="lazy"]').length,
    tables: body.querySelectorAll('table').length,
    nestedUl: body.querySelectorAll('ul ul ul').length,
    hrefs: Array.from(body.querySelectorAll('a')).map((a) => a.getAttribute('href') || ''),
    cardW: Math.round(card.getBoundingClientRect().width),
    cardH: Math.round(card.getBoundingClientRect().height),
    cardBottom: Math.round(card.getBoundingClientRect().bottom),
    footTop: Math.round(document.querySelector('.foot').getBoundingClientRect().top),
    footVisible: getComputedStyle(document.querySelector('.foot')).visibility !== 'hidden',
    bodyH: Math.round(body.getBoundingClientRect().height),
    xss: String(window.__xss),
    contrast: (function(){
      function rgb(s){
        const m = s.match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const p = m[1].split(',').map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      }
      function lum(c){
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      }
      function ratio(fg, bg){
        const a = Math.max(lum(fg), lum(bg)), b = Math.min(lum(fg), lum(bg));
        return (a + 0.05) / (b + 0.05);
      }
      function bgOf(el){
        let n = el;
        while (n && n !== document.documentElement) {
          const c = rgb(getComputedStyle(n).backgroundColor);
          if (c && c.a > 0.6) return c;
          n = n.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      }
      function probe(sel){
        const el = document.querySelector(sel);
        if (!el) return null;
        return Math.round(ratio(rgb(getComputedStyle(el).color), bgOf(el)) * 100) / 100;
      }
      return {
        th: probe('#repoReadme .md-table th'),
        td: probe('#repoReadme .md-table td'),
        para: probe('#repoReadme p'),
      };
    })(),
  });
})()`));

check("发起了一次 README 请求", r.readmeReqs, 1);
check("README 有内容", r.text.length > 120, true);

console.log("\n【HTML 块与图片】");
check("没有把 <p align> 当文本显示", /align=|<p align/.test(r.text), false);
check("README 里的图片被渲染", r.imgs > 0, true);
check("所有图片都不发 referrer", r.noRefImgs, r.imgs);
check("所有图片都懒加载", r.lazyImgs, r.imgs);
check("HTML 表格的图注留下了", r.text.includes("图注一") && r.text.includes("图注二"), true);
check("logo 的 alt 没有变成正文", r.text.includes("项目 Logo"), false);

console.log("\n【表格与徽章】");
check("表格数量（GFM + HTML）", r.tables >= 2, true, r.tables >= 2);
check("GFM 表格内容被解析", r.text.includes("用来验"), true);
check("表格里的行内码保留", /<code>code<\/code>/.test(r.html), true);
check("徽章按图片渲染", /shields\.io/i.test(r.html), true);

console.log("\n【链接与列表】");
check("相对链接补成 GitHub 地址",
  r.hrefs.some((h) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/LICENSE$/.test(h)), true);
check("没有 javascript: 链接", r.hrefs.some((h) => /^javascript:/i.test(h)), false);
check("嵌套列表还原到三层", r.nestedUl >= 1, true, r.nestedUl >= 1);

console.log("\n【安全】");
check("注入脚本没有执行", r.xss, "undefined");
check("没有 script 标签", /<script/i.test(r.html), false);

console.log("\n【弹窗尺寸】");
check("弹窗宽度（1440 视口下 ≥800）", r.cardW >= 800, true, r.cardW >= 800);
check("README 区域高度（≥300）", r.bodyH >= 300, true, r.bodyH >= 300);
check("弹窗没有超出视口", r.cardH <= 860, true, r.cardH <= 860);
check("弹窗打开时页脚快捷键栏让位", r.footVisible, false);

console.log("\n【对比度】");
for (const [name, v] of Object.entries(r.contrast)) {
  check(`${name} ≥ 4.5:1`, v, true, v === null ? false : v >= 4.5);
}

cdp.close();
proc.kill();
server.close();
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
