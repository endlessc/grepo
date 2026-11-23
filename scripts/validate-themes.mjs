/* 主题调色板校验：覆盖全部 8 套主题（含默认工坊精工、墨夜暗色、极光深蓝与终端赛博），每组语义配对都要过 WCAG AA（正文 4.5）。 */
const themes = {
  atelier: {
    name: "工坊精工",
    ground: "#f8fafc", groundSubtle: "#eff3f8", surface: "#ffffff", surfaceHover: "#f8fafc",
    border: "#e2e8f0", rule: "#edf2f7", control: "#cbd5e1",
    text: "#0f172a", textSecondary: "#334155", muted: "#475569", subtle: "#5c6b7f",
    accent: "#2563eb", accentHover: "#1d4ed8", accentSoft: "#eff6ff", accentBorder: "#bfdbfe",
    brass: "#8c4608", brassSoft: "#fef3c7", brassBorder: "#fde68a",
  },
  paper: {
    name: "纸面索引",
    ground: "#efece4", groundSubtle: "#e8e4da", surface: "#ffffff", surfaceHover: "#faf8f3",
    border: "#dcd7ca", rule: "#e6e2d6", control: "#c4bfb0",
    text: "#17181a", textSecondary: "#3c4046", muted: "#575b63", subtle: "#5f636b",
    accent: "#1f4ed8", accentHover: "#1a41b8", accentSoft: "#eef2fd", accentBorder: "#c5d2f6",
    brass: "#7a5812", brassSoft: "#f8f2e1", brassBorder: "#e5d8b3",
  },
  porcelain: {
    name: "素瓷",
    ground: "#f4f5f6", groundSubtle: "#eceef0", surface: "#ffffff", surfaceHover: "#fafbfb",
    border: "#dde1e4", rule: "#e8ebed", control: "#c2c8cd",
    text: "#14161a", textSecondary: "#3a4048", muted: "#5a6169", subtle: "#646b73",
    accent: "#2b4c9b", accentHover: "#23407f", accentSoft: "#eef1f8", accentBorder: "#c6cfe6",
    brass: "#7a5812", brassSoft: "#f7f1e2", brassBorder: "#e6d8b6",
  },
  linen: {
    name: "素麻",
    ground: "#f2efe7", groundSubtle: "#eae6db", surface: "#fffdf9", surfaceHover: "#fbf8f1",
    border: "#ddd7c9", rule: "#e8e3d6", control: "#c3bcac",
    text: "#241f18", textSecondary: "#45403a", muted: "#5f594f", subtle: "#686258",
    accent: "#4a5d3a", accentHover: "#3d4e30", accentSoft: "#eef0e8", accentBorder: "#c9d0bd",
    brass: "#7a5812", brassSoft: "#f6efdc", brassBorder: "#e5d8b3",
  },
  celadon: {
    name: "青瓷",
    ground: "#eff2ef", groundSubtle: "#e6ebe7", surface: "#ffffff", surfaceHover: "#f8faf8",
    border: "#d9e0da", rule: "#e5ebe6", control: "#bfc9c2",
    text: "#16201c", textSecondary: "#39443f", muted: "#59635e", subtle: "#626c67",
    accent: "#2f6f63", accentHover: "#275c52", accentSoft: "#eaf2ef", accentBorder: "#bcd4cd",
    brass: "#7a5812", brassSoft: "#f7efe2", brassBorder: "#e6d5bc",
  },
  obsidian: {
    name: "墨夜暗色",
    ground: "#0c1017", groundSubtle: "#18202c", surface: "#131922", surfaceHover: "#1a2230",
    border: "#253041", rule: "#1e2736", control: "#3b4a61",
    text: "#f1f5f9", textSecondary: "#cbd5e1", muted: "#94a3b8", subtle: "#8494aa",
    accent: "#60a5fa", accentHover: "#93c5fd", accentSoft: "#17253d", accentBorder: "#2a4673",
    brass: "#fbbf24", brassSoft: "#2a200d", brassBorder: "#5c4314",
  },
  aurora: {
    name: "极光深蓝",
    ground: "#070b18", groundSubtle: "#121b33", surface: "#0e1528", surfaceHover: "#15203b",
    border: "#223154", rule: "#192542", control: "#384e7d",
    text: "#f0f6ff", textSecondary: "#cbd9f2", muted: "#93a9cc", subtle: "#869ec4",
    accent: "#38bdf8", accentHover: "#7dd3fc", accentSoft: "#0c243d", accentBorder: "#1e4d78",
    brass: "#fbbf24", brassSoft: "#2b200c", brassBorder: "#634814",
  },
  cyber: {
    name: "终端赛博",
    ground: "#060908", groundSubtle: "#111a16", surface: "#0c1210", surfaceHover: "#131e19",
    border: "#1c3027", rule: "#15241d", control: "#2f5242",
    text: "#ecfdf5", textSecondary: "#bbf7d0", muted: "#86b89f", subtle: "#7aa891",
    accent: "#34d399", accentHover: "#6ee7b7", accentSoft: "#0a291e", accentBorder: "#1a5c44",
    brass: "#facc15", brassSoft: "#262108", brassBorder: "#5c4e12",
  },
};

function lum(h) {
  const c = h.replace("#", "");
  const v = [0, 2, 4]
    .map((i) => parseInt(c.substr(i, 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  const L1 = lum(a), L2 = lum(b);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

const checks = [
  ["正文/卡片", "text", "surface", 4.5],
  ["正文/底色", "text", "ground", 4.5],
  ["次级/卡片", "textSecondary", "surface", 4.5],
  ["描述/卡片", "muted", "surface", 4.5],
  ["描述/底色", "muted", "ground", 4.5],
  ["描述/标签底", "muted", "groundSubtle", 4.5],
  ["归属/卡片", "subtle", "surface", 4.5],
  ["归属/标签底", "subtle", "groundSubtle", 4.5],
  ["强调/卡片", "accent", "surface", 4.5],
  ["强调/浅底", "accent", "accentSoft", 4.5],
  ["强调/底色", "accent", "ground", 4.5],
  ["黄铜/浅黄铜", "brass", "brassSoft", 4.5],
  ["黄铜/卡片", "brass", "surface", 4.5],
];

let worstAll = Infinity;
let totalFails = 0;
for (const [key, t] of Object.entries(themes)) {
  console.log(`\n=== ${t.name} (${key}) ===`);
  let worst = Infinity;
  let fails = 0;
  for (const [label, fg, bg, min] of checks) {
    const r = ratio(t[fg], t[bg]);
    worst = Math.min(worst, r);
    const ok = r >= min;
    if (!ok) { fails++; totalFails++; }
    console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(10)} ${r.toFixed(2)}:1`);
  }
  console.log(`  最低 ${worst.toFixed(2)}:1 ｜ 未达标 ${fails} 项`);
  worstAll = Math.min(worstAll, worst);
}
console.log(`\n八套主题最低值 ${worstAll.toFixed(2)}:1 ｜ 总未达标 ${totalFails} 项`);
process.exit(totalFails ? 1 : 0);
