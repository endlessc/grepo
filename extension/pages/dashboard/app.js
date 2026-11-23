/* grepo / Chrome 扩展主逻辑
 * 本地索引 GitHub 仓库，数据存储于客户端，隐私安全。
 */

const K = {
  token: "grepo.token",
  repos: "grepo.repos",
  syncedAt: "grepo.syncedAt",
  theme: "grepo.theme",
  density: "grepo.density",
  layout: "grepo.layout",
  cloneMode: "grepo.cloneMode",
  lastFull: "grepo.lastFullSync",
  views: "grepo.views",
  quickLinks: "grepo.quickLinks",
  readmeCache: "grepo.readmeCache",
  aiConfig: "grepo.aiConfig",
  searchHistory: "grepo.searchHistory",
  vanished: "grepo.vanished",
  pinned: "grepo.pinned",
  releases: "grepo.releases",
};

const THEMES = ["atelier", "paper", "porcelain", "linen", "celadon", "obsidian", "aurora", "cyber"];
const THEME_NAMES = {
  atelier: "工坊精工 (Atelier)",
  paper: "纸面索引 (Paper)",
  porcelain: "素瓷 (Porcelain)",
  linen: "素麻 (Linen)",
  celadon: "青瓷 (Celadon)",
  obsidian: "墨夜暗色 (Obsidian)",
  aurora: "极光深蓝 (Aurora)",
  cyber: "终端赛博 (Cyber)",
};
const DENSITIES = ["comfortable", "compact"];
const LAYOUTS = ["list", "grid"];
const LANG_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572a5",
  Rust: "#dea584",
  Go: "#00add8",
  "C++": "#f34b7d",
  C: "#555555",
  Java: "#b07219",
  Swift: "#f05138",
  Ruby: "#701516",
  PHP: "#4f5d95",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Kotlin: "#a97bff",
  "C#": "#178600",
  "Jupyter Notebook": "#da5b0b",
  Vue: "#41b883",
  Dart: "#00b4ab",
  Lua: "#3b82f6",
  Zig: "#ec915c",
  Scala: "#c22d40",
};
const DEFAULT_QUICK_LINKS = [
  { name: "github.dev", url: "https://github.dev/{full_name}" },
  { name: "DeepWiki", url: "https://deepwiki.com/{full_name}" },
  { name: "Gitingest", url: "https://gitingest.com/{full_name}" },
];
const DEFAULT_AI_CONFIG = {
  mode: "ollama",
  baseUrl: "http://localhost:11434/v1",
  apiKey: "",
  model: "qwen2.5:7b",
};

/* 仓库按 id 取模分到 32 个分片。增量同步只重写命中的分片，
 * 不再把整份 4MB 数据序列化一遍。 */
const SHARDS = 32;
const shardKey = (i) => "grepo.r" + i;
const shardOf = (id) => Math.abs(Number(id) || 0) % SHARDS;

const PAGE_SIZE = 80;

const state = {
  token: "",
  repos: [],
  filtered: [],
  shown: 0,
  sel: -1,
  syncedAt: 0,
  syncing: false,
  kind: "",
  lastMonth: "",
  lastTier: null,
  view: "mine",
  period: "day",
  trend: [],
  trendItems: [],
  trendAt: 0,
  trendSource: "",
  trendLoading: false,
  // 搜索范围：local = 本地收藏，github = 整个 GitHub（Search API）
  scope: "local",
  remote: [],
  remoteLoading: false,
  remoteErr: "",
  remoteQuery: "",
  // v2 扩展状态：快捷视图、快捷外链、渐进式 README 缓存、批量整理与 AI 配置
  views: [],
  quickLinks: DEFAULT_QUICK_LINKS.slice(),
  readmeCache: {},
  readmeHits: new Set(),
  aiConfig: { ...DEFAULT_AI_CONFIG },
  cloneMode: "https",
  layout: "list",
  searchHistory: [],
  vanished: [],
  pinned: [],
  releases: {},
  peekOpen: false,
  peekRepo: null,
  recentViewed: [],
  batchMode: false,
  batchSelected: new Set(),
};

window.state = state;

const $ = (id) => document.getElementById(id);

/* ---------------- 样本数据（供离线/无插件上下文预览） ---------------- */

const SAMPLE_REPOS = [
  {
    id: 101,
    full_name: "microsoft/markitdown",
    owner: "microsoft",
    name: "markitdown",
    description: "Python tool for converting files and office documents to Markdown.",
    url: "https://github.com/microsoft/markitdown",
    language: "Python",
    stars: 61200,
    forks: 4100,
    topics: ["pdf-tool", "docs", "markdown", "pdf", "docx", "parser"],
    kind: "star",
    archived: false,
    starred_at: "2026-11-09T08:12:00Z",
    tags: "python-tool"
  },
  {
    id: 102,
    full_name: "astral-sh/uv",
    owner: "astral-sh",
    name: "uv",
    description: "An extremely fast Python package and project manager, written in Rust.",
    url: "https://github.com/astral-sh/uv",
    language: "Rust",
    stars: 48000,
    forks: 1800,
    topics: ["python-tool", "python", "package-manager", "rust"],
    kind: "star",
    archived: false,
    starred_at: "2026-11-01T14:30:00Z",
    tags: "rust cli"
  },
  {
    id: 103,
    full_name: "ollama/ollama",
    owner: "ollama",
    name: "ollama",
    description: "Get up and running with Llama 3.3, DeepSeek-R1, and other large language models.",
    url: "https://github.com/ollama/ollama",
    language: "Go",
    stars: 120000,
    forks: 9500,
    topics: ["llm", "ollama", "golang", "ai"],
    kind: "star",
    archived: false,
    starred_at: "2026-10-20T10:00:00Z",
    tags: "ai llm"
  },
  {
    id: 104,
    full_name: "ggml-org/llama.cpp",
    owner: "ggml-org",
    name: "llama.cpp",
    description: "LLM inference in C/C++ with state of the art performance on Apple silicon and commodity hardware.",
    url: "https://github.com/ggml-org/llama.cpp",
    language: "C++",
    stars: 81000,
    forks: 12000,
    topics: ["llm", "inference", "cpp", "ai"],
    kind: "star",
    archived: false,
    starred_at: "2026-10-01T09:15:00Z",
    tags: "inference"
  },
  {
    id: 105,
    full_name: "run-llama/llama_index",
    owner: "run-llama",
    name: "llama_index",
    description: "LlamaIndex is a data framework for your LLM applications, connecting custom data sources to large language models.",
    url: "https://github.com/run-llama/llama_index",
    language: "Python",
    stars: 37000,
    forks: 5200,
    topics: ["rag", "llm", "vector-store", "agents"],
    kind: "star",
    archived: false,
    starred_at: "2026-09-15T16:20:00Z",
    tags: "rag"
  },
  {
    id: 106,
    full_name: "junegunn/fzf",
    owner: "junegunn",
    name: "fzf",
    description: "A command-line fuzzy finder written in Go.",
    url: "https://github.com/junegunn/fzf",
    language: "Go",
    stars: 84000,
    forks: 4300,
    topics: ["cli", "fuzzy-finder", "go"],
    kind: "star",
    archived: false,
    starred_at: "2026-07-20T11:00:00Z",
    tags: "cli"
  },
  {
    id: 107,
    full_name: "myorg/custom-grepo-fork",
    owner: "myorg",
    name: "custom-grepo-fork",
    description: "Personal tuned fork with advanced indexing and keyboard macros.",
    url: "https://github.com/myorg/custom-grepo-fork",
    language: "TypeScript",
    stars: 128,
    forks: 12,
    topics: ["fork", "tools"],
    kind: "fork",
    archived: false,
    starred_at: "2026-06-10T12:00:00Z",
    tags: "dev"
  },
  {
    id: 108,
    full_name: "me/personal-workbench",
    owner: "me",
    name: "personal-workbench",
    description: "My personal developer workspace scripts and automation routines.",
    url: "https://github.com/me/personal-workbench",
    language: "Shell",
    stars: 15,
    forks: 2,
    topics: ["config", "macos", "dotfiles"],
    kind: "owned",
    archived: false,
    starred_at: "2026-05-01T08:00:00Z",
    tags: "workbench"
  }
];

/* ---------------- 工具 ---------------- */

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text, terms) {
  const safe = escapeHtml(text);
  if (!terms.length) return safe;
  const re = new RegExp("(" + terms.map(escapeRe).join("|") + ")", "gi");
  return safe.replace(re, "<mark>$1</mark>");
}

function fmtNum(n) {
  n = n || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 100000) return Math.round(n / 1000) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function fmtCount(n) {
  return (n || 0).toLocaleString("en-US");
}

function monthKey(s) {
  if (!s) return "";
  const y = String(s).slice(0, 4);
  const m = String(s).slice(5, 7);
  if (!y || !m) return "";
  return y + " 年 " + Number(m) + " 月";
}

function fmtDate(s) {
  return s ? String(s).slice(0, 10) : "";
}

function timeAgo(ts) {
  if (!ts) return "从未同步";
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return "刚刚";
  if (d < 3600) return Math.floor(d / 60) + " 分钟前";
  if (d < 86400) return Math.floor(d / 3600) + " 小时前";
  return Math.floor(d / 86400) + " 天前";
}

/* ---------------- 分片存储 ---------------- */

function allShardKeys() {
  const keys = [];
  for (let i = 0; i < SHARDS; i++) keys.push(shardKey(i));
  return keys;
}

/* 读出全部分片；若发现旧版整块 blob，顺手迁移过去 */
async function loadRepos() {
  const isExt = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  const keys = allShardKeys();
  let got = {};
  try {
    if (isExt) {
      got = await chrome.storage.local.get(keys.concat([K.repos]));
    } else {
      got[K.repos] = JSON.parse(localStorage.getItem(K.repos) || "null");
      for (const k of keys) got[k] = JSON.parse(localStorage.getItem(k) || "null");
    }
  } catch (e) {
    console.warn("存储读取异常:", e);
  }

  const legacy = got[K.repos];
  if (Array.isArray(legacy) && legacy.length) {
    // 迁移：拆进分片，然后删掉老 key
    const buckets = new Map();
    for (const r of legacy) {
      const i = shardOf(r.id);
      if (!buckets.has(i)) buckets.set(i, []);
      buckets.get(i).push(r);
    }
    const obj = {};
    for (let i = 0; i < SHARDS; i++) obj[shardKey(i)] = buckets.get(i) || [];
    await writeRaw(obj);
    await removeRaw([K.repos]);
    return legacy;
  }

  const out = [];
  for (const k of keys) {
    if (Array.isArray(got[k])) out.push(...got[k]);
  }
  return out;
}

function writeRaw(obj) {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    return chrome.storage.local.set(obj);
  }
  try {
    for (const [k, v] of Object.entries(obj)) {
      localStorage.setItem(k, JSON.stringify(v));
    }
  } catch {}
  return Promise.resolve();
}

function removeRaw(keys) {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    return chrome.storage.local.remove(keys);
  }
  try {
    for (const k of keys) localStorage.removeItem(k);
  } catch {}
  return Promise.resolve();
}

/* 只重写给定 id 命中的分片；all=true 时重写全部分片。
 * 分片内容一律取自内存里的 state.repos，所以删除也会自然消失。 */
async function persistRepos(opts = {}) {
  state.syncedAt = Date.now();

  const targets = opts.all
    ? new Set(Array.from({ length: SHARDS }, (_, i) => i))
    : new Set((opts.touched || []).map(shardOf));

  const obj = { [K.syncedAt]: state.syncedAt };

  if (targets.size) {
    for (const i of targets) obj[shardKey(i)] = [];
    for (const r of state.repos) {
      const i = shardOf(r.id);
      if (targets.has(i)) obj[shardKey(i)].push(r);
    }
    // 空分片直接清掉，别留一堆 []
    const empties = [];
    for (const i of targets) {
      if (obj[shardKey(i)].length === 0) {
        delete obj[shardKey(i)];
        empties.push(shardKey(i));
      }
    }
    await removeRaw(empties);
  }

  await writeRaw(obj);
  return {
    shards: targets.size,
    records: state.repos.length,
  };
}

/* ---------------- 存储 ---------------- */

async function loadState() {
  const isExtension = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  let token = "";
  let syncedAt = 0;
  try {
    if (isExtension) {
      const got = await chrome.storage.local.get([K.token, K.syncedAt]);
      token = got[K.token] || "";
      syncedAt = got[K.syncedAt] || 0;
    } else {
      token = localStorage.getItem(K.token) || "";
      syncedAt = Number(localStorage.getItem(K.syncedAt)) || 0;
    }
  } catch (e) {
    console.warn("chrome.storage 读取异常:", e);
  }

  state.token = token;
  state.repos = await loadRepos();
  state.syncedAt = syncedAt;

  // 如果是在独立浏览器/测试脚本中直接打开且无 token，自动装载样本数据供视觉评估
  if (!isExtension && !state.token && (!state.repos || !state.repos.length)) {
    if (!location.hash.includes("setup") && !location.search.includes("setup")) {
      state.token = "demo_mode";
      state.repos = SAMPLE_REPOS;
      state.syncedAt = Date.now() - 420000;
    }
  }
}

async function getStored(key) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const got = await chrome.storage.local.get([key]);
      return got[key];
    }
    return localStorage.getItem(key);
  } catch { return undefined; }
}

async function setStored(key, value) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [key]: value });
    } else {
      localStorage.setItem(key, String(value));
    }
  } catch {}
}

async function getStoredObj(key, fallback) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const got = await chrome.storage.local.get([key]);
      return got[key] !== undefined ? got[key] : fallback;
    }
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function setStoredObj(key, val) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [key]: val });
    } else {
      localStorage.setItem(key, JSON.stringify(val));
    }
  } catch {}
}

async function loadExtras() {
  const [views, quickLinks, readmeCache, aiConfig, cloneMode, searchHistory, vanished, layout, pinned, releases] = await Promise.all([
    getStoredObj(K.views, []),
    getStoredObj(K.quickLinks, null),
    getStoredObj(K.readmeCache, {}),
    getStoredObj(K.aiConfig, null),
    getStored(K.cloneMode),
    getStoredObj(K.searchHistory, []),
    getStoredObj(K.vanished, []),
    getStored(K.layout),
    getStoredObj(K.pinned, []),
    getStoredObj(K.releases, {}),
  ]);
  state.views = Array.isArray(views) ? views : [];
  state.quickLinks = Array.isArray(quickLinks) && quickLinks.length
    ? quickLinks
    : DEFAULT_QUICK_LINKS.slice();
  state.readmeCache = readmeCache && typeof readmeCache === "object" ? readmeCache : {};
  state.aiConfig = aiConfig && typeof aiConfig === "object"
    ? { ...DEFAULT_AI_CONFIG, ...aiConfig }
    : { ...DEFAULT_AI_CONFIG };
  state.cloneMode = cloneMode === "ssh" ? "ssh" : "https";
  state.searchHistory = Array.isArray(searchHistory) ? searchHistory.slice(0, 8) : [];
  state.vanished = Array.isArray(vanished) ? vanished : [];
  state.pinned = Array.isArray(pinned) ? pinned.map((x) => String(x).toLowerCase()) : [];
  state._pinnedSet = new Set(state.pinned);
  state.releases = releases && typeof releases === "object" ? releases : {};
  applyLayout(layout || "list");
  syncCloneModeUI();
}

function isPinned(fullName) {
  if (!fullName) return false;
  if (!state._pinnedSet) state._pinnedSet = new Set(state.pinned || []);
  return state._pinnedSet.has(fullName.toLowerCase());
}

function applyLayout(mode) {
  const m = LAYOUTS.includes(mode) ? mode : "list";
  state.layout = m;
  document.body.classList.toggle("layout-grid", m === "grid");
  document.querySelectorAll("#layoutPick .layout-btn").forEach((b) => {
    const on = b.dataset.layout === m;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  return m;
}

async function saveLayout(mode) {
  const m = applyLayout(mode);
  await setStored(K.layout, m);
}

function syncCloneModeUI() {
  const isSsh = state.cloneMode === "ssh";
  document.querySelectorAll("#cloneModePick button").forEach((b) => {
    const on = b.dataset.clone === state.cloneMode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  const btn = $("repoCopyClone");
  if (btn) {
    btn.textContent = isSsh ? "Clone (SSH)" : "Clone";
    btn.title = isSsh ? "复制 git clone git@github.com:... 命令" : "复制 git clone https://... 命令";
  }
}

async function saveToken(token) {
  state.token = token;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [K.token]: token });
  } else {
    try { localStorage.setItem(K.token, token); } catch {}
  }
}

async function saveRepos(repos, opts = {}) {
  state.repos = repos;
  invalidateFacetCache();
  return persistRepos({ all: opts.all !== false, touched: opts.touched });
}


/* ---------------- 主题与密度 ---------------- */

function applyTheme(name) {
  const t = THEMES.includes(name) ? name : "atelier";
  document.documentElement.dataset.theme = t;
  for (const btn of document.querySelectorAll("#themePick .swatch, #settingsThemes .theme-chip")) {
    btn.setAttribute("aria-checked", btn.dataset.theme === t ? "true" : "false");
  }
  const sw = $("themeMenuSwatch");
  if (sw) sw.dataset.theme = t;
  const menuBtn = $("themeMenuBtn");
  if (menuBtn) menuBtn.title = "配色主题：" + (THEME_NAMES[t] || t);
  return t;
}

async function loadTheme() {
  let saved = "";
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const got = await chrome.storage.local.get([K.theme]);
      saved = got[K.theme] || "";
    } else {
      saved = localStorage.getItem(K.theme) || "";
    }
  } catch {}
  return applyTheme(saved);
}

async function saveTheme(name) {
  applyTheme(name);
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [K.theme]: name });
    } else {
      localStorage.setItem(K.theme, name);
    }
  } catch {}
}

function applyDensity(name) {
  const d = DENSITIES.includes(name) ? name : "comfortable";
  document.documentElement.dataset.density = d;
  for (const btn of document.querySelectorAll("#densityPick button")) {
    const on = btn.dataset.density === d;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  }
  return d;
}

async function loadDensity() {
  const saved = await getStored(K.density);
  return applyDensity(saved || "comfortable");
}

async function saveDensity(name) {
  const d = applyDensity(name);
  await setStored(K.density, d);
}

function closeThemePopover() {
  const pop = $("themePopover");
  if (pop && !pop.classList.contains("hidden")) {
    pop.classList.add("hidden");
    $("themeMenuBtn")?.setAttribute("aria-expanded", "false");
  }
}

function initTheme() {
  const menuBtn = $("themeMenuBtn");
  const pop = $("themePopover");
  if (menuBtn && pop) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = pop.classList.contains("hidden");
      pop.classList.toggle("hidden", !willOpen);
      menuBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#themeMenu")) closeThemePopover();
    });
    window.addEventListener("scroll", closeThemePopover, { passive: true });
  }
  const pick = $("themePick");
  if (pick) {
    pick.addEventListener("click", (e) => {
      const btn = e.target.closest(".swatch");
      if (!btn) return;
      saveTheme(btn.dataset.theme);
      closeThemePopover();
    });
  }
  const settingsThemes = $("settingsThemes");
  if (settingsThemes) {
    settingsThemes.addEventListener("click", (e) => {
      const btn = e.target.closest(".theme-chip");
      if (!btn) return;
      saveTheme(btn.dataset.theme);
    });
  }
  const densityPick = $("densityPick");
  if (densityPick) {
    densityPick.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-density]");
      if (!btn) return;
      saveDensity(btn.dataset.density);
    });
  }
}

/* ---------------- GitHub API ---------------- */

async function api(path, params) {
  const url = new URL("https://api.github.com" + path);
  for (const [k, v] of Object.entries(params || {})) {
    url.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: "Bearer " + state.token,
        Accept: "application/vnd.github.star+json, application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (e) {
    throw new Error("网络请求失败：" + e.message);
  }

  if (!res.ok) {
    if (res.status === 401) throw new Error("token 无效或已过期");
    if (res.status === 403 || res.status === 429) {
      const reset = res.headers.get("X-RateLimit-Reset");
      const remain = res.headers.get("X-RateLimit-Remaining");
      if (remain === "0" && reset) {
        const t = new Date(Number(reset) * 1000);
        throw new Error("API 配额用尽，" + t.toLocaleTimeString() + " 后恢复");
      }
      throw new Error("GitHub 拒绝请求（HTTP " + res.status + "）");
    }
    throw new Error("HTTP " + res.status + " " + res.statusText);
  }
  return res.json();
}

function normalize(repo, kind, starredAt) {
  return {
    id: repo.id,
    full_name: repo.full_name,
    owner: (repo.owner && repo.owner.login) || "",
    name: repo.name || "",
    description: repo.description || "",
    url: repo.html_url || "https://github.com/" + repo.full_name,
    homepage: repo.homepage || "",
    language: repo.language || "",
    stars: repo.stargazers_count || 0,
    forks: repo.forks_count || 0,
    topics: repo.topics || [],
    kind: kind,
    archived: !!repo.archived,
    is_fork: !!repo.fork,
    pushed_at: repo.pushed_at || "",
    updated_at: repo.updated_at || "",
    starred_at: starredAt || "",
    created_at: repo.created_at || "",
    tags: "",
    note: "",
    prev_stars: repo.stargazers_count || 0,
    star_gain: 0,
  };
}

/* 只比会变、且影响展示的字段：内容一样就不必重写它所在的分片 */
function sameRecord(a, b) {
  if (!a || !b) return false;
  return (
    a.full_name === b.full_name &&
    a.description === b.description &&
    a.stars === b.stars &&
    a.forks === b.forks &&
    a.language === b.language &&
    a.pushed_at === b.pushed_at &&
    a.updated_at === b.updated_at &&
    a.archived === b.archived &&
    (a.topics || []).join() === (b.topics || []).join()
  );
}

async function syncAll(onProgress, opts = {}) {
  let full = !!opts.full || !state.repos.length;

  const prevTags = new Map();
  const prevNotes = new Map();
  const prevById = new Map();
  for (const r of state.repos) {
    prevById.set(r.id, r);
    if (r.tags) prevTags.set(r.id, r.tags);
    if (r.note) prevNotes.set(r.id, r.note);
  }

  // 全量：清空后重建；增量：在旧记录上合并，一条也不删
  const byId = full ? new Map() : new Map(prevById);
  const touched = [];

  // 星标水印 = 已有记录里最新的星标时间：新星标一定比它更新
  let starMark = "";
  for (const r of state.repos) {
    if (r.starred_at && r.starred_at > starMark) starMark = r.starred_at;
  }
  // 自有仓库水印 = 上次同步时间往回退一分钟，避开边界
  const ownMark = state.syncedAt
    ? new Date(state.syncedAt - 60 * 1000).toISOString()
    : "";

  let page = 1;
  let nStar = 0;
  let stop = false;

  while (!stop) {
    const data = await api("/user/starred", {
      per_page: 100,
      page,
      sort: "created",
      direction: "desc",
    });
    if (!Array.isArray(data) || !data.length) break;
    if (!full && page === 1 && !data.some((x) => x && x.starred_at)) {
      // 没有 starred_at 就没法倒序早停，宁可退回全量，也不能假装增量
      full = true;
      byId.clear();
      for (const r of prevById.values()) byId.set(r.id, r);
    }
    for (const item of data) {
      const repo = item && item.repo ? item.repo : item;
      if (!repo || !repo.id) continue;
      const at = (item && item.starred_at) || "";
      // 增量下按星标时间倒序，越过水印就不必再往后翻
      if (!full && starMark && at && at <= starMark) {
        stop = true;
        break;
      }
      const prev = prevById.get(repo.id) || {};
      const rec = normalize(repo, "star", at);
      rec.tags = prevTags.get(rec.id) || prev.tags || "";
      rec.note = prevNotes.get(rec.id) || prev.note || "";
      if (prev.stars > 0 && rec.stars > prev.stars) {
        rec.prev_stars = prev.stars;
        rec.star_gain = rec.stars - prev.stars;
      } else if (prev.stars === rec.stars && prev.star_gain) {
        rec.prev_stars = prev.prev_stars || prev.stars;
        rec.star_gain = prev.star_gain;
      }
      byId.set(rec.id, rec);
      if (!sameRecord(prev, rec)) touched.push(rec.id);
      nStar++;
    }
    onProgress({ phase: "star", count: nStar, page, mode: full ? "full" : "incr" });
    if (data.length < 100) break;
    page++;
  }

  page = 1;
  let nFork = 0;
  let nOwn = 0;
  stop = false;

  while (!stop) {
    const data = await api("/user/repos", {
      affiliation: "owner",
      per_page: 100,
      page,
      sort: "updated",
      direction: "desc",
    });
    if (!Array.isArray(data) || !data.length) break;
    for (const repo of data) {
      if (!repo || !repo.id) continue;
      // 增量下按更新时间倒序，越过水印即停
      if (!full && ownMark && repo.updated_at && repo.updated_at < ownMark) {
        stop = true;
        break;
      }
      const prev = prevById.get(repo.id) || {};
      const kind = repo.fork ? "fork" : "owned";
      const rec = normalize(repo, kind, prev.starred_at || null);
      rec.tags = prevTags.get(repo.id) || prev.tags || "";
      rec.note = prevNotes.get(repo.id) || prev.note || "";
      if (prev.stars > 0 && rec.stars > prev.stars) {
        rec.prev_stars = prev.stars;
        rec.star_gain = rec.stars - prev.stars;
      } else if (prev.stars === rec.stars && prev.star_gain) {
        rec.prev_stars = prev.prev_stars || prev.stars;
        rec.star_gain = prev.star_gain;
      }
      byId.set(rec.id, rec);
      if (!sameRecord(prev, rec)) touched.push(rec.id);
      if (kind === "fork") nFork++;
      else nOwn++;
    }
    onProgress({ phase: "own", count: nOwn + nFork, page, mode: full ? "full" : "incr" });
    if (data.length < 100) break;
    page++;
  }

  const repos = Array.from(byId.values());
  // 全量同步差集比对：记录曾收藏但本次从 GitHub 消失的仓库（防止删库/转私有导致标注与线索静默丢失）
  if (full && prevById.size > 0) {
    const vanishedMap = new Map(state.vanished.map((x) => [(x.full_name || "").toLowerCase(), x]));
    let addedVanished = 0;
    for (const [id, old] of prevById.entries()) {
      if (!byId.has(id) && old.full_name) {
        const key = old.full_name.toLowerCase();
        if (!vanishedMap.has(key)) {
          vanishedMap.set(key, {
            full_name: old.full_name,
            url: old.url || `https://github.com/${old.full_name}`,
            description: old.description || "",
            language: old.language || "",
            stars: old.stars || 0,
            tags: old.tags || "",
            note: old.note || "",
            vanished_at: new Date().toISOString(),
            status: "全量同步差集失联",
          });
          addedVanished++;
        }
      }
    }
    if (addedVanished > 0) {
      state.vanished = Array.from(vanishedMap.values()).slice(0, 200);
      await setStoredObj(K.vanished, state.vanished);
    }
  }
  await saveRepos(repos, { all: full, touched });
  return {
    total: repos.length,
    star: nStar,
    fork: nFork,
    own: nOwn,
    full,
    changed: nStar + nFork + nOwn,
  };
}

/* ---------------- 趋势（全站热点） ----------------
 * 直接读 github.com/trending：页面上的「N stars today」就是 GitHub 自己算的涨幅，
 * 所以既不需要本地快照，也不需要自己求差。数据只在内存里缓存，不落盘。
 */

const TREND_CACHE_MS = 5 * 60 * 1000; // 同一份榜单 5 分钟内不重复抓

const TREND_SINCE = { day: "daily", week: "weekly", month: "monthly" };

/* 从 trending 页面里解析出仓库条目 */
function parseTrending(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const num = (t) => Number(String(t == null ? "" : t).replace(/[^\d]/g, "")) || 0;
  const out = [];

  for (const art of doc.querySelectorAll("article.Box-row")) {
    const link = art.querySelector("h2 a[href]");
    if (!link) continue;
    const href = (link.getAttribute("href") || "").replace(/^\//, "");
    if (!/^[^/?#]+\/[^/?#]+$/.test(href)) continue;

    const [owner, name] = href.split("/");
    const p = art.querySelector("p");
    const langEl = art.querySelector('[itemprop="programmingLanguage"]');
    const starsEl = art.querySelector('a[href$="/stargazers"]');
    const forksEl = art.querySelector('a[href$="/forks"]');
    const gainEl = art.querySelector("span.float-sm-right");

    out.push({
      full_name: href,
      owner,
      name,
      description: p ? p.textContent.trim() : "",
      language: langEl ? langEl.textContent.trim() : "",
      stars: num(starsEl ? starsEl.textContent : ""),
      forks: num(forksEl ? forksEl.textContent : ""),
      delta: num(gainEl ? gainEl.textContent : ""),
      url: "https://github.com/" + href,
    });
  }
  return out;
}

/* 兜底：用 Search API 近似出「新建 / 活跃」的热门，虽然没有涨幅数字 */
async function fetchTrendingViaApi(period) {
  const days = period === "month" ? 30 : period === "week" ? 7 : 1;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const q = days <= 1
    ? `pushed:>${since} stars:>500`
    : `created:>${since} stars:>50`;
  const res = await api("/search/repositories", {
    q,
    sort: "stars",
    order: "desc",
    per_page: 50,
  });
  return ((res && res.items) || []).map((r) => ({
    full_name: r.full_name,
    owner: (r.owner && r.owner.login) || "",
    name: r.name || "",
    description: r.description || "",
    language: r.language || "",
    stars: r.stargazers_count || 0,
    forks: r.forks_count || 0,
    delta: null, // API 不给涨幅
    url: r.html_url || "https://github.com/" + r.full_name,
  }));
}

/* 把权限实况压成一行塞进报错，省得让人去开控制台 */
async function diagHosts() {
  const bits = [];
  try {
    if (typeof chrome === "undefined" || !chrome.permissions) {
      bits.push("no-permissions-api");
      return bits.join(" ");
    }
    const api = await chrome.permissions.contains({ origins: ["https://api.github.com/*"] });
    const gh = await chrome.permissions.contains({ origins: ["https://github.com/*"] });
    bits.push("api=" + (api ? 1 : 0));
    bits.push("github=" + (gh ? 1 : 0));
    const all = await chrome.permissions.getAll();
    const declared = (all.origins || []).map((o) => o.replace(/^https?:\/\//, "").replace(/\/$/, ""));
    bits.push("已授予[" + declared.join("|") + "]");
  } catch (e) {
    bits.push("diag-err:" + ((e && e.message) || e));
  }
  return bits.join(" ");
}

async function fetchTrending(period) {
  const since = TREND_SINCE[period] || "daily";
  const url = "https://github.com/trending?since=" + since;
  let res;
  try {
    res = await fetch(url, {
      credentials: "omit",
      headers: { "Accept-Language": "en" }, // 锁定英文，避免本地化影响解析
    });
  } catch (e) {
    const d = await diagHosts();
    throw new Error("无法访问 github.com（" + ((e && e.message) || "未知原因") + "）· " + d);
  }
  if (!res.ok) throw new Error("GitHub 返回 HTTP " + res.status);
  const html = await res.text();
  const items = parseTrending(html);
  if (!items.length) throw new Error("页面结构可能变了，没解析到条目");
  return items;
}

/* 把抓到的条目转成和收藏记录同构的形状，复用同一套行渲染 */
function trendRecords(period) {
  return (state.trendItems || []).map((e) => ({
    id: e.full_name,
    full_name: e.full_name,
    owner: e.owner,
    name: e.name,
    description: e.description,
    url: e.url,
    language: e.language,
    stars: e.stars,
    forks: e.forks,
    topics: [],
    kind: "trend",
    archived: false,
    is_fork: false,
    pushed_at: "",
    updated_at: "",
    starred_at: "",
    created_at: "",
    tags: "",
    delta: e.delta,
  }));
}

function fadeListOut() {
  const el = $("list");
  el.classList.add("is-out");
  return new Promise((r) => setTimeout(r, 160));
}

function fadeListIn() {
  requestAnimationFrame(() => $("list").classList.remove("is-out"));
}

function setView(view) {
  state.view = view === "trend" ? "trend" : "mine";
  const isTrend = state.view === "trend";

  // 趋势本身就是 GitHub 热榜，搜索范围在这里没有意义，回到本地并隐藏范围切换器
  if (isTrend && state.scope === "github") {
    state.scope = "local";
    document.body.classList.remove("scope-github");
    $("q").placeholder = LOCAL_PLACEHOLDER;
    syncScopePillUI("local");
    syncSortOptionsForScope("local");
    // 语言筛选在趋势里仍然有用，是全站模式把它藏起来的，这里要还回去
    $("langSelect").classList.remove("hidden");
    hideSuggest();
  }

  document.body.classList.toggle("view-trend", isTrend);
  $("scopePill").classList.toggle("hidden", isTrend);
  $("tagsMgrBtn")?.classList.toggle("hidden", isTrend);
  $("batchToggleBtn")?.classList.toggle("hidden", isTrend);
  if (isTrend && state.batchMode) setBatchMode(false);

  for (const b of document.querySelectorAll("#viewPick button")) {
    const on = b.dataset.view === state.view;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }
  syncSegThumb($("viewPick"));
  $("tabs").classList.toggle("hidden", isTrend);
  $("periodPick").classList.toggle("hidden", !isTrend);
  requestAnimationFrame(() => {
    syncSegThumb(isTrend ? $("periodPick") : $("tabs"));
    syncSegThumb($("scopePill"));
  });
  $("showArchived").closest(".check").classList.toggle("hidden", isTrend);
  $("sortSelect").classList.toggle("hidden", isTrend);
  $("trendRefresh").classList.toggle("hidden", !isTrend);

  if (isTrend) {
    state.trend = trendRecords(state.period);
    // 页签是「我的收藏」的分类，趋势里没有意义。
    // 不清掉的话，残留的 star/fork/owned 会把趋势行全部过滤成空列表。
    if (state.kind) {
      state.kind = "";
      for (const b of $("tabs").querySelectorAll("button")) {
        b.classList.toggle("on", b.dataset.kind === "");
      }
    }
  }

  buildLangOptions();
  applyFilters();
  if (isTrend) {
    refreshTrendStatus();
    $("stat").classList.add("hidden");
  } else {
    $("trendNote").classList.add("hidden");
    $("stat").classList.remove("hidden");
  }
}

function refreshTrendStatus() {
  const n = (state.trendItems || []).length;
  const el = $("trendNote");
  if (!n) {
    el.textContent = "尚未获取趋势数据";
  } else {
    const t = state.trendAt
      ? new Date(state.trendAt).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "刚刚";
    const src = state.trendSource === "api" ? "API 近似榜（无涨幅）" : "github.com/trending";
    // 条数已经在顶栏「N 热点」里，这里只交代来源和抓取时间
    el.textContent = src + " · " + t + " 更新";
  }
  el.classList.toggle("hidden", state.view !== "trend");
}

async function loadTrending(force) {
  const fresh =
    state.trendAt && Date.now() - state.trendAt < TREND_CACHE_MS && state.trendItems.length;
  if (!force && fresh) {
    state.trend = trendRecords(state.period);
    applyFilters();
    refreshTrendStatus();
    return { cached: true, count: state.trendItems.length };
  }

  const btn = $("trendRefresh");
  const btnLabel = btn.querySelector("span");
  btn.disabled = true;
  if (btnLabel) btnLabel.textContent = "抓取中";
  else btn.textContent = "抓取中";
  state.trendLoading = true;
  if (!state.trendItems.length) applyFilters();
  try {
    const items = await fetchTrending(state.period);
    state.trendLoading = false; // 先落地，后面的渲染才不会被当成“正在抓取”
    state.trendItems = items;
    state.trendAt = Date.now();
    state.trendSource = "trending";
    state.trend = trendRecords(state.period);
    buildLangOptions();
    applyFilters();
    refreshTrendStatus();
    showToast("已抓取 " + fmtCount(items.length) + " 个热门仓库");
    return { cached: false, count: items.length };
  } catch (e) {
    // 抓不到就退回 Search API，至少让用户看到一份近似榜单
    try {
      const items = await fetchTrendingViaApi(state.period);
      state.trendLoading = false;
      state.trendItems = items;
      state.trendAt = Date.now();
      state.trendSource = "api";
      state.trend = trendRecords(state.period);
      buildLangOptions();
      applyFilters();
      refreshTrendStatus();
      showToast("抓取失败，已切到 API 近似榜：" + e.message);
      return { cached: false, count: items.length, fallback: true };
    } catch (e2) {
      showToast(e.message);
      refreshTrendStatus();
      return { error: e.message };
    }
  } finally {
    state.trendLoading = false;
    btn.disabled = false;
    if (btnLabel) btnLabel.textContent = "刷新";
    else btn.textContent = "刷新";
  }
}

async function switchPeriod(period) {
  if (state.period === period) return;
  await fadeListOut();
  state.period = period;
  for (const b of document.querySelectorAll("#periodPick button")) {
    const on = b.dataset.period === period;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }
  syncSegThumb($("periodPick"));
  // 换周期就是换榜单（daily/weekly/monthly），必须重新抓
  state.trendAt = 0;
  state.trend = [];
  state.trendLoading = true; // 直接进加载态，别闪一下“没有匹配的仓库”
  applyFilters();
  fadeListIn();
  await loadTrending(true);
}

/* ---------------- 仓库详情 ---------------- */

let detailRepo = null;

function fmtSize(kb) {
  if (!kb) return "未知";
  return kb >= 1024 ? (kb / 1024).toFixed(1).replace(/\.0$/, "") + " MB" : kb + " KB";
}

function gridHtml(pairs) {
  return pairs
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== "未知")
    .map(([k, v]) =>
      "<div><dt>" + escapeHtml(k) + "</dt><dd>" + escapeHtml(v) + "</dd></div>")
    .join("");
}

/* 先用本地字段撑起弹窗，保证点击立刻有反馈 */
function paintDetail(r, extra) {
  const d = extra || {};
  const ownerName = typeof r.owner === "string"
    ? r.owner
    : (r.owner && r.owner.login ? r.owner.login : (r.full_name || "").split("/")[0]);
  $("repoOwner").textContent = ownerName;
  $("repoTitle").textContent = r.name || (r.full_name || "").split("/").pop();
  $("repoDesc").textContent = r.description || "（无描述）";

  const localRec = findLocal(r.full_name) || r;
  const noteEl = $("repoPersonalNote");
  if (noteEl) {
    const noteText = (localRec && localRec.note) || "";
    noteEl.textContent = noteText ? "个人备注：" + noteText : "";
    noteEl.classList.toggle("hidden", !noteText);
  }

  const qlEl = $("repoQuickLinks");
  if (qlEl && r.full_name) {
    qlEl.innerHTML = (state.quickLinks || DEFAULT_QUICK_LINKS).map((lnk) => {
      const href = String(lnk.url || "").replace(/\{full_name\}/g, r.full_name);
      if (!/^https?:\/\//i.test(href)) return "";
      return '<a class="quick-link-pill" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(lnk.name) + ' ↗</a>';
    }).join("");
  }

  const starsVal = d.stars != null ? d.stars : (r.stars != null ? r.stars : r.stargazers_count);
  const forksVal = d.forks != null ? d.forks : (r.forks != null ? r.forks : r.forks_count);

  $("repoGrid").innerHTML = gridHtml([
    ["星标", fmtCount(starsVal)],
    ["fork", forksVal != null ? fmtCount(forksVal) : ""],
    ["未关闭 issue", d.issues != null ? fmtCount(d.issues) : ""],
    ["语言", d.language || r.language || "未标注"],
    ["许可", d.license || ""],
    ["默认分支", d.branch || ""],
    ["仓库大小", d.size != null ? fmtSize(d.size) : ""],
    ["最近推送", d.pushed ? fmtDate(d.pushed) : (r.pushed_at ? fmtDate(r.pushed_at) : "")],
    ["创建于", d.created ? fmtDate(d.created) : (r.created_at ? fmtDate(r.created_at) : "")],
    ["我收藏于", r.starred_at ? fmtDate(r.starred_at) : ""],
  ]);

  const tags = (r.tags || "").split(/\s+/).filter(Boolean)
    .map((t) => '<span class="t mine" data-filter-tag="' + escapeHtml(t) + '" title="点击按此标签筛选">#' + escapeHtml(t) + "</span>");
  const topics = (d.topics || r.topics || []).slice(0, 14)
    .map((t) => '<span class="t" data-filter-tag="' + escapeHtml(t) + '" title="点击按此 topic 筛选">' + escapeHtml(t) + "</span>");
  $("repoTags").innerHTML = tags.concat(topics).join("");

  const on = isStarred(r);
  const starBtn = $("repoStarBtn");
  if (starBtn) {
    starBtn.classList.toggle("on", on);
    const span = starBtn.querySelector("span");
    if (span) span.textContent = on ? "已 Star" : "Star";
    const svg = starBtn.querySelector("svg");
    if (svg) svg.setAttribute("fill", on ? "currentColor" : "none");
    starBtn.title = on ? "取消 star (s / ⌘Z 撤销)" : "Star 这个仓库 (s)";
  }

  // 置顶版本追踪按钮 + Release 卡片
  const pinBtn = $("repoPinBtn");
  if (pinBtn) {
    const pinned = isPinned(r.full_name);
    pinBtn.classList.toggle("on", pinned);
    pinBtn.textContent = pinned ? "已追踪版本" : "追踪版本";
  }
  const relWrap = $("repoReleaseWrap");
  if (relWrap) {
    const rel = state.releases[(r.full_name || "").toLowerCase()];
    if (rel && rel.tag) {
      $("repoReleaseTag").textContent = rel.tag;
      $("repoReleaseDate").textContent = rel.published_at ? "发布于 " + fmtDate(rel.published_at) : "";
      $("repoReleaseLink").href = rel.url || (r.url + "/releases");
      $("repoReleaseBody").textContent = (rel.body || "无更新日志摘要").slice(0, 460);
      relWrap.classList.remove("hidden");
    } else {
      relWrap.classList.add("hidden");
    }
  }

  // 主详情弹窗：离线推荐本地同类相似收藏
  const simWrap = $("repoSimilarWrap");
  const simList = $("repoSimilarList");
  if (simWrap && simList) {
    const sims = computeSimilarRepos(r, 4);
    if (sims.length) {
      simList.innerHTML = sims.map((x) =>
        `<button type="button" class="similar-card" data-sim-repo="${escapeHtml(x.full_name)}">` +
          `<span class="similar-card-name">${escapeHtml(x.full_name)}</span>` +
          `<span class="similar-card-meta">★ ${fmtNum(x.stars)} · ${escapeHtml(x.language || "未标注")}</span>` +
        `</button>`
      ).join("");
      simWrap.classList.remove("hidden");
    } else {
      simWrap.classList.add("hidden");
      simList.innerHTML = "";
    }
  }
}

/* ---------------- README ---------------- */

/* 取 Markdown 原文：GitHub 会按 Accept 返回不同形态，raw 最安全 */
async function fetchReadme(owner, name) {
  const url =
    "https://api.github.com/repos/" +
    encodeURIComponent(owner) + "/" + encodeURIComponent(name) + "/readme";
  const res = await fetch(url, {
    headers: {
      Authorization: "Bearer " + state.token,
      Accept: "application/vnd.github.raw",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 404) return null; // 这个仓库没有 README
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

/* 相对链接与锚点拼成 GitHub 上的绝对地址，打开弹窗时按仓库填 */
let readmeBase = "";
let readmeRepoUrl = "";
let readmeRawBase = "";

/* 只允许 http(s)/mailto 与站内相对路径，别的协议一律丢弃。
 * 相对路径按当前仓库的默认分支（或 HEAD）拼成 GitHub 绝对地址。 */
function safeHref(raw) {
  const u = String(raw || "").trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^mailto:/i.test(u)) return u;
  if (/^\/\//.test(u)) return "https:" + u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // javascript:/data:/vbscript: …
  if (/^\/[^/]/.test(u)) return "https://github.com" + u;
  if (/^#/.test(u)) {
    return readmeRepoUrl ? (readmeRepoUrl + u) : null;
  }
  if (!readmeBase) return null;
  const cut = u.indexOf("#");
  const path = (cut >= 0 ? u.slice(0, cut) : u).replace(/^\.?\/+/, "");
  const hash = cut >= 0 ? u.slice(cut) : "";
  return path ? (readmeBase + "/" + path + hash) : null;
}

/* 解析图片地址：相对路径自动补全为 GitHub Raw 静态 CDN，绝对路径校验协议并屏蔽高危协议 */
function safeImgSrc(raw) {
  const u = String(raw || "").trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/\//.test(u)) return "https:" + u;
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // 屏蔽 javascript:、vbscript: 等伪协议
  if (/^\/[^/]/.test(u)) {
    return readmeRawBase ? (readmeRawBase + u) : ("https://raw.githubusercontent.com" + u);
  }
  if (!readmeRawBase) return null;
  const cut = u.indexOf("?");
  const path = (cut >= 0 ? u.slice(0, cut) : u).replace(/^\.?\/+/, "");
  const query = cut >= 0 ? u.slice(cut) : "";
  return readmeRawBase + "/" + path + query;
}

function fromCodePoint(n) {
  if (!isFinite(n) || n < 32 || n > 0x10ffff) return "";
  try { return String.fromCodePoint(n); } catch (e) { return ""; }
}

function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&(nbsp|ensp|emsp|thinsp);/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&middot;/gi, "·")
    .replace(/&times;/gi, "×")
    .replace(/&copy;/gi, "©")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&amp;/gi, "&");
}

/* 徽章只显示文字，普通图片显示「图：说明」，两者都不向第三方发起请求，保护隐私与速度 */
function isBadgeUrl(src) {
  return /(shields\.io|badgen\.net|badge\.fury|badge\.buildkite|codecov\.io|coveralls\.io|travis-ci|circleci\.com|img\.badge|atomgitLogo|svg.*badge)/i
    .test(String(src || ""));
}

function extractBadgeLabel(src) {
  const m = String(src || "").match(/badge\/([^-?#]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1].replace(/_/g, " "));
    } catch (e) {
      return m[1];
    }
  }
  const m2 = String(src || "").match(/(github|gitee|atomgit|stars|forks|license|build|release)/i);
  if (m2) return m2[1];
  return "徽章";
}

/* 清洗与预处理 Markdown/HTML：剥离危险标签与事件，把 <img> 转成徽章/图片胶囊，规范 <a> 链接 */
function sanitizeAndFormatHtml(html) {
  let s = String(html || "");

  // 1. 剥离高危标签及其内部内容
  s = s.replace(/<(script|style|iframe|object|embed|form|input|button|svg|math|base|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<(script|style|iframe|object|embed|form|input|button|svg|math|base|link|meta)\b[^>]*\/?>/gi, "");

  // 2. 剥离所有内联 on* 交互事件
  s = s.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 3. 规范 HTML 原生 <a href="..."> 标签（相对路径转 GitHub 绝对链接，屏蔽危险协议，统一新标签页）
  s = s.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
    const hrefMatch = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || "") : "";
    const resolved = safeHref(href);
    const cleanAttrs = attrs
      .replace(/\s+href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s+(target|rel)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    if (!resolved) {
      return `<a${cleanAttrs}>`;
    }
    return `<a href="${escapeHtml(resolved)}" target="_blank" rel="noopener noreferrer"${cleanAttrs}>`;
  });

  // 4. 处理 <img> 标签：补全相对路径，支持真实渲染、懒加载与防追踪
  s = s.replace(/<img\b([^>]*)\/?>/gi, (match, attrs) => {
    const srcMatch = attrs.match(/src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const altMatch = attrs.match(/alt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const widthMatch = attrs.match(/width\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const heightMatch = attrs.match(/height\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const alignMatch = attrs.match(/align\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);

    const src = srcMatch ? (srcMatch[1] || srcMatch[2] || srcMatch[3] || "") : "";
    const alt = altMatch ? (altMatch[1] || altMatch[2] || altMatch[3] || "") : "";
    const width = widthMatch ? (widthMatch[1] || widthMatch[2] || widthMatch[3] || "") : "";
    const height = heightMatch ? (heightMatch[1] || heightMatch[2] || heightMatch[3] || "") : "";
    const align = alignMatch ? (alignMatch[1] || alignMatch[2] || alignMatch[3] || "") : "";

    const resolved = safeImgSrc(src);
    if (!resolved) {
      return `<span class="md-img">〔图：${escapeHtml(alt || "图片")}〕</span>`;
    }

    let extra = "";
    if (width) extra += ` width="${escapeHtml(width)}"`;
    if (height) extra += ` height="${escapeHtml(height)}"`;
    if (align) extra += ` align="${escapeHtml(align)}"`;

    return `<img class="md-rendered-img" src="${escapeHtml(resolved)}" alt="${escapeHtml(alt || "图片")}"${extra} loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
  });

  return s;
}

/* 初始化 marked 实例与自定义 renderer */
let markedInstance = null;
function getMarked() {
  if (markedInstance) return markedInstance;
  const MarkedClass = (typeof marked !== "undefined" && marked.Marked) ? marked.Marked : null;
  if (!MarkedClass) return null;

  markedInstance = new MarkedClass({
    gfm: true,
    breaks: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const lv = Math.min(Math.max(depth, 1), 6);
        const content = tokens ? this.parser.parseInline(tokens) : text;
        return `<h${lv}>${content}</h${lv}>\n`;
      },
      link({ href, title, text, tokens }) {
        const content = tokens ? this.parser.parseInline(tokens) : text;
        const u = safeHref(href);
        if (!u) return content;
        return `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
      },
      image({ href, title, text }) {
        const u = safeImgSrc(href);
        if (!u) {
          return `<span class="md-img">〔图：${escapeHtml(text || "图片")}〕</span>`;
        }
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img class="md-rendered-img" src="${escapeHtml(u)}" alt="${escapeHtml(text || title || "图片")}"${titleAttr} loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
      },
      table(token) {
        const hasHeaderText = token.header.some((h) => h.text && h.text.trim());
        const hasRowText = token.rows.some((r) => r.some((c) => c.text && c.text.trim()));
        if (!hasHeaderText && !hasRowText) return "";

        let html = '<div class="md-table-wrap"><table class="md-table">';
        html += "<thead><tr>";
        for (const cell of token.header) {
          const align = cell.align ? ` align="${cell.align}"` : "";
          html += `<th${align}>${this.parser.parseInline(cell.tokens)}</th>`;
        }
        html += "</tr></thead>";
        if (token.rows.length) {
          html += "<tbody>";
          for (const row of token.rows) {
            html += "<tr>";
            for (const cell of row) {
              const align = cell.align ? ` align="${cell.align}"` : "";
              html += `<td${align}>${this.parser.parseInline(cell.tokens)}</td>`;
            }
            html += "</tr>";
          }
          html += "</tbody>";
        }
        html += "</table></div>";
        return html;
      }
    }
  });
  return markedInstance;
}

/* 渲染 Markdown 内容：采用 marked 工业级解析引擎，彻底解决标签剥离、孤立分隔符与排版失效问题 */
function renderMarkdown(md) {
  if (!md) return "";
  const cleaned = sanitizeAndFormatHtml(String(md));
  const parser = getMarked();

  let html = "";
  if (parser) {
    html = parser.parse(cleaned);
  } else if (typeof marked !== "undefined" && typeof marked.parse === "function") {
    html = marked.parse(cleaned);
  } else {
    // 降级容错：转义输出换行
    html = "<p>" + escapeHtml(cleaned).replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
  }

  // 消除仅包含管道符、空格或实体分隔符的孤立空段落（如 <p>|</p> 或 <p>&nbsp;|&nbsp;</p>）
  html = html.replace(/<p\b[^>]*>\s*(?:[|·/•\s]|&nbsp;)+\s*<\/p>/gi, "");

  return html;
}

async function loadReadmeIntoDialog(r) {
  const wrap = $("repoReadmeWrap");
  const body = $("repoReadme");
  const full = $("repoReadmeFull");

  const [owner, name] = (r.full_name || "").split("/");
  if (!owner || !name) {
    wrap.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");
  body.innerHTML = '<p class="md-note">正在读取 README…</p>';
  full.href = "https://github.com/" + r.full_name + "#readme";

  // README 里的相对链接（./LICENSE、docs/a.md）按这个前缀补成绝对地址
  const defaultBranch = r.branch || r.default_branch || "HEAD";
  readmeRepoUrl = "https://github.com/" + r.full_name;
  readmeBase = "https://github.com/" + r.full_name + "/blob/" + defaultBranch;
  readmeRawBase = "https://raw.githubusercontent.com/" + r.full_name + "/" + defaultBranch;

  let md = null;
  try {
    md = await fetchReadme(owner, name);
  } catch (e) {
    if (detailRepo !== r) return;
    body.innerHTML = '<p class="md-note">README 读取失败：' + escapeHtml(e.message) + "</p>";
    return;
  }
  if (detailRepo !== r) return;

  if (md == null) {
    body.innerHTML = '<p class="md-note">这个仓库没有 README。</p>';
    return;
  }

  // 渐进式本地 README 摘要缓存（不消耗额外 API 配额，日积月累强化全文搜索）
  cacheReadmeExcerpt(r.full_name, md);

  const limit = 20000;
  const trimmed = md.length > limit ? md.slice(0, limit) : md;
  let html = renderMarkdown(trimmed);
  if (md.length > limit) {
    html += '<p class="md-note">（只显示前 ' + limit + ' 字符，完整内容请点上方链接）</p>';
  }
  body.innerHTML = html || '<p class="md-note">README 是空的。</p>';
  // MV3 严禁内联 onerror，改用事件监听处理破图样式
  body.querySelectorAll("img").forEach((img) => {
    img.addEventListener("error", () => img.classList.add("img-broken"), { once: true });
    if (img.complete && img.naturalWidth === 0) img.classList.add("img-broken");
  });
}

function stripReadmeToText(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2400);
}

function cacheReadmeExcerpt(fullName, md, opts = {}) {
  if (!fullName || !md) return;
  const key = fullName.toLowerCase();
  const text = stripReadmeToText(md);
  if (!text) return;
  state.readmeCache[key] = { text, at: Date.now() };
  // LRU 控制最多保留 500 份摘要，避免存储膨胀
  const entries = Object.entries(state.readmeCache);
  if (entries.length > 500) {
    entries.sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
    for (let i = 0; i < entries.length - 500; i++) {
      delete state.readmeCache[entries[i][0]];
    }
  }
  if (opts.persist !== false) {
    setStoredObj(K.readmeCache, state.readmeCache);
  }
}

/* 弹窗打开时让页脚快捷键栏退场，否则会压在卡片下沿 */
function setModalOpen(on) {
  document.body.classList.toggle("modal-open", !!on);
}

let detailLastFocus = null;

async function openRepoDetail(r) {
  if (!r) return;
  if (r.full_name) {
    state.recentViewed = [r.full_name].concat(
      (state.recentViewed || []).filter((x) => x.toLowerCase() !== r.full_name.toLowerCase())
    ).slice(0, 8);
  }
  detailLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  detailRepo = r;
  setModalOpen(true);
  const readOnly = r.kind === "trend" || r.kind === "remote";
  $("repoTagBtn").classList.toggle("hidden", readOnly);
  $("repoNote").textContent = "正在获取最新数据…";
  paintDetail(r);
  $("repoDialog").classList.remove("hidden");
  requestAnimationFrame(() => $("repoClose")?.focus());

  const [owner, name] = (r.full_name || "").split("/");
  if (!owner || !name) {
    $("repoNote").textContent = "本地数据";
    return;
  }

  loadReadmeIntoDialog(r);

  try {
    const d = await api("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name));
    if (detailRepo !== r) return; // 用户已经换了别的仓库
    paintDetail(r, {
      stars: d.stargazers_count,
      forks: d.forks_count,
      issues: d.open_issues_count,
      language: d.language,
      license: d.license && d.license.spdx_id ? d.license.spdx_id : "",
      branch: d.default_branch,
      size: d.size,
      pushed: d.pushed_at,
      created: d.created_at,
      topics: d.topics,
    });
    $("repoNote").textContent = "已从 GitHub 读取最新数据";
  } catch (e) {
    if (detailRepo !== r) return;
    $("repoNote").textContent = "离线数据 · " + e.message;
  }
}

function closeRepoDetail() {
  $("repoDialog").classList.add("hidden");
  detailRepo = null;
  setModalOpen(false);
  if (detailLastFocus && detailLastFocus.isConnected) {
    detailLastFocus.focus();
  }
  detailLastFocus = null;
}

function initRepoDetail() {
  $("repoClose").addEventListener("click", closeRepoDetail);
  $("repoDialog").addEventListener("click", (e) => {
    if (e.target.dataset.close) closeRepoDetail();
  });
  $("repoTags").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter-tag]");
    if (!chip) return;
    const tag = chip.dataset.filterTag;
    closeRepoDetail();
    filterByTag(tag);
  });
  $("repoStarBtn").addEventListener("click", () => {
    if (detailRepo) toggleStar(detailRepo, $("repoStarBtn"));
  });
  $("repoPinBtn")?.addEventListener("click", () => {
    if (detailRepo) togglePinRepo(detailRepo);
  });
  $("repoSimilarList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sim-repo]");
    if (!btn) return;
    const target = findLocal(btn.dataset.simRepo);
    if (target) openRepoDetail(target);
  });
  $("repoSimilarCompareBtn")?.addEventListener("click", () => {
    if (!detailRepo) return;
    const sims = computeSimilarRepos(detailRepo, 3);
    if (!sims.length) return;
    closeRepoDetail();
    runAiCompareRepos([detailRepo].concat(sims));
  });
  $("repoOpen").addEventListener("click", () => {
    if (detailRepo) window.open(detailRepo.url, "_blank", "noopener");
  });
  $("repoCopy").addEventListener("click", async () => {
    if (!detailRepo) return;
    try {
      await navigator.clipboard.writeText(detailRepo.url);
      showToast("已复制链接");
    } catch (e) {
      showToast("复制失败：" + e.message);
    }
  });
  $("repoCopyClone")?.addEventListener("click", async () => {
    if (!detailRepo) return;
    const cmd = state.cloneMode === "ssh"
      ? "git clone git@github.com:" + detailRepo.full_name + ".git"
      : "git clone https://github.com/" + detailRepo.full_name + ".git";
    try {
      await navigator.clipboard.writeText(cmd);
      showToast(state.cloneMode === "ssh" ? "已复制 SSH git clone 命令" : "已复制 HTTPS git clone 命令");
    } catch (e) {
      showToast("复制失败：" + e.message);
    }
  });
  $("repoCopyMd")?.addEventListener("click", async () => {
    if (!detailRepo) return;
    const md = `[${detailRepo.full_name}](${detailRepo.url})`;
    try {
      await navigator.clipboard.writeText(md);
      showToast("已复制 Markdown 链接");
    } catch (e) {
      showToast("复制失败：" + e.message);
    }
  });
  $("repoTagBtn").addEventListener("click", () => {
    const target = detailRepo;
    closeRepoDetail();
    editTags(target);
  });
  $("repoAiBtn")?.addEventListener("click", async () => {
    if (!detailRepo) return;
    const target = detailRepo;
    const btn = $("repoAiBtn");
    btn.disabled = true;
    btn.textContent = "分析中…";
    try {
      const res = await aiAnnotateRepo(target);
      const local = findLocal(target.full_name);
      if (local) {
        const mergedTags = Array.from(new Set(
          ((local.tags || "") + " " + (res.tags || "")).trim().toLowerCase().split(/\s+/).filter(Boolean)
        )).join(" ");
        local.tags = mergedTags;
        if (res.note) local.note = res.note;
        await saveRepos(state.repos, { all: false, touched: [local.id] });
        paintDetail(local);
        applyFilters();
        showToast("已写入 AI 中文备注与标签");
      } else {
        openAiResultDialog(target.full_name + " · AI 解读", "未收藏仓库仅预览，Star 后可保存备注", `**用途摘要**：${res.note || "无"}\n\n**建议标签**：${res.tags || "无"}`);
      }
    } catch (e) {
      showToast(e.message, { isError: true });
    } finally {
      btn.disabled = false;
      btn.textContent = "AI 总结";
    }
  });
  $("repoDialog").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeRepoDetail();
    }
  });
}

/* ---------------- 过滤（支持本地高级查询 DSL + 容错模糊 + README 缓存） ---------------- */

function parseStarNum(raw) {
  const m = String(raw || "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  if (m[2] === "k") return n * 1000;
  if (m[2] === "m") return n * 1000000;
  return n;
}

function cmpNumOp(val, expr) {
  const m = String(expr || "").match(/^(>=|<=|>|<|=)?(.+)$/);
  if (!m) return true;
  const op = m[1] || "=";
  const target = parseStarNum(m[2]);
  if (isNaN(target)) return true;
  if (op === ">") return val > target;
  if (op === ">=") return val >= target;
  if (op === "<") return val < target;
  if (op === "<=") return val <= target;
  return val === target;
}

function cmpDateOp(dateStr, expr) {
  const m = String(expr || "").match(/^(>=|<=|>|<|=)?(.+)$/);
  if (!m) return true;
  const op = m[1] || "=";
  const target = m[2];
  const d = String(dateStr || "").slice(0, target.length);
  if (!d) return false;
  if (op === ">") return d > target;
  if (op === ">=") return d >= target;
  if (op === "<") return d < target;
  if (op === "<=") return d <= target;
  return d.startsWith(target);
}

function parseLocalQuery(raw) {
  const out = {
    terms: [],
    excludeTerms: [],
    langs: [],
    excludeLangs: [],
    tags: [],
    excludeTags: [],
    owners: [],
    stars: [],
    pushed: [],
    starred: [],
    flags: new Set(),
    excludeFlags: new Set(),
    hasDsl: false,
  };
  const tokens = String(raw || "").trim().split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const neg = tok.startsWith("-") && tok.length > 1;
    const body = (neg ? tok.slice(1) : tok);
    const lower = body.toLowerCase();

    if (lower === "archived" && neg) {
      out.excludeFlags.add("archived");
      out.hasDsl = true;
      continue;
    }
    if (body.startsWith("#") && body.length > 1) {
      (neg ? out.excludeTags : out.tags).push(lower.slice(1));
      out.hasDsl = true;
      continue;
    }
    const colon = lower.indexOf(":");
    if (colon > 0 && colon < lower.length - 1) {
      const k = lower.slice(0, colon);
      const v = lower.slice(colon + 1);
      if (k === "lang" || k === "language") {
        (neg ? out.excludeLangs : out.langs).push(v);
        out.hasDsl = true;
        continue;
      }
      if (k === "tag" || k === "topic") {
        (neg ? out.excludeTags : out.tags).push(v);
        out.hasDsl = true;
        continue;
      }
      if (k === "owner" || k === "user" || k === "org") {
        out.owners.push(v);
        out.hasDsl = true;
        continue;
      }
      if (k === "stars" || k === "star") {
        out.stars.push(v);
        out.hasDsl = true;
        continue;
      }
      if (k === "pushed") {
        out.pushed.push(v);
        out.hasDsl = true;
        continue;
      }
      if (k === "starred") {
        out.starred.push(v);
        out.hasDsl = true;
        continue;
      }
      if (k === "has" || k === "no" || k === "is") {
        const flagKey = `${k}:${v}`;
        (neg ? out.excludeFlags : out.flags).add(flagKey);
        out.hasDsl = true;
        continue;
      }
    }
    if (neg) {
      out.excludeTerms.push(lower);
      out.hasDsl = true;
    } else {
      out.terms.push(body);
    }
  }
  return out;
}

function parseOrQuery(raw) {
  const s = String(raw || "").trim();
  if (!s) return [parseLocalQuery("")];
  const parts = s.split(/\s+OR\s+/);
  return parts.map(parseLocalQuery);
}

function visibleTerms() {
  const branches = parseOrQuery($("q").value.trim());
  const seen = new Set();
  const out = [];
  for (const b of branches) {
    for (const t of b.terms) {
      const k = t.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(t); }
    }
  }
  return out;
}

function isRepoStale(r) {
  if (!r.pushed_at) return false;
  const ts = Date.parse(r.pushed_at);
  return isFinite(ts) && (Date.now() - ts) > 730 * 86400000;
}

function stripPunct(s) {
  return String(s || "").toLowerCase().replace(/[-_./\s]+/g, "");
}

/* Damerau-Levenshtein 距离 ≤ 1（O(L)：支持 1 次替换、插入、删除或相邻字符颠倒，如 pyhton/markitdwon） */
function editDistAtMost1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (diff > 0) return false;
    diff = 1;
    // 相邻字符互换（如 markitdwon <-> markitdown）
    if (la === lb && i + 1 < la && a[i] === b[j + 1] && a[i + 1] === b[j]) {
      i += 2; j += 2; continue;
    }
    if (la > lb) i++;
    else if (lb > la) j++;
    else { i++; j++; }
  }
  return true;
}

function fuzzyRepoTokenMatch(r, termLower) {
  const cleanT = stripPunct(termLower);
  if (cleanT.length < 5) return false;
  const candidates = [
    (r.name || "").toLowerCase(),
    stripPunct(r.name),
    (r.owner || "").toLowerCase(),
  ];
  for (const seg of (r.name || "").toLowerCase().split(/[-_./]+/)) {
    if (seg.length >= 4) candidates.push(seg);
  }
  for (const tg of (r.tags || "").toLowerCase().split(/\s+/)) {
    if (tg.length >= 4) candidates.push(tg);
  }
  for (const tp of r.topics || []) {
    const low = String(tp).toLowerCase();
    if (low.length >= 4) candidates.push(low);
  }
  for (const c of candidates) {
    if (c && editDistAtMost1(c, termLower) || (c && editDistAtMost1(c, cleanT))) {
      return true;
    }
  }
  return false;
}

function matchesAnyBranch(r, branches, showArchived, opts) {
  for (const b of branches) {
    if (matches(r, b, showArchived, opts)) return true;
  }
  return false;
}

function matches(r, parsed, showArchived, opts) {
  const ignoreScope = !!(opts && opts.ignoreScope);
  const allowArchived = showArchived || parsed.flags.has("is:archived");
  if (!allowArchived && r.archived) return false;
  if (parsed.excludeFlags.has("archived") && r.archived) return false;
  if (!ignoreScope) {
    if (state.kind && r.kind !== state.kind) return false;
    const langSel = $("lang").value;
    if (langSel && r.language !== langSel) return false;
  }

  const rLang = (r.language || "").toLowerCase();
  for (const l of parsed.langs) {
    if (rLang !== l) return false;
  }
  for (const l of parsed.excludeLangs) {
    if (rLang === l) return false;
  }

  const allTagTokens = (
    (r.tags || "").toLowerCase().split(/\s+/).filter(Boolean)
  ).concat((r.topics || []).map((x) => x.toLowerCase()));
  for (const tg of parsed.tags) {
    if (!allTagTokens.some((x) => x === tg || x.includes(tg))) return false;
  }
  for (const tg of parsed.excludeTags) {
    if (allTagTokens.some((x) => x === tg || x.includes(tg))) return false;
  }

  const rOwner = (r.owner || "").toLowerCase();
  for (const o of parsed.owners) {
    if (rOwner !== o && !rOwner.includes(o)) return false;
  }
  for (const expr of parsed.stars) {
    if (!cmpNumOp(r.stars || 0, expr)) return false;
  }
  for (const expr of parsed.pushed) {
    if (!cmpDateOp(r.pushed_at, expr)) return false;
  }
  for (const expr of parsed.starred) {
    if (!cmpDateOp(r.starred_at || r.created_at, expr)) return false;
  }

  for (const f of parsed.flags) {
    if (f === "has:tag" && !(r.tags || "").trim()) return false;
    if (f === "no:tag" && (r.tags || "").trim()) return false;
    if (f === "has:note" && !(r.note || "").trim()) return false;
    if (f === "no:note" && (r.note || "").trim()) return false;
    if (f === "is:archived" && !r.archived) return false;
    if (f === "is:fork" && r.kind !== "fork" && !r.is_fork) return false;
    if (f === "is:owned" && r.kind !== "owned") return false;
    if (f === "is:stale" && !isRepoStale(r)) return false;
    if (f === "is:rising" && !(r.star_gain > 0)) return false;
    if (f === "is:pinned" && !isPinned(r.full_name)) return false;
  }

  const hay = (
    (r.full_name || "") + " " + (r.description || "") + " " +
    (r.topics || []).join(" ") + " " + (r.tags || "") + " " + (r.note || "")
  ).toLowerCase();

  for (const ex of parsed.excludeTerms) {
    if (hay.includes(ex)) return false;
  }

  if (parsed.terms.length) {
    const termsLower = parsed.terms.map((t) => t.toLowerCase());
    let directOk = true;
    for (const t of termsLower) {
      if (!hay.includes(t)) {
        // 容错去分隔符匹配 + 1 字符拼写纠错（针对仓库名/标签/topic）
        const cleanT = stripPunct(t);
        if (cleanT.length >= 4 && stripPunct(r.full_name).includes(cleanT)) {
          continue;
        }
        if (fuzzyRepoTokenMatch(r, t)) {
          continue;
        }
        directOk = false;
        break;
      }
    }
    if (!directOk) {
      // 若元数据未命中，降级查已缓存的 README 摘要
      const cached = state.readmeCache[(r.full_name || "").toLowerCase()];
      if (!cached || !cached.text) return false;
      const combined = hay + " " + cached.text.toLowerCase();
      for (const t of termsLower) {
        if (!combined.includes(t)) return false;
      }
      if (!ignoreScope) {
        state.readmeHits.add((r.full_name || "").toLowerCase());
      }
    }
  }
  return true;
}

/* 名称层：查询里的每个词都出现在 owner/name 里才算「名字真的对上了」，
 * 只在描述或 topic 里出现的一律排到后面一层 */
function nameTier(r, terms) {
  if (!terms.length) return 1;
  const name = (r.full_name || "").toLowerCase();
  for (const t of terms) {
    if (name.indexOf(t) < 0) return 0;
  }
  return 1;
}

/* ---------------- GitHub 远程搜索 ---------------- */

/* Search API 认证后只有 30 次/分钟：输入防抖 + 结果缓存 + 取消过期请求，
 * 三件事缺一不可，否则随便打几个字就把配额打光。 */
const remoteCache = new Map();
const REMOTE_TTL = 5 * 60 * 1000;
let remoteAbort = null;

function mapRemoteRepo(r) {
  return {
    id: r.id || 0, // 分片按 id % 32 落盘，star 之后要靠它
    full_name: r.full_name,
    owner: (r.owner && r.owner.login) || "",
    name: r.name || "",
    description: r.description || "",
    language: r.language || "",
    stars: r.stargazers_count || 0,
    forks: r.forks_count || 0,
    url: r.html_url,
    created_at: r.created_at,
    updated_at: r.updated_at,
    pushed_at: r.pushed_at,
    topics: r.topics || [],
    branch: r.default_branch || "",
    archived: !!r.archived,
    tags: "",
    kind: "remote",
  };
}

async function searchRemote(q, sort, signal) {
  const key = q + "|" + sort;
  const hit = remoteCache.get(key);
  if (hit && Date.now() - hit.at < REMOTE_TTL) return hit.items;

  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", q);
  url.searchParams.set("per_page", "30");
  // 远程结果没有 starred_at，「最近星标」只能退回相关度排序
  if (sort === "stars") {
    url.searchParams.set("sort", "stars");
    url.searchParams.set("order", "desc");
  } else if (sort === "pushed") {
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");
  }

  let res;
  try {
    res = await fetch(url, {
      signal: signal,
      headers: {
        Authorization: "Bearer " + state.token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error("网络请求失败：" + e.message);
  }

  if (!res.ok) {
    if (res.status === 422) throw new Error("搜索条件无效");
    if (res.status === 403 || res.status === 429) {
      const reset = res.headers.get("X-RateLimit-Reset");
      let when = "";
      if (reset) {
        const sec = Math.max(0, Number(reset) * 1000 - Date.now());
        when = sec > 60000
          ? Math.ceil(sec / 60000) + " 分钟后"
          : Math.max(1, Math.ceil(sec / 1000)) + " 秒后";
      }
      throw new Error(
        "GitHub 搜索配额用尽" + (when ? "，" + when + "再试" : "") + "（每分钟 30 次）"
      );
    }
    throw new Error("搜索失败：HTTP " + res.status);
  }

  const data = await res.json();
  const items = ((data && data.items) || []).map(mapRemoteRepo);
  remoteCache.set(key, { at: Date.now(), items: items });
  return items;
}

function setDebouncing(on) {
  const wrap = document.querySelector(".searchwrap");
  if (wrap) wrap.classList.toggle("is-debouncing", !!on);
}

function setSearchLoading(on) {
  const wrap = document.querySelector(".searchwrap");
  if (wrap) wrap.classList.toggle("is-loading", !!on);
}

async function runRemoteSearch() {
  const q = $("q").value.trim();
  const sort = $("sort").value;

  if (remoteAbort) remoteAbort.abort();

  // 太短的词不值得花一次配额
  if (q.length < 2) {
    state.remote = [];
    state.remoteErr = "";
    state.remoteQuery = "";
    state.remoteLoading = false;
    setDebouncing(false);
    setSearchLoading(false);
    applyFilters();
    return;
  }

  remoteAbort = new AbortController();
  const signal = remoteAbort.signal;

  state.remoteLoading = true;
  state.remoteErr = "";
  state.remote = [];
  setDebouncing(false);
  setSearchLoading(true);
  applyFilters();

  try {
    const items = await searchRemote(q, sort, signal);
    if (signal.aborted) return;
    state.remote = items;
    state.remoteQuery = q;
  } catch (e) {
    if (e.name === "AbortError" || signal.aborted) return;
    state.remote = [];
    state.remoteErr = e.message;
    state.remoteQuery = q;
  } finally {
    if (!signal.aborted) {
      state.remoteLoading = false;
      setSearchLoading(false);
      setDebouncing(false);
      applyFilters();
    }
  }
}

/* ---------------- 搜索建议面板 ---------------- */

const LOCAL_PLACEHOLDER = "搜索仓库、描述、#标签，或输入 lang: / stars:";
const GITHUB_PLACEHOLDER = "搜索整个 GitHub：仓库名、描述或 topic";

let suggestIdx = -1;

function hideSuggest() {
  suggestIdx = -1;
  $("suggest").classList.add("hidden");
}

function syncSearchClear() {
  const hasVal = !!$("q").value;
  const btn = $("searchClear");
  if (btn) btn.classList.toggle("hidden", !hasVal);
  $("searchWrap")?.classList.toggle("has-query", hasVal);
}

function syncScopePillUI(scope) {
  const pill = $("scopePill");
  if (pill) pill.dataset.activeScope = scope;
  document.querySelectorAll("#scopePill .scope-btn").forEach((btn) => {
    const on = btn.dataset.scope === scope;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  });
  syncSegThumb(pill);
}

/* GitHub 远程搜索不支持「最近星标」和「名称」排序：动态调整排序选项语义 */
function syncSortOptionsForScope(scope) {
  const sel = $("sort");
  if (!sel) return;
  const gh = scope === "github";
  const optStarred = sel.querySelector('option[value="starred"]');
  const optName = sel.querySelector('option[value="name"]');
  const optPushed = sel.querySelector('option[value="pushed"]');
  if (optStarred) optStarred.textContent = gh ? "最佳匹配" : "最近星标";
  if (optPushed) optPushed.textContent = gh ? "最近更新" : "最近提交";
  if (optName) {
    optName.hidden = gh;
    optName.disabled = gh;
    if (gh && sel.value === "name") sel.value = "starred";
  }
  $("sortSelect")?._refresh?.();
}

function suggestButtons() {
  const box = $("suggest");
  if (!box || box.classList.contains("hidden")) return [];
  return Array.from(box.querySelectorAll(".suggest-action, .suggest-dsl-item, .suggest-item, .suggest-ai-action"));
}

function recordSearchHistory(raw) {
  const q = String(raw || "").trim();
  if (q.length < 2) return;
  const next = [q].concat(state.searchHistory.filter((x) => x.toLowerCase() !== q.toLowerCase())).slice(0, 8);
  state.searchHistory = next;
  setStoredObj(K.searchHistory, next);
}

function moveSuggest(delta) {
  const btns = suggestButtons();
  if (!btns.length) return false;
  if (suggestIdx >= 0 && btns[suggestIdx]) btns[suggestIdx].classList.remove("is-active");
  if (suggestIdx < 0) suggestIdx = delta > 0 ? 0 : btns.length - 1;
  else suggestIdx = (suggestIdx + delta + btns.length) % btns.length;
  btns[suggestIdx].classList.add("is-active");
  btns[suggestIdx].scrollIntoView({ block: "nearest" });
  return true;
}

function filterByTag(tag) {
  if (!tag) return;
  if (state.view === "trend") setView("mine");
  if (state.scope === "github") setScope("local");
  const qEl = $("q");
  qEl.value = tag;
  syncSearchClear();
  hideSuggest();
  applyFilters();
  window.scrollTo({ top: 0, behavior: "smooth" });
  qEl.focus();
}

/* ---------------- Star / 取消 Star ---------------- */

/* 收藏状态查得频繁（每行都要问一次），缓存成 Set，长度变了就重建 */
function starredSet() {
  if (!state._starredSet || state._starredSize !== state.repos.length) {
    state._starredSet = new Set(
      state.repos.map((x) => (x.full_name || "").toLowerCase())
    );
    state._starredSize = state.repos.length;
  }
  return state._starredSet;
}

function isStarred(r) {
  if (!r || !r.full_name) return false;
  return starredSet().has(r.full_name.toLowerCase());
}

function findLocal(fullName) {
  if (!fullName) return null;
  const key = fullName.toLowerCase();
  for (const r of state.repos) {
    if ((r.full_name || "").toLowerCase() === key) return r;
  }
  return null;
}

/* 搜索结果转成本地星标记录，字段与同步下来的结构对齐 */
function toLocalRecord(r) {
  return {
    id: r.id,
    full_name: r.full_name,
    owner: r.owner || "",
    name: r.name || "",
    description: r.description || "",
    language: r.language || "",
    stars: r.stars || 0,
    forks: r.forks || 0,
    url: r.url,
    topics: r.topics || [],
    tags: "",
    kind: "star",
    starred_at: new Date().toISOString(),
    created_at: r.created_at,
    updated_at: r.updated_at,
    pushed_at: r.pushed_at,
    branch: r.branch || "",
    archived: !!r.archived,
  };
}

/* 趋势数据只有 full_name 当 id，落盘前必须换成真实的数字 id，
 * 否则会写进 0 号分片，和同步下来的同一条记录分家。 */
async function fetchRepoRecord(owner, name) {
  const res = await fetch(
    "https://api.github.com/repos/" +
      encodeURIComponent(owner) + "/" + encodeURIComponent(name),
    {
      headers: {
        Authorization: "Bearer " + state.token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) return null;
  const d = await res.json();
  return {
    id: d.id,
    full_name: d.full_name,
    owner: (d.owner && d.owner.login) || "",
    name: d.name,
    description: d.description || "",
    language: d.language || "",
    stars: d.stargazers_count || 0,
    forks: d.forks_count || 0,
    url: d.html_url,
    topics: d.topics || [],
    tags: "",
    kind: "star",
    starred_at: new Date().toISOString(),
    created_at: d.created_at,
    updated_at: d.updated_at,
    pushed_at: d.pushed_at,
    branch: d.default_branch || "",
    archived: !!d.archived,
  };
}

/* 真正调用 GitHub 的 star 接口；采用 1-Click 乐观更新 + 弹性 Pop 动效 + 撤销 (Undo) 保护 */
async function toggleStar(r, btn, { isUndo = false } = {}) {
  if (!r || !r.full_name) return;
  const [owner, name] = r.full_name.split("/");
  if (!owner || !name) return;
  if (!state.token || state.token === "demo_mode") return showSetup();

  const existing = findLocal(r.full_name);
  const starred = !!existing;
  const willStar = !starred;
  const shortName = r.name || name || r.full_name;

  // 1. 乐观更新本地内存数据与缓存
  const backupRepos = state.repos.slice();
  const backupStarredSet = state._starredSet;

  if (willStar) {
    let rec = toLocalRecord(r);
    if (typeof rec.id !== "number" || !rec.id) {
      rec.id = Date.now(); // 临时 ID 供本地索引与分片感知
    }
    state.repos.push(rec);
  } else {
    state.repos = state.repos.filter(
      (x) => (x.full_name || "").toLowerCase() !== r.full_name.toLowerCase()
    );
  }
  state._starredSet = null;

  // 2. 界面视图即时响应 (按钮状态、Pop 动效、星标数字空心/实心、标签按钮联动)
  function syncStarVisuals(on, withPop = false) {
    // 列表卡片按钮与星标数字前缀图标
    document.querySelectorAll('.row').forEach((row) => {
      const rowRepo = state.filtered[Number(row.dataset.idx)];
      if (!rowRepo || (rowRepo.full_name || "").toLowerCase() !== r.full_name.toLowerCase()) {
        return;
      }

      // 1. 同步操作按钮
      const b = row.querySelector('button[data-act="star"]');
      if (b) {
        b.classList.toggle("on", on);
        const s = b.querySelector("span");
        if (s) s.textContent = on ? "已 Star" : "Star";
        const svg = b.querySelector("svg");
        if (svg) svg.setAttribute("fill", on ? "currentColor" : "none");
        b.title = on ? "取消 star (⌘Z 撤销)" : "Star 这个仓库 (s)";
        if (withPop && on) {
          b.classList.add("pop");
          setTimeout(() => b.classList.remove("pop"), 400);
        }
      }

      // 2. 同步星标数字前的星星图标 (没有 star 是空心，star 了是实心)
      const countStar = row.querySelector('.stars .star-icon');
      if (countStar) {
        countStar.classList.toggle("is-starred", on);
        countStar.classList.toggle("is-unstarred", !on);
        if (on) {
          countStar.setAttribute("fill", "currentColor");
          countStar.removeAttribute("stroke");
          countStar.removeAttribute("stroke-width");
          countStar.innerHTML = '<path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/>';
          if (withPop) {
            countStar.classList.add("pop");
            setTimeout(() => countStar.classList.remove("pop"), 400);
          }
        } else {
          countStar.setAttribute("fill", "none");
          countStar.setAttribute("stroke", "currentColor");
          countStar.setAttribute("stroke-width", "1.6");
          countStar.setAttribute("stroke-linejoin", "round");
          countStar.innerHTML = '<path d="M8 1.9l1.92 3.9 4.3.63-3.11 3.03.73 4.28L8 11.72l-3.84 2.02.73-4.28L1.78 6.43l4.3-.63z"/>';
        }
      }

      // 3. 同步 "已收藏" 徽章
      if (state.view === "trend" || rowRepo.kind === "remote") {
        let badge = row.querySelector(".kind-saved");
        if (on && !badge) {
          const head = row.querySelector(".row-head");
          if (head) {
            badge = document.createElement("span");
            badge.className = "kind kind-saved";
            badge.title = "已在你的本地收藏中";
            badge.innerHTML = '<svg class="kind-icon" viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/></svg>已收藏';
            head.appendChild(badge);
          }
        } else if (!on && badge) {
          badge.remove();
        }
      }
    });

    // 弹窗按钮
    if (detailRepo && (detailRepo.full_name || "").toLowerCase() === r.full_name.toLowerCase()) {
      const db = $("repoStarBtn");
      if (db) {
        db.classList.toggle("on", on);
        const s = db.querySelector("span");
        if (s) s.textContent = on ? "已 Star" : "Star";
        const svg = db.querySelector("svg");
        if (svg) svg.setAttribute("fill", on ? "currentColor" : "none");
        db.title = on ? "取消 star (s / ⌘Z 撤销)" : "Star 这个仓库 (s)";
        if (withPop && on) {
          db.classList.add("pop");
          setTimeout(() => db.classList.remove("pop"), 400);
        }
      }
      if (on) {
        $("repoTagBtn")?.classList.remove("hidden");
      }
    }
  }

  syncStarVisuals(willStar, true);
  if (willStar && btn) spawnStarburst(btn);
  updateTabCounts();
  buildLangOptions();

  // 若在本地收藏视图取消 star，实时刷新列表
  if (state.scope === "local" && state.view === "mine") {
    applyFilters();
  }

  // 3. 给出即时 Toast 提示（取消 Star 支持 1 键撤销）
  if (willStar) {
    showToast("已 Star · " + shortName);
  } else {
    showToast("已取消 Star · " + shortName, {
      actionText: "撤销 (⌘Z)",
      onAction: () => toggleStar(r, btn, { isUndo: true }),
    });
  }

  if (btn) btn.disabled = true;

  // 4. 后台发起真实网络请求
  const url = "https://api.github.com/user/starred/" +
    encodeURIComponent(owner) + "/" + encodeURIComponent(name);

  try {
    const res = await fetch(url, {
      method: willStar ? "PUT" : "DELETE",
      headers: {
        Authorization: "Bearer " + state.token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error("token 无效或已过期");
      if (res.status === 403) {
        throw new Error("token 缺少 star 权限，需要勾选 public_repo（私有库还要 repo）");
      }
      if (res.status === 404) throw new Error("仓库不存在或无权访问");
      throw new Error("GitHub 操作失败：HTTP " + res.status);
    }

    if (willStar) {
      let rec = toLocalRecord(r);
      if (typeof rec.id !== "number" || !rec.id) {
        const full = await fetchRepoRecord(owner, name);
        if (full) rec = full;
      }
      if (typeof rec.id === "number" && rec.id) {
        state.repos = state.repos.filter(
          (x) => (x.full_name || "").toLowerCase() !== r.full_name.toLowerCase()
        );
        state.repos.push(rec);
        await saveRepos(state.repos, { all: false, touched: [rec.id] });
      }
    } else {
      if (existing && existing.id) {
        await saveRepos(state.repos, { all: false, touched: [existing.id] });
      }
    }
  } catch (e) {
    // 失败回滚
    state.repos = backupRepos;
    state._starredSet = backupStarredSet;
    syncStarVisuals(!willStar, false);
    updateTabCounts();
    buildLangOptions();
    applyFilters();
    showToast("操作失败已回滚：" + e.message, { isError: true });
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* 面板里的本地命中：和列表用的是同一套匹配规则（含 DSL、OR、1 字符拼写容错），但独立于当前范围 */
function localMatches(q, limit) {
  const branches = parseOrQuery(q);
  const branchTerms = branches.map((b) => b.terms.map((t) => t.toLowerCase()));
  const hasAnyTerms = branchTerms.some((ts) => ts.length > 0);
  const first = [];
  const rest = [];
  for (const r of state.repos) {
    if (!r.full_name) continue;
    if (!matchesAnyBranch(r, branches, true, { ignoreScope: true })) continue;
    const isNameHit = !hasAnyTerms || branchTerms.some((ts) => ts.length > 0 && nameTier(r, ts));
    if (isNameHit) {
      first.push(r);
      if (first.length >= limit) break; // 名称命中已经够填满面板
    } else if (rest.length < limit) {
      rest.push(r);
    }
  }
  return first.concat(rest).slice(0, limit);
}

function renderSuggest() {
  const box = $("suggest");
  const q = $("q").value.trim();
  const gh = state.scope === "github";

  if (!q && !gh) {
    if (!state.searchHistory.length || state.view === "trend") {
      hideSuggest();
      return;
    }
    let histHtml = '<div class="suggest-hist-head"><span>最近搜索</span>' +
      '<button type="button" class="link-btn" data-act="clear-history">清空</button></div>';
    for (const h of state.searchHistory) {
      histHtml += '<button type="button" class="suggest-item" data-history="' + escapeHtml(h) + '">' +
        '<span class="suggest-name">' + escapeHtml(h) + '</span>' +
        '<span class="suggest-go">回填</span></button>';
    }
    suggestIdx = -1;
    box.innerHTML = histHtml;
    box.classList.remove("hidden");
    return;
  }

  const hits = q ? localMatches(q, 6) : [];
  let html = "";

  const iconSearch =
    '<svg class="suggest-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
    '<circle cx="6.8" cy="6.8" r="4.6"/><line x1="10.4" y1="10.4" x2="14" y2="14" stroke-linecap="round"/></svg>';
  const iconBack =
    '<svg class="suggest-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
    '<path d="M6.5 4L2.5 8l4 4M2.5 8H13" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  if (gh) {
    html += '<button type="button" class="suggest-action" data-act="scope-local">' +
      iconBack +
      '<span class="suggest-q">只看本地收藏</span>' +
      '<span class="suggest-goto">' + fmtCount(state.repos.length) + " 个</span></button>";
  } else {
    html += '<button type="button" class="suggest-action" data-act="scope-github">' +
      iconSearch +
      '<span class="suggest-q">' + escapeHtml(q) + "</span>" +
      '<span class="suggest-goto">搜索整个 GitHub</span></button>';
  }

  // DSL 语法自动补全（仅在末尾 token 为语法前缀时出现，绝不干扰常规关键词搜索）
  const dslItems = !gh && state.view !== "trend" ? buildDslAutocomplete($("q").value) : [];
  if (dslItems.length) {
    html += '<div class="suggest-dsl-head">高级语法补全</div>';
    for (const d of dslItems) {
      html += '<button type="button" class="suggest-dsl-item" data-dsl-insert="' + escapeHtml(d.insert) + '">' +
        '<span class="suggest-dsl-code">' + escapeHtml(d.label) + '</span>' +
        '<span class="suggest-dsl-desc">' + escapeHtml(d.desc) + '</span></button>';
    }
  }

  if (hits.length) {
    html += '<div class="suggest-label">仓库</div>';
    for (const r of hits) {
      const shortName = r.full_name.slice(r.owner ? r.owner.length + 1 : 0);
      html += '<button type="button" class="suggest-item" data-name="' +
        escapeHtml(r.full_name) + '">' +
        '<span class="suggest-name"><span class="owner">' +
          escapeHtml(r.owner || "") + (r.owner ? " / " : "") + "</span>" +
          '<span class="repo">' + escapeHtml(shortName) + "</span></span>" +
        '<span class="suggest-go">打开</span></button>';
    }
  } else if (q) {
    html += '<div class="suggest-empty">本地没有匹配的收藏</div>';
  }

  // 常驻 AI 语义找库入口（置于底部，不干扰顶部「搜索整个 GitHub」）
  if (q && !gh && state.view !== "trend") {
    html += '<button type="button" class="suggest-ai-action" data-act="ai-semantic-suggest">' +
      '<span>用 AI 语义找库：「' + escapeHtml(q.slice(0, 28)) + '」</span>' +
      '<span class="suggest-goto">语义重排</span></button>';
  }

  suggestIdx = -1;
  box.innerHTML = html;
  box.classList.remove("hidden");
}

/* 切换搜索范围：本地只筛已索引的仓库，GitHub 走 Search API 搜全站 */
function setScope(next) {
  const scope = next === "github" ? "github" : "local";
  if (state.scope === scope) return;
  state.scope = scope;

  const gh = scope === "github";
  document.body.classList.toggle("scope-github", gh);
  $("q").placeholder = gh ? GITHUB_PLACEHOLDER : LOCAL_PLACEHOLDER;
  hideSuggest();

  // 同步 scopePill 按钮高亮与无障碍状态、远程排序语义
  syncScopePillUI(scope);
  syncSortOptionsForScope(scope);

  // 这几个都是本地索引的概念，搜全站时没有意义
  $("tabs").classList.toggle("hidden", gh);
  $("langSelect").classList.toggle("hidden", gh);
  $("showArchived").closest(".check").classList.toggle("hidden", gh);
  $("tagsMgrBtn")?.classList.toggle("hidden", gh);
  $("batchToggleBtn")?.classList.toggle("hidden", gh);
  if (gh && state.batchMode) setBatchMode(false);

  state.remote = [];
  state.remoteErr = "";
  state.remoteQuery = "";
  state.remoteLoading = false;
  setDebouncing(false);
  setSearchLoading(false);

  if (gh && $("q").value.trim()) runRemoteSearch();
  else applyFilters();
}

function applyFilters() {
  // GitHub 模式下列表就是远程结果本身，本地筛选规则一概不套
  if (state.scope === "github") {
    state.filtered = state.remote.slice();
    state.shown = 0;
    state.sel = -1;
    renderList(true);
    updateStatus();
    return;
  }

  const branches = parseOrQuery($("q").value.trim());
  const terms = visibleTerms().map((t) => t.toLowerCase());
  const showArchived = $("showArchived").checked;
  const sort = $("sort").value;

  const isTrend = state.view === "trend";
  const source = isTrend ? state.trend : state.repos;
  state.readmeHits = new Set();

  const out = [];
  for (const r of source) {
    if (matchesAnyBranch(r, branches, showArchived)) out.push(r);
  }

  if (isTrend && sort !== "stars" && sort !== "name") {
    out.sort((a, b) => (b.delta || 0) - (a.delta || 0) || b.stars - a.stars);
  } else if (sort === "stars") out.sort((a, b) => b.stars - a.stars);
  else if (sort === "name") out.sort((a, b) => a.full_name.localeCompare(b.full_name));
  else if (sort === "pushed") {
    out.sort((a, b) => String(b.pushed_at).localeCompare(String(a.pushed_at)));
  } else {
    out.sort((a, b) =>
      String(b.starred_at || b.created_at).localeCompare(String(a.starred_at || a.created_at))
    );
  }

  // 有查询词时：名称命中 > 描述/标签/备注命中 > 缓存 README 命中
  if (terms.length) {
    const rankOf = (r) => {
      if (nameTier(r, terms)) return 2;
      if (state.readmeHits.has((r.full_name || "").toLowerCase())) return 0;
      return 1;
    };
    out.sort((a, b) => rankOf(b) - rankOf(a));
  }

  state.filtered = out;
  state.shown = 0;
  state.sel = -1;
  renderList(true);
  updateStatus();
  renderFilterPills();
  if (state.batchMode) updateBatchBar();
  if (state.peekOpen && state.filtered.length) {
    openPeekForRepo(state.filtered[0], { immediate: false });
  }
}

/* 空态里的一键复位：清掉搜索词与语言筛选，页签保留用户自己选的分类 */
function resetFilters() {
  $("q").value = "";
  syncSearchClear();
  const lang = $("lang");
  if (lang.value) {
    lang.value = "";
    $("langSelect")?._refresh?.();
  }
  applyFilters();
  $("q").focus();
}

/* ---------------- 渲染 ---------------- */

function starButtonHtml(on) {
  return '<button type="button" class="row-act row-star' + (on ? ' on' : '') + '" ' +
    'data-act="star" title="' + (on ? '取消 star (⌘Z 撤销)' : 'Star 这个仓库 (s)') + '">' +
    '<svg viewBox="0 0 16 16" width="11" height="11" fill="' + (on ? 'currentColor' : 'none') +
      '" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">' +
      '<path d="M8 1.9l1.92 3.9 4.3.63-3.11 3.03.73 4.28L8 11.72l-3.84 2.02.73-4.28L1.78 6.43l4.3-.63z"/>' +
    '</svg>' +
    '<span>' + (on ? '已 Star' : 'Star') + '</span>' +
  '</button>';
}

function itemHtml(r, idx) {
  const terms = visibleTerms();
  const shortName = r.full_name.slice(r.owner ? r.owner.length + 1 : 0);

  const tags = [];
  for (const t of (r.tags || "").split(/\s+/).filter(Boolean)) {
    tags.push('<span class="t mine" data-filter-tag="' + escapeHtml(t) + '" title="点击按此标签筛选">#' + escapeHtml(t) + "</span>");
  }
  for (const t of (r.topics || []).slice(0, 8)) {
    tags.push('<span class="t" data-filter-tag="' + escapeHtml(t) + '" title="点击按此 topic 筛选">' + escapeHtml(t) + "</span>");
  }
  if (r.archived) tags.push('<span class="t archived">已归档</span>');
  if (state.readmeHits && state.readmeHits.has((r.full_name || "").toLowerCase())) {
    tags.push('<span class="t readme-hit" title="通过已缓存的本地 README 文本命中">README 命中</span>');
  }
  if (r.kind !== "trend" && r.star_gain > 0) {
    tags.push('<span class="t rising-pill" title="相比上次同步新增星标">+' + fmtNum(r.star_gain) + ' 近期上涨</span>');
  }
  const pinned = isPinned(r.full_name);
  const relInfo = pinned ? state.releases[(r.full_name || "").toLowerCase()] : null;
  if (pinned) {
    tags.push('<span class="pin-badge" title="已置顶追踪最新 Release">置顶追踪</span>');
    if (relInfo && relInfo.tag) {
      tags.push('<span class="release-pill" title="最新 Release · ' + escapeHtml(fmtDate(relInfo.published_at)) + '">' + escapeHtml(relInfo.tag) + '</span>');
    }
  }

  const sortMode = $("sort").value;
  const byPushed = sortMode === "pushed" && r.pushed_at;
  const date = byPushed ? r.pushed_at : (r.starred_at || r.pushed_at);
  const dateTitle = byPushed
    ? "最近提交：" + fmtDate(date)
    : (r.starred_at ? "收藏于：" + fmtDate(r.starred_at) : (r.pushed_at ? "最近提交：" + fmtDate(r.pushed_at) : ""));
  const lang = r.language || "";

  let kindBadge = "";
  // 趋势与远程结果都要提示"这个库你其实已经收藏了"
  if (state.view === "trend" || r.kind === "remote") {
    const isSaved = isStarred(r);
    if (isSaved) {
      kindBadge = '<span class="kind kind-saved" title="已在你的本地收藏中">' +
        '<svg class="kind-icon" viewBox="0 0 16 16" width="10" height="10" fill="currentColor">' +
          '<path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/>' +
        '</svg>已收藏</span>';
    }
  } else if (r.kind === "fork") {
    kindBadge = '<span class="kind kind-fork">' +
      '<svg class="kind-icon" viewBox="0 0 16 16" width="11" height="11" fill="currentColor">' +
        '<path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h4.5A2.25 2.25 0 0 0 12.5 6.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878zm7.5-2.122a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zM5 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 2.122a2.25 2.25 0 1 0-1.5 0v-4.5a.75.75 0 0 1 1.5 0v4.5z"/>' +
      '</svg>fork</span>';
  } else if (r.kind === "owned") {
    kindBadge = '<span class="kind kind-owned"><span class="owned-dot"></span>自建</span>';
  }

  const starred = isStarred(r);
  const countStarSvg = starred
    ? '<svg class="star-icon is-starred" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">' +
        '<path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/>' +
      '</svg>'
    : '<svg class="star-icon is-unstarred" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">' +
        '<path d="M8 1.9l1.92 3.9 4.3.63-3.11 3.03.73 4.28L8 11.72l-3.84 2.02.73-4.28L1.78 6.43l4.3-.63z"/>' +
      '</svg>';

  const langDot = lang ? '<span class="lang-dot" data-lang="' + escapeHtml(lang) + '"></span>' : '';
  const langColor = LANG_COLORS[lang] || "transparent";
  const stagger = Math.min(idx % PAGE_SIZE, 12);
  const checked = state.batchMode && state.batchSelected.has(r.id);
  const starTierCls = (r.stars || 0) >= 50000 ? " is-legend" : ((r.stars || 0) >= 10000 ? " is-mega" : "");

  return (
    '<article class="row' + (r.kind === 'remote' ? ' is-remote' : '') + (checked ? ' is-checked' : '') + '" data-idx="' + idx + '" style="--stagger:' + stagger + ';--lang-color:' + langColor + '">' +
      '<div class="row-main">' +
        '<div class="row-head">' +
          '<input type="checkbox" class="row-check" aria-label="选择仓库"' + (checked ? ' checked' : '') + '>' +
          '<a class="repo-link" href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' +
            '<span class="owner">' + escapeHtml(r.owner) + (r.owner ? " / " : "") + "</span>" +
            '<span class="repo">' + highlight(shortName, terms) + "</span>" +
          "</a>" +
          kindBadge +
        "</div>" +
        '<p class="desc">' + highlight(r.description || "（无描述）", terms) + "</p>" +
        (r.note ? '<p class="row-note">' + highlight(r.note, terms) + "</p>" : "") +
        (tags.length ? '<div class="tags">' + tags.join("") + "</div>" : "") +
      "</div>" +
      '<div class="row-meta">' +
        '<div class="row-meta-stats">' +
          (r.delta != null && r.delta > 0
            ? '<span class="delta">+' + fmtNum(r.delta) + "</span>"
            : "") +
          '<span class="stars' + starTierCls + '" title="' + (starred ? '已在本地收藏 · ' : '') + '总星标数：' + fmtCount(r.stars) + '">' + countStarSvg + fmtNum(r.stars) + "</span>" +
          '<div class="row-sub">' +
            '<span class="lang">' + langDot + escapeHtml(lang || "未标注") + "</span>" +
            (date ? '<span class="row-sub-sep">·</span><span class="date" title="' + escapeHtml(dateTitle) + '">' + fmtDate(date) + "</span>" : "") +
          "</div>" +
        "</div>" +
        '<div class="row-actions">' +
          '<button type="button" class="row-act" data-act="copy" title="复制链接 (⌘↵)">' +
            '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"/></svg>' +
            '<span>复制</span>' +
          '</button>' +
          // 远程与趋势结果都不在本地库里，没有标签可改；
          // 星标状态一律按「是否已收藏」算，不能写死，否则没收藏的会显示「取消」
          (r.kind === "remote" || r.kind === "trend" ?
            starButtonHtml(starred)
            :
            '<button type="button" class="row-act" data-act="tag" title="编辑标签 (t)">' +
              '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5l5 5 6-6V2.5H8.5l-6 6z"/><circle cx="10.5" cy="5.5" r="0.8" fill="currentColor"/></svg>' +
              '<span>标签</span>' +
            '</button>' + starButtonHtml(starred)) +
          '<button type="button" class="row-act" data-act="detail" title="查看详情与 README">' +
            '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 7v4.5M8 4.75v.5"/></svg>' +
            '<span>详情</span>' +
          '</button>' +
        '</div>' +
      "</div>" +
    "</article>"
  );
}

function renderList(reset) {
  const main = $("list");
  if (reset) {
    main.innerHTML = "";
    state.shown = 0;
    state.lastMonth = "";
    state.lastTier = null;
  }

  if (!state.filtered.length) {
    // 空态在剩余空间里居中，别让它吊在页面顶部、下面留一大片空白
    main.classList.add("is-empty");
    if (state.view === "trend" && state.trendLoading) {
      main.innerHTML =
        '<div class="list-hint">正在抓取 github.com/trending…</div>';
      state.shown = 0;
      return;
    }

    if (state.scope === "github") {
      if (state.remoteLoading) {
        main.innerHTML = '<div class="list-hint">正在搜索 GitHub…</div>';
      } else if (state.remoteErr) {
        main.innerHTML = '<div class="empty">搜索没成功' +
          "<span>" + escapeHtml(state.remoteErr) + "</span>" +
          '<button type="button" class="btn empty-reset" data-act="retry-remote">' +
            "重试</button></div>";
      } else if (!state.remoteQuery) {
        main.innerHTML = '<div class="empty empty-gh-guide">' +
          '<div class="empty-gh-icon">' +
            '<svg viewBox="0 0 16 16" width="28" height="28" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>' +
          '</div>' +
          '<h3 class="empty-gh-title">搜索整个 GitHub 开源世界</h3>' +
          '<p class="empty-gh-subtitle">实时检索 GitHub 全站数亿公开仓库，支持高级过滤语法：</p>' +
          '<div class="empty-gh-chips">' +
            '<button type="button" class="gh-chip" data-query="stars:>5000 language:rust">' +
              '<code>stars:&gt;5000 language:rust</code>' +
              '<span>高星 Rust 库</span>' +
            '</button>' +
            '<button type="button" class="gh-chip" data-query="topic:generative-ai stars:>1000">' +
              '<code>topic:generative-ai</code>' +
              '<span>生成式 AI</span>' +
            '</button>' +
            '<button type="button" class="gh-chip" data-query="awesome in:name">' +
              '<code>awesome in:name</code>' +
              '<span>Awesome 资源汇总</span>' +
            '</button>' +
            '<button type="button" class="gh-chip" data-query="language:typescript pushed:>2026-01-01">' +
              '<code>language:typescript pushed:&gt;...</code>' +
              '<span>活跃 TS 项目</span>' +
            '</button>' +
          '</div>' +
        '</div>';
      } else {
        main.innerHTML = '<div class="empty">GitHub 上没有匹配的仓库' +
          "<span>换个关键词试试，或点搜索框右侧切回本地收藏</span></div>";
      }
      state.shown = 0;
      return;
    }

    const qVal = $("q").value.trim();
    if (qVal) {
      main.innerHTML = '<div class="empty">本地没有匹配的仓库' +
        '<span>本地未找到包含 “' + escapeHtml(qVal) + '” 的项目（支持 <code>lang:rust</code>、<code>tag:cli</code>、<code>stars:&gt;1k</code>、<code>no:tag</code>）</span>' +
        '<div class="empty-actions">' +
          '<button type="button" class="btn btn-primary" data-act="scope-to-github">' +
            '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" style="vertical-align:middle;margin-right:4px;"><circle cx="6.8" cy="6.8" r="4.6"/><line x1="10.4" y1="10.4" x2="14" y2="14" stroke-linecap="round"/></svg>' +
            '搜索整个 GitHub (↵)</button>' +
          '<button type="button" class="btn" data-act="ai-semantic">AI 语义找库</button>' +
          '<button type="button" class="btn" data-act="reset-filters">清空搜索条件</button>' +
        '</div>' +
      '</div>';
      return;
    }

    main.innerHTML = '<div class="empty">没有匹配的仓库' +
      "<span>换个关键词试试，比如它的功能或技术栈</span>" +
      '<button type="button" class="btn empty-reset" data-act="reset-filters">' +
        "清空搜索条件</button>" +
      "</div>";
    return;
  }
  main.classList.remove("is-empty");

  const grouped =
    state.view !== "trend" &&
    $("sort").value === "starred" && !$("q").value.trim() && !state.kind;

  const end = Math.min(state.shown + PAGE_SIZE, state.filtered.length);
  if (end > state.shown) {
    const terms = visibleTerms().map((t) => t.toLowerCase());
    let html = "";
    let month = state.lastMonth;
    let tier = state.lastTier;
    for (let i = state.shown; i < end; i++) {
      const r = state.filtered[i];
      if (grouped) {
        const key = monthKey(r.starred_at || r.created_at);
        if (key && key !== month) {
          html += '<div class="month">' + escapeHtml(key) + "</div>";
          month = key;
        }
      }
      // 名称命中与描述/topic 命中之间拉一条分隔，别让两类结果混在一起
      if (terms.length) {
        const t = nameTier(r, terms);
        if (t === 0 && tier === 1) {
          html += '<div class="match-divider">描述与 topic 匹配</div>';
        }
        tier = t;
      }
      html += itemHtml(r, i);
    }
    state.lastMonth = month;
    state.lastTier = tier;
    main.insertAdjacentHTML("beforeend", html);
    state.shown = end;
  }

  if (state.sel >= 0 && state.sel < state.shown) {
    const el = main.querySelector('.row[data-idx="' + state.sel + '"]');
    if (el) el.classList.add("sel");
  }
}

function updateStatus() {
  const isTrend = state.view === "trend";
  const isRemote = state.scope === "github";
  $("stat").classList.toggle("hidden", isTrend);
  const stat = $("stat");
  // 顶栏的索引数始终反映本地库，与搜索范围无关
  const total = (isTrend ? state.trend : state.repos).length;

  $("scopeBack").classList.toggle("hidden", !isRemote || isTrend);

  if (isRemote) {
    $("saveViewBtn")?.classList.add("hidden");
    $("savedViewsBar")?.classList.add("hidden");
    const n = state.remote.length;
    stat.dataset.count = String(n);
    stat.dataset.total = String(n);
    if (state.remoteLoading) {
      stat.textContent = "正在搜索 GitHub…";
    } else if (state.remoteErr) {
      stat.textContent = state.remoteErr;
    } else if (!state.remoteQuery) {
      stat.textContent = "输入关键词搜索整个 GitHub";
    } else {
      stat.innerHTML = "GitHub · 找到 <b>" + fmtCount(n) + "</b> 个仓库";
    }
  } else {
    const hits = state.filtered.length;
    const hasQuery = !!($("q").value.trim() || state.kind || $("lang").value);

    // 展示文案会变，条数挂到 data-* 上，给测试和以后的逻辑一个稳定的出口
    stat.dataset.count = String(hasQuery ? hits : total);
    stat.dataset.total = String(total);

    $("saveViewBtn")?.classList.toggle("hidden", isTrend || !hasQuery);
    $("savedViewsBar")?.classList.toggle("hidden", isTrend || !state.views.length);

    // 无筛选时总数在页签里已经有了，这里只说数据新鲜度，别把同一个数字说两遍
    if (hasQuery) {
      stat.innerHTML =
        "找到 <b>" + fmtCount(hits) + "</b> 个仓库 · 共 " + fmtCount(total) + " 个";
    } else if (state.syncedAt) {
      stat.innerHTML = "同步于 <b>" + timeAgo(state.syncedAt) + "</b>";
    } else {
      stat.textContent = "尚未同步";
    }
  }

  $("indexCount").textContent =
    state.view === "trend"
      ? total ? fmtCount(total) + " 热点" : ""
      : total ? fmtCount(total) + " 索引" : "";
  if (!state.syncing && !$("syncState").dataset.busy) {
    $("syncState").textContent = "";
  }
}

function updateTabCounts() {
  const counts = { "": state.repos.length, star: 0, fork: 0, owned: 0 };
  for (const r of state.repos) {
    if (r.kind in counts) counts[r.kind]++;
  }
  for (const btn of $("tabs").querySelectorAll("button")) {
    const n = counts[btn.dataset.kind] || 0;
    const el = btn.querySelector(".n");
    if (el) el.textContent = fmtCount(n);
  }
}

function setKind(kind) {
  state.kind = kind;
  for (const btn of $("tabs").querySelectorAll("button")) {
    btn.classList.toggle("on", btn.dataset.kind === kind);
  }
  syncSegThumb($("tabs"));
  buildLangOptions();
  applyFilters();
}

function moveSel(delta) {
  const items = $("list").querySelectorAll(".row");
  if (!items.length) return;
  if (state.sel >= 0 && items[state.sel]) items[state.sel].classList.remove("sel");

  let next = state.sel + delta;
  if (state.sel < 0) next = delta > 0 ? 0 : items.length - 1;
  if (next < 0) next = 0;
  if (next >= items.length) {
    if (state.shown < state.filtered.length) {
      renderList(false);
      return moveSel(delta);
    }
    next = items.length - 1;
  }

  state.sel = next;
  const el = items[next];
  el.classList.add("sel");
  el.scrollIntoView({ block: "nearest" });
  if (state.peekOpen && state.filtered[next]) {
    openPeekForRepo(state.filtered[next], { immediate: false });
  }
}

/* ---------------- 动作 ---------------- */

function currentRepo() {
  if (state.sel < 0) return null;
  return state.filtered[state.sel] || null;
}

function openCurrent() {
  const r = currentRepo();
  if (r) window.open(r.url, "_blank", "noopener");
}

async function copyCurrent() {
  const r = currentRepo();
  if (!r) return;
  try {
    await navigator.clipboard.writeText(r.url);
    flash("已复制链接");
  } catch (e) {
    flash("复制失败：" + e.message);
  }
}

let tagTarget = null;

function editTags(explicitRepo) {
  if (state.view === "trend") return; // 热点不在本地库，改标签没有意义
  const r = explicitRepo || currentRepo();
  if (!r) return;
  tagTarget = r;
  $("tagRepo").textContent = r.full_name;
  $("tagInput").value = r.tags || "";
  if ($("noteInput")) $("noteInput").value = r.note || "";
  renderTagSuggestions();
  $("tagDialog").classList.remove("hidden");
  setModalOpen(true);
  requestAnimationFrame(() => {
    $("tagInput").focus();
    $("tagInput").select();
  });
}

function closeTagDialog() {
  $("tagDialog").classList.add("hidden");
  setModalOpen(false);
  tagTarget = null;
  $("q").focus();
}

async function saveTagDialog() {
  const r = tagTarget;
  const val = $("tagInput").value.trim().toLowerCase().replace(/\s+/g, " ");
  const nextNote = $("noteInput") ? $("noteInput").value.trim() : (r ? (r.note || "") : "");
  $("tagDialog").classList.add("hidden");
  setModalOpen(false);
  tagTarget = null;
  if (!r) return;

  const prevTags = r.tags || "";
  const prevNote = r.note || "";
  if (val === prevTags && nextNote === prevNote) {
    $("q").focus();
    return;
  }
  r.tags = val;
  r.note = nextNote;
  await saveRepos(state.repos, { all: false, touched: [r.id] });
  applyFilters();
  if (val !== prevTags) {
    showToast(val ? "标签已更新" : "标签已清除");
  } else {
    showToast(nextNote ? "备注已保存" : "备注已清除");
  }
}

function initTagDialog() {
  $("tagSave").addEventListener("click", saveTagDialog);
  $("tagCancel").addEventListener("click", closeTagDialog);
  $("tagDialog").addEventListener("click", (e) => {
    if (e.target.dataset.close) closeTagDialog();
  });
  $("tagInput").addEventListener("input", renderTagSuggestions);
  $("tagSuggestions")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-sug-tag]");
    if (!chip) return;
    const tg = chip.dataset.sugTag;
    const cur = $("tagInput").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const set = new Set(cur);
    if (set.has(tg)) set.delete(tg);
    else set.add(tg);
    $("tagInput").value = Array.from(set).join(" ");
    renderTagSuggestions();
    $("tagInput").focus();
  });
  $("tagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTagDialog();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeTagDialog();
    }
  });
  $("noteInput")?.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      saveTagDialog();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeTagDialog();
    }
  });
  $("tagAiSuggest")?.addEventListener("click", async () => {
    if (!tagTarget) return;
    const btn = $("tagAiSuggest");
    btn.disabled = true;
    btn.textContent = "生成中…";
    try {
      const res = await aiAnnotateRepo(tagTarget);
      if (res.tags) {
        const cur = $("tagInput").value.trim();
        $("tagInput").value = Array.from(new Set(
          (cur + " " + res.tags).trim().toLowerCase().split(/\s+/).filter(Boolean)
        )).join(" ");
      }
      if (res.note && $("noteInput")) $("noteInput").value = res.note;
      showToast("已填充 AI 建议，确认后点保存即可");
    } catch (e) {
      showToast(e.message, { isError: true });
    } finally {
      btn.disabled = false;
      btn.textContent = "AI 生成";
    }
  });
}

let currentUndoAction = null;
let toastTimer = 0;
let flashTimer = 0;

/* 根据操作系统适配快捷键符号（macOS 用 ⌘/⌥，Win/Linux 用 Ctrl/Alt） */
function adaptShortcutLabels() {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
  if (isMac) return;
  document.querySelectorAll("kbd[data-os-cmd]").forEach((el) => {
    el.textContent = "Ctrl↵";
  });
  document.querySelectorAll("kbd[data-os-cmd-k]").forEach((el) => {
    el.textContent = "Ctrl+K";
  });
  document.querySelectorAll("kbd[data-os-alt]").forEach((el) => {
    el.textContent = "Alt+s";
  });
  document.querySelectorAll("#scopePill .scope-btn").forEach((btn) => {
    btn.title = btn.title.replace("⌥S", "Alt+S");
  });
}

/* ---------------- 设置与账号弹窗 ---------------- */

let settingsLastFocus = null;

function maskToken(t) {
  if (!t || t === "demo_mode") return "示例模式（未绑定真实 Token）";
  const prefix = t.slice(0, Math.min(8, t.length));
  const suffix = t.length > 12 ? t.slice(-4) : "";
  return "已配置：" + prefix + "••••" + suffix;
}

function refreshSettingsInfo() {
  const syncEl = $("settingsSyncInfo");
  if (syncEl) {
    const count = fmtCount(state.repos.length);
    const when = state.syncedAt ? timeAgo(state.syncedAt) : "从未同步";
    syncEl.textContent = `本地已索引 ${count} 个仓库 · 最近同步：${when}`;
  }
  const tokEl = $("settingsTokenStatus");
  if (tokEl) tokEl.textContent = maskToken(state.token);

  const qlInput = $("settingsQuickLinks");
  if (qlInput) {
    qlInput.value = (state.quickLinks || DEFAULT_QUICK_LINKS)
      .map((x) => `${x.name} | ${x.url}`)
      .join("\n");
  }
  syncAiSettingsUI();
  updatePrewarmStatusUI();
}

function syncAiSettingsUI() {
  const cfg = state.aiConfig || DEFAULT_AI_CONFIG;
  document.querySelectorAll("#aiModePick button").forEach((b) => {
    const on = b.dataset.aimode === cfg.mode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  if ($("aiBaseUrl")) $("aiBaseUrl").value = cfg.baseUrl || "";
  if ($("aiModel")) $("aiModel").value = cfg.model || "";
  if ($("aiApiKey")) $("aiApiKey").value = cfg.apiKey || "";
  if ($("aiStatus")) {
    $("aiStatus").textContent = cfg.baseUrl && cfg.model
      ? `已配置：${cfg.mode === "ollama" ? "本地 Ollama" : "OpenAI 兼容"} · ${cfg.model}`
      : "未配置 · 支持自动中文备注、语义检索与选型对比";
  }
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportBackupJson() {
  const annotations = {};
  for (const r of state.repos) {
    if ((r.tags && r.tags.trim()) || (r.note && r.note.trim())) {
      annotations[r.full_name] = { tags: r.tags || "", note: r.note || "" };
    }
  }
  const payload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    totalRepos: state.repos.length,
    annotations,
    views: state.views,
    quickLinks: state.quickLinks,
    pinned: state.pinned,
  };
  const day = new Date().toISOString().slice(0, 10);
  downloadFile(`grepo-backup-${day}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  showToast(`已导出备份（含 ${Object.keys(annotations).length} 条标注）`);
}

async function importBackupJson(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const ann = (data && data.annotations && typeof data.annotations === "object") ? data.annotations : {};
    const byName = new Map();
    for (const r of state.repos) {
      if (r.full_name) byName.set(r.full_name.toLowerCase(), r);
    }
    const touched = [];
    let updated = 0;
    for (const [fn, meta] of Object.entries(ann)) {
      const r = byName.get(fn.toLowerCase());
      if (!r || !meta) continue;
      let dirty = false;
      if (typeof meta.tags === "string" && meta.tags.trim()) {
        const merged = Array.from(new Set(
          ((r.tags || "") + " " + meta.tags).trim().toLowerCase().split(/\s+/).filter(Boolean)
        )).join(" ");
        if (merged !== (r.tags || "")) { r.tags = merged; dirty = true; }
      }
      if (typeof meta.note === "string" && meta.note.trim() && meta.note.trim() !== (r.note || "")) {
        r.note = meta.note.trim();
        dirty = true;
      }
      if (dirty) { touched.push(r.id); updated++; }
    }
    if (Array.isArray(data.views) && data.views.length) {
      const existingNames = new Set(state.views.map((v) => v.name));
      for (const v of data.views) {
        if (v && v.name && !existingNames.has(v.name)) state.views.push(v);
      }
      await setStoredObj(K.views, state.views);
      renderSavedViews();
    }
    if (Array.isArray(data.quickLinks) && data.quickLinks.length) {
      state.quickLinks = data.quickLinks;
      await setStoredObj(K.quickLinks, state.quickLinks);
    }
    if (Array.isArray(data.pinned) && data.pinned.length) {
      state.pinned = Array.from(new Set(state.pinned.concat(data.pinned.map((x) => String(x).toLowerCase())))).slice(0, 30);
      state._pinnedSet = new Set(state.pinned);
      await setStoredObj(K.pinned, state.pinned);
    }
    if (touched.length) {
      await saveRepos(state.repos, { all: false, touched });
    }
    applyFilters();
    refreshSettingsInfo();
    showToast(`已恢复 ${updated} 个仓库的标签与备注`);
  } catch (e) {
    showToast("导入失败：" + e.message, { isError: true });
  }
}

function exportAwesomeMarkdown() {
  const groups = new Map();
  for (const r of state.repos) {
    const tags = (r.tags || "").split(/\s+/).filter(Boolean);
    const key = tags.length ? `#${tags[0]}` : (r.language || "未分类");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    const aTag = a.startsWith("#") ? 0 : 1;
    const bTag = b.startsWith("#") ? 0 : 1;
    if (aTag !== bTag) return aTag - bTag;
    return groups.get(b).length - groups.get(a).length;
  });
  const lines = [
    `# My GitHub Awesome Index`,
    ``,
    `> Exported by grepo · ${new Date().toISOString().slice(0, 10)} · ${state.repos.length} repositories`,
    ``,
  ];
  for (const k of sortedKeys) {
    const list = groups.get(k).slice().sort((a, b) => (b.stars || 0) - (a.stars || 0));
    lines.push(`## ${k} (${list.length})`, ``);
    for (const r of list) {
      const desc = r.note ? `${r.note} — ${r.description || ""}`.replace(/\s+—\s*$/, "") : (r.description || "");
      const meta = r.stars ? ` (★ ${fmtNum(r.stars)})` : "";
      lines.push(`- [${r.full_name}](${r.url})${meta}${desc ? ` — ${desc}` : ""}`);
    }
    lines.push(``);
  }
  const day = new Date().toISOString().slice(0, 10);
  downloadFile(`grepo-awesome-${day}.md`, lines.join("\n"), "text/markdown;charset=utf-8");
  showToast("已导出 Awesome Markdown 清单");
}

function exportCsv() {
  const header = ["full_name", "url", "language", "stars", "kind", "tags", "note", "starred_at", "pushed_at"];
  const rows = [header.join(",")];
  for (const r of state.repos) {
    rows.push([
      r.full_name, r.url, r.language, r.stars || 0, r.kind,
      r.tags || "", r.note || "", r.starred_at || "", r.pushed_at || ""
    ].map(csvCell).join(","));
  }
  const day = new Date().toISOString().slice(0, 10);
  downloadFile(`grepo-repos-${day}.csv`, "\uFEFF" + rows.join("\n"), "text/csv;charset=utf-8");
  showToast("已导出 CSV 表格");
}

function openSettingsDialog() {
  settingsLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  refreshSettingsInfo();
  if ($("settingsTokenInput")) $("settingsTokenInput").value = "";
  $("settingsDialog").classList.remove("hidden");
  setModalOpen(true);
  requestAnimationFrame(() => $("settingsClose")?.focus());
}

function closeSettingsDialog() {
  $("settingsDialog").classList.add("hidden");
  setModalOpen(false);
  if (settingsLastFocus && settingsLastFocus.isConnected) {
    settingsLastFocus.focus();
  }
  settingsLastFocus = null;
}

function initSettingsDialog() {
  const btn = $("settingsBtn");
  if (btn) btn.addEventListener("click", openSettingsDialog);
  $("settingsClose")?.addEventListener("click", closeSettingsDialog);
  $("settingsDialog")?.addEventListener("click", (e) => {
    if (e.target.dataset.close) closeSettingsDialog();
  });

  $("settingsIncrSync")?.addEventListener("click", () => {
    closeSettingsDialog();
    runSync();
  });
  $("settingsFullSync")?.addEventListener("click", () => {
    closeSettingsDialog();
    runSync({ shiftKey: true });
  });
  $("pullListsBtn")?.addEventListener("click", () => pullGithubLists($("pullListsBtn")));
  $("pushListsBtn")?.addEventListener("click", () => pushTagsToGithubLists($("pushListsBtn")));
  $("settingsCheckReleasesBtn")?.addEventListener("click", () => checkPinnedReleases($("settingsCheckReleasesBtn")));
  $("prewarmStartBtn")?.addEventListener("click", () => startPrewarmQueue(120));
  $("prewarmStopBtn")?.addEventListener("click", stopPrewarmQueue);
  $("prewarmClearBtn")?.addEventListener("click", clearReadmeCache);
  $("cloneModePick")?.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-clone]");
    if (!b) return;
    state.cloneMode = b.dataset.clone === "ssh" ? "ssh" : "https";
    await setStored(K.cloneMode, state.cloneMode);
    syncCloneModeUI();
    showToast(`已切换 Clone 协议为 ${state.cloneMode.toUpperCase()}`);
  });

  $("settingsSaveLinks")?.addEventListener("click", async () => {
    const raw = ($("settingsQuickLinks")?.value || "").split("\n");
    const parsed = [];
    for (const line of raw) {
      const m = line.split("|");
      if (m.length >= 2) {
        const name = m[0].trim();
        const url = m.slice(1).join("|").trim();
        if (name && /^https?:\/\//i.test(url)) parsed.push({ name, url });
      }
    }
    state.quickLinks = parsed.length ? parsed : DEFAULT_QUICK_LINKS.slice();
    await setStoredObj(K.quickLinks, state.quickLinks);
    refreshSettingsInfo();
    showToast(`已保存 ${state.quickLinks.length} 条快捷外链`);
  });

  $("exportJsonBtn")?.addEventListener("click", exportBackupJson);
  $("importJsonBtn")?.addEventListener("click", () => $("importJsonFile")?.click());
  $("importJsonFile")?.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importBackupJson(f);
    e.target.value = "";
  });
  $("exportMdBtn")?.addEventListener("click", exportAwesomeMarkdown);
  $("exportCsvBtn")?.addEventListener("click", exportCsv);

  $("aiModePick")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-aimode]");
    if (!b) return;
    const mode = b.dataset.aimode;
    state.aiConfig.mode = mode;
    if (mode === "ollama" && (!$("aiBaseUrl").value || /openai\.com/i.test($("aiBaseUrl").value))) {
      $("aiBaseUrl").value = "http://localhost:11434/v1";
      if (!$("aiModel").value || /^gpt-/i.test($("aiModel").value)) $("aiModel").value = "qwen2.5:7b";
    } else if (mode === "openai" && /localhost:11434/i.test($("aiBaseUrl").value)) {
      $("aiBaseUrl").value = "https://api.openai.com/v1";
      if (!$("aiModel").value || /^qwen/i.test($("aiModel").value)) $("aiModel").value = "gpt-4o-mini";
    }
    syncAiSettingsUI();
  });

  $("aiSaveBtn")?.addEventListener("click", async () => {
    state.aiConfig = {
      mode: state.aiConfig.mode || "ollama",
      baseUrl: ($("aiBaseUrl")?.value || "").trim().replace(/\/+$/, ""),
      model: ($("aiModel")?.value || "").trim(),
      apiKey: ($("aiApiKey")?.value || "").trim(),
    };
    await setStoredObj(K.aiConfig, state.aiConfig);
    syncAiSettingsUI();
    showToast("AI 配置已保存在本机");
  });

  $("aiTestBtn")?.addEventListener("click", async () => {
    const cfg = {
      mode: state.aiConfig.mode || "ollama",
      baseUrl: ($("aiBaseUrl")?.value || "").trim().replace(/\/+$/, ""),
      model: ($("aiModel")?.value || "").trim(),
      apiKey: ($("aiApiKey")?.value || "").trim(),
    };
    state.aiConfig = cfg;
    await setStoredObj(K.aiConfig, cfg);
    const tbtn = $("aiTestBtn");
    tbtn.disabled = true;
    tbtn.textContent = "测试中…";
    try {
      const reply = await callAiChat("请只回复「连接成功」四个字。", "测试连接");
      $("aiStatus").textContent = "连接成功 · " + cfg.model;
      showToast("AI 接口连接成功：" + reply.slice(0, 24));
    } catch (e) {
      $("aiStatus").textContent = "连接失败 · " + e.message;
      showToast("AI 连接失败：" + e.message, { isError: true });
    } finally {
      tbtn.disabled = false;
      tbtn.textContent = "测试连接";
    }
  });

  $("settingsTokenSave")?.addEventListener("click", async () => {
    const input = $("settingsTokenInput");
    const v = (input?.value || "").trim();
    if (!v) {
      showToast("请先粘贴新的 GitHub Token", { isError: true });
      input?.focus();
      return;
    }
    const saveBtn = $("settingsTokenSave");
    const prevToken = state.token;
    saveBtn.disabled = true;
    saveBtn.textContent = "验证中";
    state.token = v;
    try {
      await api("/user", {});
      await saveToken(v);
      input.value = "";
      refreshSettingsInfo();
      showToast("Token 已验证并更新");
    } catch (e) {
      state.token = prevToken;
      showToast("Token 验证失败：" + e.message, { isError: true });
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "更新";
    }
  });

  $("settingsTokenClear")?.addEventListener("click", async () => {
    closeSettingsDialog();
    await removeRaw([K.token]);
    state.token = "";
    if ($("tokenInput")) $("tokenInput").value = "";
    showSetup();
    showToast("已清除本地 Token");
  });
}

/* ---------------- 快捷筛选视图（Smart Views） ---------------- */

function renderSavedViews() {
  const bar = $("savedViewsBar");
  if (!bar) return;
  if (!state.views.length || state.view === "trend" || state.scope === "github") {
    bar.innerHTML = "";
    bar.classList.add("hidden");
    return;
  }
  bar.innerHTML = state.views.map((v, i) =>
    `<span class="view-pill" data-view-idx="${i}" title="点击切换该筛选视图">` +
      `<span>${escapeHtml(v.name)}</span>` +
      `<button type="button" class="view-pill-x" data-del-view="${i}" aria-label="删除视图">×</button>` +
    `</span>`
  ).join("");
  bar.classList.remove("hidden");
}

function initSavedViews() {
  $("saveViewBtn")?.addEventListener("click", async () => {
    const q = $("q").value.trim();
    const lang = $("lang").value;
    const kind = state.kind;
    const sort = $("sort").value;
    const defName = [q, lang, kind].filter(Boolean).join(" · ") || "自定义视图";
    const name = window.prompt("给这个快捷视图起个名字：", defName);
    if (!name || !name.trim()) return;
    state.views.push({
      id: Date.now(),
      name: name.trim().slice(0, 24),
      q, lang, kind, sort,
      archived: $("showArchived").checked,
    });
    await setStoredObj(K.views, state.views);
    renderSavedViews();
    showToast("已保存快捷视图：" + name.trim());
  });

  $("savedViewsBar")?.addEventListener("click", async (e) => {
    const delBtn = e.target.closest("[data-del-view]");
    if (delBtn) {
      e.stopPropagation();
      const idx = Number(delBtn.dataset.delView);
      state.views.splice(idx, 1);
      await setStoredObj(K.views, state.views);
      renderSavedViews();
      return;
    }
    const pill = e.target.closest("[data-view-idx]");
    if (!pill) return;
    const v = state.views[Number(pill.dataset.viewIdx)];
    if (!v) return;
    if (state.view !== "mine") setView("mine");
    if (state.scope !== "local") setScope("local");
    $("q").value = v.q || "";
    syncSearchClear();
    $("showArchived").checked = !!v.archived;
    setKind(v.kind || "");
    $("lang").value = v.lang || "";
    $("langSelect")?._refresh?.();
    $("sort").value = v.sort || "starred";
    $("sortSelect")?._refresh?.();
    applyFilters();
  });
}

/* ---------------- 标签管理中心 ---------------- */

let tagMgrLastFocus = null;

function collectTagStats() {
  const map = new Map();
  let untagged = 0;
  for (const r of state.repos) {
    const tags = (r.tags || "").split(/\s+/).filter(Boolean);
    if (!tags.length) untagged++;
    for (const t of tags) {
      map.set(t, (map.get(t) || 0) + 1);
    }
  }
  return {
    tags: Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    untagged,
  };
}

function renderTagManager() {
  const list = $("tagMgrList");
  if (!list) return;
  const kw = ($("tagMgrSearch")?.value || "").trim().toLowerCase();
  const { tags, untagged } = collectTagStats();
  if ($("tagMgrUntaggedBtn")) {
    $("tagMgrUntaggedBtn").textContent = `未打标仓库 (${fmtCount(untagged)})`;
  }
  const visible = kw ? tags.filter(([t]) => t.includes(kw)) : tags;
  if (!visible.length) {
    list.innerHTML = '<div class="empty" style="padding:24px;">暂无匹配的自定义标签<span>在任意仓库按 t 键或点击「标签」即可创建</span></div>';
    return;
  }
  list.innerHTML = visible.map(([t, n]) =>
    `<div class="tag-mgr-row" data-tag="${escapeHtml(t)}">` +
      `<div class="tag-mgr-left" data-tag-act="filter">` +
        `<span class="tag-mgr-name">#${escapeHtml(t)}</span>` +
        `<span class="tag-mgr-cnt">${fmtCount(n)} 个仓库</span>` +
      `</div>` +
      `<div class="tag-mgr-acts">` +
        `<button type="button" class="btn" data-tag-act="rename">重命名 / 合并</button>` +
        `<button type="button" class="btn btn-danger-ghost" data-tag-act="delete">删除</button>` +
      `</div>` +
    `</div>`
  ).join("");
}

function openTagManager() {
  tagMgrLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if ($("tagMgrSearch")) $("tagMgrSearch").value = "";
  renderTagManager();
  $("tagManagerDialog").classList.remove("hidden");
  setModalOpen(true);
  requestAnimationFrame(() => $("tagMgrSearch")?.focus());
}

function closeTagManager() {
  $("tagManagerDialog").classList.add("hidden");
  setModalOpen(false);
  if (tagMgrLastFocus && tagMgrLastFocus.isConnected) tagMgrLastFocus.focus();
  tagMgrLastFocus = null;
}

function initTagManager() {
  $("tagsMgrBtn")?.addEventListener("click", openTagManager);
  $("tagMgrClose")?.addEventListener("click", closeTagManager);
  $("tagManagerDialog")?.addEventListener("click", (e) => {
    if (e.target.dataset.close) closeTagManager();
  });
  $("tagMgrSearch")?.addEventListener("input", renderTagManager);
  $("tagMgrUntaggedBtn")?.addEventListener("click", () => {
    closeTagManager();
    filterByTag("no:tag");
  });
  $("tagMgrPullLists")?.addEventListener("click", () => pullGithubLists($("tagMgrPullLists")));
  $("tagMgrPushLists")?.addEventListener("click", () => pushTagsToGithubLists($("tagMgrPushLists")));
  $("tagMgrList")?.addEventListener("click", async (e) => {
    const actEl = e.target.closest("[data-tag-act]");
    const row = e.target.closest(".tag-mgr-row");
    if (!actEl || !row) return;
    const tag = row.dataset.tag;
    const act = actEl.dataset.tagAct;
    if (act === "filter") {
      closeTagManager();
      filterByTag("tag:" + tag);
      return;
    }
    if (act === "rename") {
      const nextRaw = window.prompt(`将标签 #${tag} 重命名或合并为（无需输入 #）：`, tag);
      if (!nextRaw) return;
      const next = nextRaw.trim().toLowerCase().replace(/\s+/g, "-").replace(/^#+/, "");
      if (!next || next === tag) return;
      const touched = [];
      for (const r of state.repos) {
        const arr = (r.tags || "").split(/\s+/).filter(Boolean);
        if (!arr.includes(tag)) continue;
        r.tags = Array.from(new Set(arr.map((x) => (x === tag ? next : x)))).join(" ");
        touched.push(r.id);
      }
      if (touched.length) await saveRepos(state.repos, { all: false, touched });
      renderTagManager();
      applyFilters();
      showToast(`已将 #${tag} 合并为 #${next}（${touched.length} 个仓库）`);
    } else if (act === "delete") {
      if (!window.confirm(`确定从全部仓库移除标签 #${tag}？`)) return;
      const touched = [];
      for (const r of state.repos) {
        const arr = (r.tags || "").split(/\s+/).filter(Boolean);
        if (!arr.includes(tag)) continue;
        r.tags = arr.filter((x) => x !== tag).join(" ");
        touched.push(r.id);
      }
      if (touched.length) await saveRepos(state.repos, { all: false, touched });
      renderTagManager();
      applyFilters();
      showToast(`已移除 #${tag}（${touched.length} 个仓库）`);
    }
  });
}

/* ---------------- 批量整理模式 ---------------- */

function updateBatchBar() {
  const n = state.batchSelected.size;
  if ($("batchCount")) $("batchCount").textContent = `已选 ${n} 项`;
  if ($("batchTagBtn")) $("batchTagBtn").disabled = n === 0;
  if ($("batchAiTagBtn")) $("batchAiTagBtn").disabled = n === 0;
  if ($("batchCompareBtn")) $("batchCompareBtn").disabled = n < 2 || n > 5;
  if ($("batchUnstarBtn")) $("batchUnstarBtn").disabled = n === 0;
}

function setBatchMode(on) {
  state.batchMode = !!on;
  if (!state.batchMode) state.batchSelected.clear();
  document.body.classList.toggle("batch-mode", state.batchMode);
  $("batchToggleBtn")?.classList.toggle("on", state.batchMode);
  $("batchBar")?.classList.toggle("hidden", !state.batchMode);
  updateBatchBar();
  renderList(true);
}

function selectedBatchRepos() {
  return state.repos.filter((r) => state.batchSelected.has(r.id));
}

function initBatchBar() {
  $("batchToggleBtn")?.addEventListener("click", () => setBatchMode(!state.batchMode));
  $("batchExitBtn")?.addEventListener("click", () => setBatchMode(false));

  $("batchSelectAll")?.addEventListener("click", () => {
    const visible = state.filtered.slice(0, Math.max(state.shown, PAGE_SIZE));
    const allSelected = visible.length > 0 && visible.every((r) => state.batchSelected.has(r.id));
    if (allSelected) {
      for (const r of visible) state.batchSelected.delete(r.id);
    } else {
      for (const r of visible) state.batchSelected.add(r.id);
    }
    updateBatchBar();
    renderList(true);
  });

  $("batchTagBtn")?.addEventListener("click", async () => {
    const targets = selectedBatchRepos();
    if (!targets.length) return;
    const raw = window.prompt(`为选中的 ${targets.length} 个仓库批量追加标签（空格分隔；前缀 -标签 可移除）：`);
    if (!raw || !raw.trim()) return;
    const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const toAdd = tokens.filter((t) => !t.startsWith("-")).map((t) => t.replace(/^#+/, ""));
    const toDel = new Set(tokens.filter((t) => t.startsWith("-") && t.length > 1).map((t) => t.slice(1).replace(/^#+/, "")));
    const touched = [];
    for (const r of targets) {
      const set = new Set((r.tags || "").split(/\s+/).filter(Boolean));
      for (const d of toDel) set.delete(d);
      for (const a of toAdd) if (a) set.add(a);
      r.tags = Array.from(set).join(" ");
      touched.push(r.id);
    }
    await saveRepos(state.repos, { all: false, touched });
    applyFilters();
    showToast(`已更新 ${touched.length} 个仓库的标签`);
  });

  $("batchUnstarBtn")?.addEventListener("click", async () => {
    const targets = selectedBatchRepos();
    if (!targets.length) return;
    if (!state.token || state.token === "demo_mode") return showSetup();
    if (!window.confirm(`确定在 GitHub 上批量取消 Star 这 ${targets.length} 个仓库？`)) return;
    const btn = $("batchUnstarBtn");
    btn.disabled = true;
    let ok = 0;
    const touched = [];
    const removedIds = new Set();
    for (const r of targets) {
      const [owner, name] = (r.full_name || "").split("/");
      if (!owner || !name) continue;
      try {
        const res = await fetch(`https://api.github.com/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
          method: "DELETE",
          headers: {
            Authorization: "Bearer " + state.token,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (res.ok || res.status === 404) {
          removedIds.add(r.id);
          touched.push(r.id);
          ok++;
        }
      } catch {}
    }
    if (removedIds.size) {
      state.repos = state.repos.filter((r) => !removedIds.has(r.id));
      state._starredSet = null;
      await saveRepos(state.repos, { all: false, touched });
    }
    setBatchMode(false);
    updateTabCounts();
    buildLangOptions();
    applyFilters();
    showToast(`已批量取消 Star ${ok} 个仓库`);
  });

  $("batchAiTagBtn")?.addEventListener("click", async () => {
    const targets = selectedBatchRepos().slice(0, 10);
    if (!targets.length) return;
    const btn = $("batchAiTagBtn");
    btn.disabled = true;
    let ok = 0;
    const touched = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        btn.textContent = `AI 整理 ${i + 1}/${targets.length}`;
        const r = targets[i];
        const res = await aiAnnotateRepo(r);
        if (res.tags) {
          r.tags = Array.from(new Set(((r.tags || "") + " " + res.tags).trim().toLowerCase().split(/\s+/).filter(Boolean))).join(" ");
        }
        if (res.note) r.note = res.note;
        touched.push(r.id);
        ok++;
      }
      if (touched.length) await saveRepos(state.repos, { all: false, touched });
      applyFilters();
      showToast(`AI 已为 ${ok} 个仓库生成中文备注与标签`);
    } catch (e) {
      if (touched.length) await saveRepos(state.repos, { all: false, touched });
      showToast(`已完成 ${ok} 个，中断原因：${e.message}`, { isError: true });
    } finally {
      btn.disabled = false;
      btn.textContent = "AI 整理";
    }
  });

  $("batchCompareBtn")?.addEventListener("click", async () => {
    const targets = selectedBatchRepos().slice(0, 5);
    if (targets.length < 2) {
      showToast("请至少选择 2 个仓库进行对比", { isError: true });
      return;
    }
    await runAiCompareRepos(targets);
  });
}

/* ---------------- 资产洞察与 GitHub DNA 看板 ---------------- */

let insightsLastFocus = null;

function renderInsightsRandom() {
  const box = $("insightsRandomList");
  if (!box) return;
  const cutoff = Date.now() - 180 * 86400000;
  let pool = state.repos.filter((r) => !r.archived && r.starred_at && Date.parse(r.starred_at) < cutoff);
  if (pool.length < 3) pool = state.repos.filter((r) => !r.archived);
  const picks = [];
  const used = new Set();
  for (let i = 0; i < Math.min(3, pool.length); i++) {
    let idx = Math.floor(Math.random() * pool.length);
    while (used.has(idx) && used.size < pool.length) idx = (idx + 1) % pool.length;
    used.add(idx);
    picks.push(pool[idx]);
  }
  if (!picks.length) {
    box.innerHTML = '<div class="md-note">暂无可回顾仓库</div>';
    return;
  }
  box.innerHTML = picks.map((r) =>
    `<button type="button" class="random-card" data-random-repo="${escapeHtml(r.full_name)}">` +
      `<div class="random-title">${escapeHtml(r.full_name)}</div>` +
      `<div class="random-desc">${escapeHtml(r.note || r.description || "（无描述）")}</div>` +
      `<div class="random-meta">★ ${fmtNum(r.stars)} · ${escapeHtml(r.language || "未标注")} · ${fmtDate(r.starred_at || r.created_at)}</div>` +
    `</button>`
  ).join("");
}

function renderInsights() {
  const repos = state.repos;
  const total = repos.length;
  let sumStars = 0, tagged = 0, noted = 0, archived = 0, stale = 0, rising = 0;
  const langMap = new Map();
  const yearMap = new Map();
  const ownerMap = new Map();

  for (const r of repos) {
    sumStars += r.stars || 0;
    if ((r.tags || "").trim()) tagged++;
    if ((r.note || "").trim()) noted++;
    if (r.archived) archived++;
    if (isRepoStale(r)) stale++;
    if (r.star_gain > 0) rising++;
    if (r.language) langMap.set(r.language, (langMap.get(r.language) || 0) + 1);
    const y = String(r.starred_at || r.created_at || "").slice(0, 4);
    if (/^\d{4}$/.test(y)) yearMap.set(y, (yearMap.get(y) || 0) + 1);
    if (r.owner) ownerMap.set(r.owner, (ownerMap.get(r.owner) || 0) + 1);
  }

  const tagPct = total ? Math.round((tagged / total) * 100) : 0;
  $("insightsKpis").innerHTML = [
    ["本地索引总量", total, "count", `已缓存 README ${Object.keys(state.readmeCache || {}).length} 份`],
    ["累计星标沉淀", sumStars, "num", "覆盖你的全部收藏"],
    ["标签整理率", tagPct, "pct", `${fmtCount(tagged)} 个已打标`],
    ["个人中文备注", noted, "count", "均已纳入本地检索"],
  ].map(([l, rawVal, kind, s]) => {
    const text = kind === "pct" ? `${rawVal}%` : (kind === "num" ? fmtNum(rawVal) : fmtCount(rawVal));
    return `<div class="kpi-card"><div class="kpi-label">${l}</div><div class="kpi-val" data-count-to="${rawVal}" data-count-kind="${kind}">${text}</div><div class="kpi-sub">${s}</div></div>`;
  }).join("");

  // 轻量 KPI 数字滚动动效（340ms GPU 友好 rAF）
  document.querySelectorAll("#insightsKpis .kpi-val[data-count-to]").forEach((el) => {
    const target = Number(el.dataset.countTo) || 0;
    const kind = el.dataset.countKind;
    animateCountUp(el, target, (v) =>
      kind === "pct" ? `${Math.round(v)}%` : (kind === "num" ? fmtNum(Math.round(v)) : fmtCount(Math.round(v)))
    );
  });

  renderInsightsHeatmap(repos);
  renderReleaseRadar();
  renderLangRibbon(langMap, total);

  $("insightsHealth").innerHTML = [
    ["is:archived", fmtCount(archived), "已归档仓库"],
    ["is:stale", fmtCount(stale), "超过 2 年未提交"],
    ["no:tag", fmtCount(total - tagged), "尚未打标签"],
    ["is:rising", fmtCount(rising), "近期星标黑马"],
  ].map(([dsl, n, label]) =>
    `<button type="button" class="health-chip" data-dsl="${dsl}"><strong>${n}</strong><span>${label}</span></button>`
  ).join("");

  const topLangs = Array.from(langMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxLang = topLangs.length ? topLangs[0][1] : 1;
  $("insightsLangs").innerHTML = topLangs.map(([l, n], idx) => {
    const lc = LANG_COLORS[l] || "var(--accent)";
    return `<button type="button" class="bar-row" data-lang-pick="${escapeHtml(l)}">` +
      `<span class="bar-name"><span class="lang-dot" data-lang="${escapeHtml(l)}"></span>${escapeHtml(l)}</span>` +
      `<span class="bar-track"><span class="bar-fill" style="width:${Math.max(4, Math.round((n / maxLang) * 100))}%;background:${lc};animation-delay:${idx * 35}ms"></span></span>` +
      `<span class="bar-num">${fmtCount(n)}</span>` +
    `</button>`;
  }).join("") || '<div class="md-note">暂无语言统计</div>';

  const years = Array.from(yearMap.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8);
  const maxYear = years.reduce((m, [, n]) => Math.max(m, n), 1);
  $("insightsYears").innerHTML = years.map(([y, n], idx) =>
    `<button type="button" class="bar-row" data-dsl="starred:${y}">` +
      `<span class="bar-name">${y} 年</span>` +
      `<span class="bar-track"><span class="bar-fill" style="width:${Math.max(4, Math.round((n / maxYear) * 100))}%;animation-delay:${idx * 35}ms"></span></span>` +
      `<span class="bar-num">${fmtCount(n)}</span>` +
    `</button>`
  ).join("") || '<div class="md-note">暂无年份统计</div>';

  const topOwners = Array.from(ownerMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  $("insightsOwners").innerHTML = topOwners.map(([o, n]) =>
    `<button type="button" class="owner-chip" data-dsl="owner:${escapeHtml(o)}"><span>${escapeHtml(o)}</span><b>${n}</b></button>`
  ).join("");

  renderInsightsRandom();
  renderVanishedSection();
}

function renderVanishedSection() {
  const wrap = $("insightsVanishedWrap");
  const list = $("insightsVanishedList");
  const title = $("insightsVanishedTitle");
  if (!wrap || !list) return;
  if (!state.vanished.length) {
    wrap.classList.add("hidden");
    list.innerHTML = "";
    return;
  }
  wrap.classList.remove("hidden");
  if (title) title.textContent = `已发现失联 / 404 仓库（${state.vanished.length}）`;
  list.innerHTML = state.vanished.map((v) =>
    `<div class="vanished-row">` +
      `<div class="vanished-main">` +
        `<div class="vanished-name">${escapeHtml(v.full_name)}</div>` +
        `<div class="vanished-meta">${escapeHtml([v.note, v.tags ? "#" + v.tags.split(/\s+/).join(" #") : "", v.description].filter(Boolean).join(" · ") || "无描述")}</div>` +
      `</div>` +
      `<span class="vanished-badge">${escapeHtml(v.status || "失联")}</span>` +
    `</div>`
  ).join("");
}

/* 主动巡检最久未更新/已归档的一批收藏，探测是否已删库或 404 */
async function scan404Repos() {
  if (!state.token || state.token === "demo_mode") {
    showToast("请先配置真实 GitHub Token 后再巡检", { isError: true });
    return;
  }
  const btn = $("scan404Btn");
  if (!btn || btn.disabled) return;
  btn.disabled = true;

  // 优先抽检最久未推送或已归档的 25 个仓库（高概率失联且温和不爆限流）
  const sample = state.repos
    .filter((r) => r.full_name && r.kind === "star")
    .slice()
    .sort((a, b) => (b.archived ? 1 : 0) - (a.archived ? 1 : 0) || String(a.pushed_at || "").localeCompare(String(b.pushed_at || "")))
    .slice(0, 25);

  const vanishedMap = new Map(state.vanished.map((x) => [(x.full_name || "").toLowerCase(), x]));
  let found = 0;
  try {
    for (let i = 0; i < sample.length; i++) {
      btn.textContent = `巡检中 ${i + 1}/${sample.length}`;
      const r = sample[i];
      const [owner, name] = r.full_name.split("/");
      if (!owner || !name) continue;
      const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
        headers: {
          Authorization: "Bearer " + state.token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (res.status === 404 || res.status === 410 || res.status === 451) {
        vanishedMap.set(r.full_name.toLowerCase(), {
          full_name: r.full_name,
          url: r.url,
          description: r.description || "",
          language: r.language || "",
          stars: r.stars || 0,
          tags: r.tags || "",
          note: r.note || "",
          vanished_at: new Date().toISOString(),
          status: `HTTP ${res.status} 已删库/不可访问`,
        });
        found++;
      }
    }
    state.vanished = Array.from(vanishedMap.values()).slice(0, 200);
    await setStoredObj(K.vanished, state.vanished);
    renderVanishedSection();
    showToast(found ? `巡检 ${sample.length} 个仓库，发现 ${found} 个失联/404` : `已巡检 ${sample.length} 个高风险仓库，全部可访问`);
  } catch (e) {
    showToast("巡检中断：" + e.message, { isError: true });
  } finally {
    btn.disabled = false;
    btn.textContent = "巡检 404 失联库";
  }
}

/* ---------------- GitHub 原生 Star Lists 同步（GraphQL API） ---------------- */

async function graphqlApi(query, variables) {
  if (!state.token || state.token === "demo_mode") {
    throw new Error("请先配置真实 GitHub Token");
  }
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + state.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  if (!res.ok) throw new Error("GraphQL HTTP " + res.status);
  const data = await res.json();
  if (data.errors && data.errors.length) {
    throw new Error(data.errors[0].message || "GraphQL 权限不足（操作 Star Lists 需要 user 权限）");
  }
  return data.data;
}

async function pullGithubLists(btn) {
  if (btn) { btn.disabled = true; btn.textContent = "导入中…"; }
  try {
    const q = `query {
      viewer {
        lists(first: 32) {
          nodes {
            id
            name
            items(first: 100) {
              nodes { ... on Repository { databaseId nameWithOwner } }
            }
          }
        }
      }
    }`;
    const data = await graphqlApi(q);
    const lists = (data && data.viewer && data.viewer.lists && data.viewer.lists.nodes) || [];
    if (!lists.length) {
      showToast("你的 GitHub 账号下暂无 Star Lists");
      return;
    }
    const byName = new Map(state.repos.map((r) => [(r.full_name || "").toLowerCase(), r]));
    const touched = new Set();
    let applied = 0;
    for (const lst of lists) {
      const slug = String(lst.name || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/^#+/, "");
      if (!slug) continue;
      const items = (lst.items && lst.items.nodes) || [];
      for (const it of items) {
        if (!it || !it.nameWithOwner) continue;
        const r = byName.get(it.nameWithOwner.toLowerCase());
        if (!r) continue;
        const set = new Set((r.tags || "").split(/\s+/).filter(Boolean));
        if (!set.has(slug)) {
          set.add(slug);
          r.tags = Array.from(set).join(" ");
          touched.add(r.id);
          applied++;
        }
      }
    }
    if (touched.size) {
      await saveRepos(state.repos, { all: false, touched: Array.from(touched) });
      applyFilters();
      if (!$("tagManagerDialog").classList.contains("hidden")) renderTagManager();
    }
    showToast(`已从 ${lists.length} 个 GitHub Lists 导入 ${applied} 条标签关联`);
  } catch (e) {
    showToast("导入 Lists 失败：" + e.message, { isError: true });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.id === "tagMgrPullLists" ? "从 GitHub Lists 导入" : "导入 GitHub Lists";
    }
  }
}

async function pushTagsToGithubLists(btn) {
  const { tags } = collectTagStats();
  if (!tags.length) {
    showToast("本地暂无自定义 #标签 可推送");
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "推送中…"; }
  try {
    // 1. 拉取现有 Lists（GitHub 上限 32 个）
    const existingData = await graphqlApi(`query { viewer { lists(first: 32) { nodes { id name } } } }`);
    const existingNodes = (existingData && existingData.viewer && existingData.viewer.lists && existingData.viewer.lists.nodes) || [];
    const listIdByName = new Map(existingNodes.map((n) => [String(n.name || "").trim().toLowerCase(), n.id]));

    // 2. 为本地高频标签补建缺失 Lists（总量不超过 32）
    const topTags = tags.slice(0, 32).map(([t]) => t);
    let created = 0;
    for (const tag of topTags) {
      if (listIdByName.has(tag)) continue;
      if (listIdByName.size >= 32) break;
      const res = await graphqlApi(
        `mutation($name: String!) { createUserList(input: { name: $name, description: "Synced from grepo" }) { list { id name } } }`,
        { name: tag }
      );
      const createdList = res && res.createUserList && res.createUserList.list;
      if (createdList && createdList.id) {
        listIdByName.set(tag, createdList.id);
        created++;
      }
    }

    // 3. 按仓库查询 node_id 并更新所属 Lists（单批最多处理 40 个已打标仓库防限流）
    const taggedRepos = state.repos.filter((r) => (r.tags || "").trim()).slice(0, 40);
    let syncedRepos = 0;
    for (const r of taggedRepos) {
      const [owner, name] = (r.full_name || "").split("/");
      if (!owner || !name) continue;
      const repoTags = (r.tags || "").split(/\s+/).filter(Boolean);
      const targetListIds = repoTags.map((t) => listIdByName.get(t)).filter(Boolean);
      if (!targetListIds.length) continue;
      const nodeRes = await graphqlApi(
        `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id lists(first: 32) { nodes { id } } } }`,
        { owner, name }
      );
      const repoNode = nodeRes && nodeRes.repository;
      if (!repoNode || !repoNode.id) continue;
      const curIds = ((repoNode.lists && repoNode.lists.nodes) || []).map((x) => x.id);
      const mergedIds = Array.from(new Set(curIds.concat(targetListIds)));
      await graphqlApi(
        `mutation($itemId: ID!, $listIds: [ID!]!) { updateUserListsForItem(input: { itemId: $itemId, listIds: $listIds }) { item { ... on Repository { id } } } }`,
        { itemId: repoNode.id, listIds: mergedIds }
      );
      syncedRepos++;
    }
    showToast(`Lists 同步完成：新建 ${created} 个列表，更新 ${syncedRepos} 个仓库`);
  } catch (e) {
    showToast("推送 Lists 失败：" + e.message, { isError: true });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.id === "tagMgrPushLists" ? "推送标签到 GitHub Lists" : "推送标签到 Lists";
    }
  }
}

function openInsightsDialog(initialTab = "overview") {
  insightsLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  renderInsights();
  $("insightsDialog").classList.remove("hidden");
  setModalOpen(true);
  switchInsightsTab(initialTab);
  requestAnimationFrame(() => $("insightsClose")?.focus());
}

function closeInsightsDialog() {
  stopConstellation();
  $("insightsDialog").classList.add("hidden");
  setModalOpen(false);
  if (insightsLastFocus && insightsLastFocus.isConnected) insightsLastFocus.focus();
  insightsLastFocus = null;
}

function initInsightsDialog() {
  $("insightsBtn")?.addEventListener("click", () => openInsightsDialog("overview"));
  $("insightsClose")?.addEventListener("click", closeInsightsDialog);
  $("insightsTabPick")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-itab]");
    if (b) switchInsightsTab(b.dataset.itab);
  });
  $("checkReleasesBtn")?.addEventListener("click", () => checkPinnedReleases($("checkReleasesBtn")));
  $("insightsDialog")?.addEventListener("click", (e) => {
    if (e.target.dataset.close) { closeInsightsDialog(); return; }
    const dslBtn = e.target.closest("[data-dsl]");
    if (dslBtn) {
      const dsl = dslBtn.dataset.dsl;
      closeInsightsDialog();
      filterByTag(dsl);
      return;
    }
    const langBtn = e.target.closest("[data-lang-pick]");
    if (langBtn) {
      const lang = langBtn.dataset.langPick;
      closeInsightsDialog();
      if (state.view !== "mine") setView("mine");
      if (state.scope !== "local") setScope("local");
      $("lang").value = lang;
      $("langSelect")?._refresh?.();
      applyFilters();
      return;
    }
    const rndBtn = e.target.closest("[data-random-repo]");
    if (rndBtn) {
      const r = findLocal(rndBtn.dataset.randomRepo);
      closeInsightsDialog();
      if (r) openRepoDetail(r);
    }
  });
  $("insightsRandomRefresh")?.addEventListener("click", renderInsightsRandom);
  $("scan404Btn")?.addEventListener("click", scan404Repos);
  $("clearVanishedBtn")?.addEventListener("click", async () => {
    state.vanished = [];
    await setStoredObj(K.vanished, []);
    renderVanishedSection();
    showToast("已清空失联记录");
  });
  initConstellationControls();
}

/* ---------------- Privacy-First AI 引擎（BYOK / 本地 Ollama） ---------------- */

async function ensureAiOriginPermission(baseUrl) {
  if (typeof chrome === "undefined" || !chrome.permissions) return true;
  try {
    const u = new URL(baseUrl);
    const origin = `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}/*`;
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return true;
  }
}

async function callAiChat(systemPrompt, userPrompt) {
  const cfg = state.aiConfig || {};
  if (!cfg.baseUrl || !cfg.model) {
    throw new Error("请先在右上角「设置」中配置本地 Ollama 或 OpenAI 兼容接口");
  }
  const granted = await ensureAiOriginPermission(cfg.baseUrl);
  if (!granted) throw new Error("未授予 AI 接口域名访问权限");

  const endpoint = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const headers = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = "Bearer " + cfg.apiKey;

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (e) {
    throw new Error("无法连接 AI 接口：" + e.message);
  }
  if (!res.ok) {
    throw new Error("AI 接口返回 HTTP " + res.status);
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error("AI 未返回有效内容");
  return String(content).trim();
}

async function aiAnnotateRepo(r) {
  const cached = state.readmeCache[(r.full_name || "").toLowerCase()];
  const prompt = [
    `仓库：${r.full_name}`,
    `语言：${r.language || "未知"}`,
    `描述：${r.description || "无"}`,
    `Topics：${(r.topics || []).join(", ") || "无"}`,
    cached && cached.text ? `README 摘录：${cached.text.slice(0, 600)}` : "",
  ].filter(Boolean).join("\n");

  const raw = await callAiChat(
    '你是开发者知识库整理助手。请根据 GitHub 仓库信息输出严格 JSON：{"note":"一句简洁中文说明核心用途（≤40字）","tags":["小写英文或简短中文标签，2到3个"]}，不要输出多余 Markdown 围栏。',
    prompt
  );
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 输出格式无法解析");
  const obj = JSON.parse(m[0]);
  const tags = Array.isArray(obj.tags)
    ? obj.tags.map((x) => String(x).trim().toLowerCase().replace(/\s+/g, "-").replace(/^#+/, "")).filter(Boolean).slice(0, 4).join(" ")
    : String(obj.tags || "").trim();
  const note = String(obj.note || "").trim();
  return { tags, note };
}

let aiResultLastFocus = null;

function openAiResultDialog(title, sub, markdownOrHtml, isHtml = false) {
  aiResultLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $("aiResultTitle").textContent = title;
  $("aiResultSub").textContent = sub || "";
  $("aiResultBody").innerHTML = isHtml ? markdownOrHtml : renderMarkdown(markdownOrHtml);
  $("aiResultDialog").classList.remove("hidden");
  setModalOpen(true);
  requestAnimationFrame(() => $("aiResultClose")?.focus());
}

function closeAiResultDialog() {
  $("aiResultDialog").classList.add("hidden");
  setModalOpen(false);
  if (aiResultLastFocus && aiResultLastFocus.isConnected) aiResultLastFocus.focus();
  aiResultLastFocus = null;
}

function initAiResultDialog() {
  $("aiResultClose")?.addEventListener("click", closeAiResultDialog);
  $("aiResultDialog")?.addEventListener("click", (e) => {
    if (e.target.dataset.close) { closeAiResultDialog(); return; }
    const item = e.target.closest("[data-ai-repo]");
    if (item) {
      const r = findLocal(item.dataset.aiRepo);
      closeAiResultDialog();
      if (r) openRepoDetail(r);
    }
  });
}

async function runAiSemanticSearch(query) {
  if (!query) return;
  $("searchWrap")?.classList.add("is-ai-thinking");
  openAiResultDialog("AI 语义找库", `正在你的 ${fmtCount(state.repos.length)} 个本地收藏中匹配「${query}」…`, '<p class="md-note">正在本地粗召回并请求 AI 语义重排…</p>', true);
  try {
    // 1. 本地轻量召回候选集（共享字符/关键词 + 热门高星兜底，共 45 条）
    const qTokens = query.toLowerCase().split(/[\s,，。？！]+/).filter((w) => w.length >= 2);
    const scored = state.repos.map((r) => {
      const text = `${r.full_name} ${r.description || ""} ${(r.topics || []).join(" ")} ${r.tags || ""} ${r.note || ""}`.toLowerCase();
      let s = Math.log10((r.stars || 0) + 1) * 0.4;
      for (const w of qTokens) if (text.includes(w)) s += 5;
      return { r, s };
    }).sort((a, b) => b.s - a.s).slice(0, 45);

    const catalog = scored.map(({ r }) =>
      `- ${r.full_name} [${r.language || "-"} ★${fmtNum(r.stars)}]: ${(r.note || r.description || "").slice(0, 100)} ${(r.topics || []).slice(0, 4).join(",")}`
    ).join("\n");

    const raw = await callAiChat(
      '你是 GitHub 本地收藏语义检索引擎。从候选清单里挑出最符合用户意图的 1 到 6 个仓库，严格返回 JSON 数组：[{"repo":"owner/name","reason":"一句中文匹配理由"}]。不要编造不在清单中的仓库。',
      `用户想找：${query}\n\n候选清单：\n${catalog}`
    );
    const m = raw.match(/\[[\s\S]*\]/);
    const picks = m ? JSON.parse(m[0]) : [];
    const html = picks.map((p) => {
      const r = findLocal(p.repo);
      if (!r) return "";
      return `<div class="ai-semantic-item" data-ai-repo="${escapeHtml(r.full_name)}">` +
        `<strong>${escapeHtml(r.full_name)}</strong> <span class="md-note">★ ${fmtNum(r.stars)} · ${escapeHtml(r.language || "未标注")}</span>` +
        `<div class="md-note">${escapeHtml(r.description || "")}</div>` +
        `<p class="ai-semantic-reason">推荐理由：${escapeHtml(p.reason || "")}</p>` +
      `</div>`;
    }).filter(Boolean).join("");

    $("aiResultSub").textContent = `针对「${query}」的语义匹配结果（点击查看详情）`;
    $("aiResultBody").innerHTML = html || '<p class="md-note">未找到高度匹配的本地收藏，可尝试切换 GitHub 全站搜索。</p>';
  } catch (e) {
    $("aiResultBody").innerHTML = `<p class="md-note">语义检索失败：${escapeHtml(e.message)}</p>`;
  } finally {
    $("searchWrap")?.classList.remove("is-ai-thinking");
  }
}

async function runAiCompareRepos(repos) {
  const names = repos.map((r) => r.full_name).join(" vs ");
  openAiResultDialog("AI 同类选型对比", names, '<p class="md-note">正在汇总仓库信息并生成结构化对比表…</p>', true);
  try {
    const details = repos.map((r) => {
      const cached = state.readmeCache[(r.full_name || "").toLowerCase()];
      return [
        `### ${r.full_name}`,
        `语言: ${r.language || "未知"} | Stars: ${r.stars || 0} | 最近推送: ${fmtDate(r.pushed_at)}`,
        `描述: ${r.description || "无"}`,
        `Topics: ${(r.topics || []).join(", ") || "无"}`,
        r.note ? `用户备注: ${r.note}` : "",
        cached && cached.text ? `README 摘录: ${cached.text.slice(0, 500)}` : "",
      ].filter(Boolean).join("\n");
    }).join("\n\n");

    const md = await callAiChat(
      "你是资深架构师。请对用户给出的多个 GitHub 开源仓库做客观、简洁的技术选型对比：1) 用 Markdown 表格对比「核心定位 / 优势 / 局限 / 适用场景」；2) 给出 2–3 条直接的选型建议。全部用中文输出。",
      details
    );
    $("aiResultBody").innerHTML = renderMarkdown(md);
  } catch (e) {
    $("aiResultBody").innerHTML = `<p class="md-note">对比生成失败：${escapeHtml(e.message)}</p>`;
  }
}

/* 页脚是吸底的，toast 要抬到它上面；高度可能因换行变化，量出来存成变量 */
function syncFootHeight() {
  const f = document.querySelector(".foot");
  if (!f) return;
  document.documentElement.style.setProperty("--foot-h", f.offsetHeight + "px");
}

function showToast(msg, options = {}) {
  const t = $("toast");
  if (!t) return;
  currentUndoAction = options.onAction || null;

  let actionHtml = "";
  if (options.actionText) {
    actionHtml = '<button type="button" class="toast-action" id="toastAction">' +
      escapeHtml(options.actionText) + '</button>';
  }

  const iconHtml = options.isError
    ? '<svg class="toast-err-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#f87171" stroke-width="2"><circle cx="8" cy="8" r="7"/><line x1="8" y1="5" x2="8" y2="8.5"/><circle cx="8" cy="11.5" r="0.5" fill="#f87171"/></svg>'
    : '<svg class="toast-check" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6.5-6.5"/></svg>';

  t.innerHTML = iconHtml + '<span class="toast-msg">' + escapeHtml(msg) + '</span>' + actionHtml;
  t.classList.remove("hidden");
  void t.offsetWidth;
  t.classList.add("show");

  const actionBtn = t.querySelector("#toastAction");
  if (actionBtn && currentUndoAction) {
    actionBtn.onclick = (e) => {
      e.stopPropagation();
      const fn = currentUndoAction;
      currentUndoAction = null;
      t.classList.remove("show");
      setTimeout(() => t.classList.add("hidden"), 180);
      fn();
    };
  }

  clearTimeout(toastTimer);
  const duration = options.duration || (options.actionText ? 5200 : 2200);
  toastTimer = setTimeout(() => {
    currentUndoAction = null;
    t.classList.remove("show");
    setTimeout(() => t.classList.add("hidden"), 200);
  }, duration);
}

/* 顶栏状态位只放短标签，完整消息（含条数）走 toast：
 * 否则同一个数字会同时出现在状态位、页签、结果行里 */
function flash(msg, label) {
  showToast(msg);
  const el = $("syncState");
  if (el) {
    el.dataset.busy = "1";
    el.textContent = label || msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      delete el.dataset.busy;
      el.textContent = state.syncing ? "同步中" : "";
    }, 2400);
  }
}

/* ---------------- 同步 UI ---------------- */

function setProgress(pct, label) {
  $("progressWrap").classList.remove("hidden");
  $("progressBar").style.width = Math.max(2, Math.min(100, pct)) + "%";
  $("syncState").textContent = label;
}

function hideProgress() {
  $("progressWrap").classList.add("hidden");
  $("progressBar").style.width = "0";
}

async function runSync(ev) {
  const wantFull = !!(ev && ev.shiftKey);
  if (state.syncing) return;
  if (!state.token || state.token === "demo_mode") return showSetup();

  // 先占住状态位，避免连点重复触发
  state.syncing = true;
  $("syncState").dataset.busy = "1";
  $("syncBtn").disabled = true;
  $("syncBtn").textContent = "同步中";

  // 模式先定下来，状态行才能如实告诉用户这一轮在干什么
  const lastFull = Number((await getStored(K.lastFull)) || 0);
  const stale = !lastFull || Date.now() - lastFull > 7 * 24 * 3600 * 1000;
  const full = wantFull || stale || !state.repos.length;
  $("syncState").textContent = (full ? "全量同步" : "增量同步") + " · 连接 GitHub";

  try {
    const res = await syncAll((p) => {
      const tag = p.mode === "full" ? "全量" : "增量";
      if (p.phase === "star") {
        setProgress(Math.min(45, (p.count / Math.max(p.count, 4000)) * 45),
          tag + " · 星标 " + fmtCount(p.count) + " · 第 " + p.page + " 页");
      } else {
        setProgress(45 + Math.min(45, (p.count / Math.max(p.count, 500)) * 45),
          tag + " · 自有与 fork " + fmtCount(p.count) + " · 第 " + p.page + " 页");
      }
    }, { full });
    if (res.full) await setStored(K.lastFull, Date.now());
    setProgress(100, "写入索引");
    buildLangOptions();
    updateTabCounts();
    applyFilters();
    if (res.full) {
      flash("全量同步完成 · " + fmtCount(res.total) + " 个仓库", "全量完成");
    } else if (res.changed > 0) {
      flash("增量同步 · 更新 " + fmtCount(res.changed) + " 条", "增量完成");
    } else {
      flash("已是最新 · " + fmtCount(res.total) + " 个仓库", "已是最新");
    }
    if (state.pinned && state.pinned.length) {
      checkPinnedReleases(null, { silent: true }).catch(() => {});
    }
  } catch (e) {
    console.error(e);
    flash(e.message);
    if (/token 无效/.test(e.message)) {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.remove(K.token);
      }
      state.token = "";
      showSetup(e.message);
    }
  } finally {
    state.syncing = false;
    delete $("syncState").dataset.busy;
    $("syncBtn").disabled = false;
    $("syncBtn").textContent = "同步";
    setTimeout(hideProgress, 500);
  }
}

/* ---------------- 自定义下拉菜单控制器 ---------------- */

function initCustomSelect(wrapId, selectId, opts = {}) {
  const wrap = $(wrapId);
  if (!wrap) return;
  const trigger = wrap.querySelector(".select-trigger");
  const label = wrap.querySelector(".select-label");
  const dropdown = wrap.querySelector(".select-dropdown");
  const sel = $(selectId);
  if (!trigger || !label || !dropdown || !sel) return;

  function updateTrigger() {
    const selectedOpt = sel.options[sel.selectedIndex];
    if (selectedOpt) {
      const rawText = selectedOpt.text;
      const m = rawText.match(/^(.+?)\s*\(\d+\)$/);
      label.textContent = m ? m[1] : rawText;
      label.title = rawText;
    }
    const isFiltered = sel.id === "lang" ? !!sel.value : sel.value !== "starred";
    wrap.classList.toggle("has-value", isFiltered);
  }

  function renderOptions() {
    dropdown.innerHTML = "";
    const currentVal = sel.value;
    Array.from(sel.options).forEach((opt) => {
      if (opt.hidden || opt.disabled) return;
      const item = document.createElement("div");
      const isSelected = opt.value === currentVal;
      item.className = "select-option" + (isSelected ? " is-selected" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", isSelected ? "true" : "false");
      item.setAttribute("tabindex", "-1");
      item.dataset.value = opt.value;

      let mainText = opt.text;
      let countText = "";
      const m = opt.text.match(/^(.+?)\s*\((\d+)\)$/);
      if (m) {
        mainText = m[1];
        countText = m[2];
      }

      const left = document.createElement("span");
      left.className = "opt-left";

      if (opts.hasLangDot && opt.value) {
        const dot = document.createElement("span");
        dot.className = "lang-dot";
        dot.dataset.lang = opt.value;
        left.appendChild(dot);
      }

      const txt = document.createElement("span");
      txt.className = "opt-label";
      txt.textContent = mainText;
      left.appendChild(txt);

      const right = document.createElement("span");
      right.className = "opt-right";

      if (countText) {
        const cnt = document.createElement("span");
        cnt.className = "opt-count";
        cnt.textContent = countText;
        right.appendChild(cnt);
      }

      const check = document.createElement("span");
      check.className = "opt-check";
      check.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6.5-6.5"/></svg>';
      right.appendChild(check);

      item.appendChild(left);
      item.appendChild(right);

      const choose = () => {
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
        close();
        trigger.focus();
      };

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        choose();
      });

      item.addEventListener("keydown", (e) => {
        const all = Array.from(dropdown.querySelectorAll(".select-option"));
        const idx = all.indexOf(item);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          all[(idx + 1) % all.length]?.focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          all[(idx - 1 + all.length) % all.length]?.focus();
        } else if (e.key === "Home") {
          e.preventDefault();
          all[0]?.focus();
        } else if (e.key === "End") {
          e.preventDefault();
          all[all.length - 1]?.focus();
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        } else if (e.key === "Escape") {
          e.preventDefault();
          close();
          trigger.focus();
        }
      });

      dropdown.appendChild(item);
    });
  }

  function open() {
    document.querySelectorAll(".custom-select.is-open").forEach((el) => {
      if (el !== wrap) {
        el.classList.remove("is-open");
        el.querySelector(".select-dropdown")?.classList.add("hidden");
        el.querySelector(".select-trigger")?.setAttribute("aria-expanded", "false");
      }
    });
    wrap.classList.add("is-open");
    dropdown.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");

    const selected = dropdown.querySelector(".select-option.is-selected");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  function close() {
    wrap.classList.remove("is-open");
    dropdown.classList.add("hidden");
    trigger.setAttribute("aria-expanded", "false");
  }

  function toggle() {
    if (wrap.classList.contains("is-open")) {
      close();
    } else {
      open();
    }
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!wrap.classList.contains("is-open")) {
        open();
      } else {
        const optsList = dropdown.querySelectorAll(".select-option");
        if (optsList.length) optsList[0].focus();
      }
    } else if (e.key === "Escape") {
      close();
    }
  });

  sel.addEventListener("change", () => {
    updateTrigger();
    renderOptions();
  });

  wrap._refresh = () => {
    renderOptions();
    updateTrigger();
  };
  wrap._close = close;

  renderOptions();
  updateTrigger();
}

/* ---------------- 初始化 ---------------- */

/* 语言分布按「当前页签 + 归档开关」统计，但不把语言自身算进去，
 * 否则选中 Java 之后其它语言会全部显示 0。 */
function buildLangOptions() {
  const showArchived = $("showArchived").checked;
  const kind = state.kind;
  const counts = new Map();
  const source = state.view === "trend" ? state.trend : state.repos;
  for (const r of source) {
    if (!r.language) continue;
    if (state.view !== "trend" && kind && r.kind !== kind) continue;
    if (!showArchived && r.archived) continue;
    counts.set(r.language, (counts.get(r.language) || 0) + 1);
  }

  const sel = $("lang");
  const prev = sel.value;
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  // 当前选中的语言在本页签下可能一条都没有：保留它并显示 0，别把筛选项悄悄弄丢
  if (prev && !counts.has(prev)) sorted.push([prev, 0]);

  sel.innerHTML = '<option value="">全部语言</option>' +
    sorted.map(([l, n]) =>
      '<option value="' + escapeHtml(l) + '">' + escapeHtml(l) + " (" + n + ")</option>"
    ).join("");
  if (prev) sel.value = prev;

  $("langSelect")?._refresh?.();
}

function showSetup(errMsg) {
  $("setup").classList.remove("hidden");
  $("app").classList.add("hidden");
  if (errMsg) {
    const el = $("setupErr");
    el.textContent = errMsg;
    el.classList.remove("hidden");
  }
  setTimeout(() => $("tokenInput").focus(), 60);
}

function showApp() {
  $("setup").classList.add("hidden");
  $("app").classList.remove("hidden");
  buildLangOptions();
  updateTabCounts();
  applyFilters();
  requestAnimationFrame(syncAllSegThumbs);
  setTimeout(() => $("q").focus(), 60);
}

function wireEvents() {
  initTheme();
  initTagDialog();
  initRepoDetail();
  initSettingsDialog();
  initSavedViews();
  initTagManager();
  initBatchBar();
  initInsightsDialog();
  initAiResultDialog();
  initPeekDrawer();
  initCmdPalette();
  initSpotlightTracker();

  $("layoutPick")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-layout]");
    if (b) saveLayout(b.dataset.layout);
  });

  $("filterPills")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-pill]");
    if (!btn) return;
    removeFilterPill(btn.dataset.removeKind, btn.dataset.removePill);
  });

  window.addEventListener("resize", () => {
    clearTimeout(window.__segResizeT);
    window.__segResizeT = setTimeout(syncAllSegThumbs, 90);
  }, { passive: true });

  const tokenToggle = $("tokenToggle");
  if (tokenToggle && $("tokenInput")) {
    tokenToggle.addEventListener("click", () => {
      const inp = $("tokenInput");
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      tokenToggle.textContent = show ? "隐藏" : "显示";
      tokenToggle.setAttribute("aria-label", show ? "隐藏 Token" : "显示 Token");
      inp.focus();
    });
    $("tokenInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        $("saveAndSync")?.click();
      }
    });
  }

  let t = 0;
  let histTimer = 0;
  $("q").addEventListener("input", () => {
    clearTimeout(t);
    clearTimeout(histTimer);
    syncSearchClear();
    // 本地过滤可以即时；搜 GitHub 要走配额，停手 0.6 秒再发
    if (state.scope === "github") {
      setDebouncing(true);
      t = setTimeout(() => {
        setDebouncing(false);
        runRemoteSearch();
        renderSuggest();
      }, 600);
    } else {
      t = setTimeout(() => {
        applyFilters();
        renderSuggest();
      }, 110);
      histTimer = setTimeout(() => {
        const val = $("q").value.trim();
        if (val.length >= 2 && state.filtered.length > 0) recordSearchHistory(val);
      }, 1200);
    }
  });

  $("searchClear")?.addEventListener("click", () => {
    $("q").value = "";
    syncSearchClear();
    hideSuggest();
    if (state.scope === "github") {
      state.remote = [];
      state.remoteErr = "";
      state.remoteQuery = "";
      applyFilters();
    } else {
      applyFilters();
    }
    $("q").focus();
  });

  $("q").addEventListener("focus", renderSuggest);

  // 作用域药丸切换
  $("scopePill").addEventListener("click", (e) => {
    const btn = e.target.closest(".scope-btn");
    if (btn && btn.dataset.scope) {
      setScope(btn.dataset.scope);
      $("q").focus();
    }
  });

  // 建议面板：点「搜索整个 GitHub」「AI 语义找库」「历史记录」或某条本地命中
  $("suggest").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act) {
      const a = act.dataset.act;
      if (a === "clear-history") {
        state.searchHistory = [];
        setStoredObj(K.searchHistory, []);
        hideSuggest();
        return;
      }
      if (a === "ai-semantic-suggest") {
        const qVal = $("q").value.trim();
        hideSuggest();
        recordSearchHistory(qVal);
        runAiSemanticSearch(qVal);
        return;
      }
      hideSuggest();
      setScope(a === "scope-github" ? "github" : "local");
      return;
    }
    const dslBtn = e.target.closest("[data-dsl-insert]");
    if (dslBtn) {
      applyDslInsert(dslBtn.dataset.dslInsert);
      return;
    }
    const histItem = e.target.closest("[data-history]");
    if (histItem) {
      $("q").value = histItem.dataset.history;
      syncSearchClear();
      hideSuggest();
      applyFilters();
      $("q").focus();
      return;
    }
    const item = e.target.closest(".suggest-item");
    if (!item) return;
    const name = item.dataset.name;
    recordSearchHistory($("q").value.trim());
    hideSuggest();
    const r = state.repos.find((x) => x.full_name === name);
    if (r) openRepoDetail(r);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".searchwrap")) hideSuggest();
  });

  $("lang").addEventListener("change", applyFilters);
  $("sort").addEventListener("change", () => {
    if (state.scope === "github") runRemoteSearch();
    else applyFilters();
  });
  $("showArchived").addEventListener("change", () => {
    buildLangOptions();
    applyFilters();
  });

  // 初始化自定义浮动下拉框
  initCustomSelect("langSelect", "lang", { hasLangDot: true });
  initCustomSelect("sortSelect", "sort");

  // 点击外部收起所有下拉菜单
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".custom-select")) {
      document.querySelectorAll(".custom-select.is-open").forEach((el) => {
        el.classList.remove("is-open");
        el.querySelector(".select-dropdown")?.classList.add("hidden");
        el.querySelector(".select-trigger")?.setAttribute("aria-expanded", "false");
      });
    }
  });

  $("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) setKind(btn.dataset.kind || "");
  });

  $("syncBtn").addEventListener("click", runSync);

  $("scopeBack").addEventListener("click", () => setScope("local"));

  $("viewPick").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.dataset.view === state.view) return;

    await fadeListOut();
    window.scrollTo(0, 0); // 换视图别停在上一屏的位置
    setView(btn.dataset.view);
    fadeListIn();
    if (state.view !== "trend") return;

    $("trendRefresh").classList.remove("hidden");
    await loadTrending(false);
  });

  $("periodPick").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) switchPeriod(btn.dataset.period);
  });

  $("trendRefresh").addEventListener("click", () => loadTrending(true));


  $("list").addEventListener("click", (e) => {
    // 点击全站引导语法芯片
    const chip = e.target.closest(".gh-chip");
    if (chip && chip.dataset.query) {
      setScope("github");
      $("q").value = chip.dataset.query;
      syncSearchClear();
      $("q").focus();
      runRemoteSearch();
      return;
    }

    // 本地空态一键切全站搜索
    const toGithubBtn = e.target.closest('[data-act="scope-to-github"]');
    if (toGithubBtn) {
      setScope("github");
      $("q").focus();
      return;
    }

    // 本地空态 AI 语义找库
    const aiSemBtn = e.target.closest('[data-act="ai-semantic"]');
    if (aiSemBtn) {
      runAiSemanticSearch($("q").value.trim());
      return;
    }

    // 空态里的「清空搜索条件」
    const resetBtn = e.target.closest('[data-act="reset-filters"]');
    if (resetBtn) {
      resetFilters();
      return;
    }

    // 远程搜索失败后的重试
    const retryBtn = e.target.closest('[data-act="retry-remote"]');
    if (retryBtn) {
      runRemoteSearch();
      return;
    }

    // 点击卡片上的标签 / topic 芯片，直接按该标签过滤
    const filterTag = e.target.closest("[data-filter-tag]");
    if (filterTag) {
      e.stopPropagation();
      filterByTag(filterTag.dataset.filterTag);
      return;
    }

    const actBtn = e.target.closest(".row-act");
    if (actBtn) {
      e.stopPropagation();
      const item = actBtn.closest(".row");
      if (!item) return;
      const idx = Number(item.dataset.idx);
      const r = state.filtered[idx];
      if (!r) return;
      state.sel = idx;
      $("list").querySelectorAll(".row.sel").forEach((el) => el.classList.remove("sel"));
      item.classList.add("sel");

      const act = actBtn.dataset.act;
      if (act === "copy") {
        navigator.clipboard.writeText(r.url)
          .then(() => showToast("已复制链接到剪贴板"))
          .catch((err) => showToast("复制失败：" + err.message));
      } else if (act === "tag") {
        editTags();
      } else if (act === "star") {
        toggleStar(r, actBtn);
      } else if (act === "detail") {
        openRepoDetail(r);
      }
      return;
    }

    const item = e.target.closest(".row");
    if (!item) return;
    if (e.target.closest("a")) return;
    const idx = Number(item.dataset.idx);
    const repo = state.filtered[idx];
    if (state.batchMode && repo) {
      if (state.batchSelected.has(repo.id)) state.batchSelected.delete(repo.id);
      else state.batchSelected.add(repo.id);
      const checked = state.batchSelected.has(repo.id);
      item.classList.toggle("is-checked", checked);
      const cb = item.querySelector(".row-check");
      if (cb) cb.checked = checked;
      updateBatchBar();
      return;
    }
    state.sel = idx;
    $("list").querySelectorAll(".row.sel").forEach((el) => el.classList.remove("sel"));
    item.classList.add("sel");
    // 开启联动预览抽屉时，点行即时在右侧预览；默认保持点行打开详情弹窗（兼容全量交互契约）
    if (state.peekOpen) {
      openPeekForRepo(repo, { immediate: true });
    } else {
      openRepoDetail(repo);
    }
  });

  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.shown < state.filtered.length) {
      renderList(false);
    }
  }, { rootMargin: "600px" });
  io.observe($("sentinel"));

  // 滚动后收起标题行，加迟滞区间（>64 折叠、<16 展开）防止临界抖动
  if (window.matchMedia("(min-width: 721px)").matches) {
    const shellEl = document.querySelector(".shell");
    let isCompact = false;
    window.addEventListener("scroll", () => {
      const y = window.scrollY;
      if (!isCompact && y > 64) {
        isCompact = true;
        shellEl.classList.add("compact");
      } else if (isCompact && y < 16) {
        isCompact = false;
        shellEl.classList.remove("compact");
      }
    }, { passive: true });
  }

  document.addEventListener("keydown", (e) => {
    // 全局命令面板 ⌘K / Ctrl+K（任意焦点皆可呼出）
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K") && !e.altKey) {
      if (!$("app").classList.contains("hidden")) {
        e.preventDefault();
        if ($("cmdDialog").classList.contains("hidden")) openCmdPalette();
        else closeCmdPalette();
        return;
      }
    }

    // 撤销快捷键 ⌘Z / Ctrl+Z
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
      if (currentUndoAction) {
        e.preventDefault();
        const fn = currentUndoAction;
        currentUndoAction = null;
        const t = $("toast");
        if (t) {
          t.classList.remove("show");
          setTimeout(() => t.classList.add("hidden"), 180);
        }
        fn();
        return;
      }
    }

    // 任意弹窗打开时先拦截弹窗级快捷键（包括全局 Esc，不受焦点位置影响）
    if (!$("cmdDialog").classList.contains("hidden")) {
      if (e.key === "Escape") { e.preventDefault(); closeCmdPalette(); }
      return;
    }
    if (!$("aiResultDialog").classList.contains("hidden")) {
      if (e.key === "Escape") { e.preventDefault(); closeAiResultDialog(); }
      return;
    }
    if (!$("insightsDialog").classList.contains("hidden")) {
      if (e.key === "Escape") { e.preventDefault(); closeInsightsDialog(); }
      return;
    }
    if (!$("tagManagerDialog").classList.contains("hidden")) {
      if (e.key === "Escape") { e.preventDefault(); closeTagManager(); }
      return;
    }
    if (!$("settingsDialog").classList.contains("hidden")) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSettingsDialog();
      }
      return;
    }
    if (!$("repoDialog").classList.contains("hidden")) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRepoDetail();
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        if (detailRepo) toggleStar(detailRepo, $("repoStarBtn"));
        return;
      }
      return;
    }
    if (!$("tagDialog").classList.contains("hidden")) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeTagDialog();
      }
      return;
    }

    // 作用域切换快捷键 ⌥S / Alt+S（趋势视图无范围切换）
    if (e.altKey && (e.key === "s" || e.key === "S" || e.code === "KeyS")) {
      if (state.view === "trend") return;
      e.preventDefault();
      setScope(state.scope === "github" ? "local" : "github");
      return;
    }

    // 键盘物理按键触感动画映射
    const kbdSel = (e.metaKey || e.ctrlKey) && e.key === "Enter"
      ? 'kbd[data-key="Meta+Enter"]'
      : (e.altKey && (e.key === "s" || e.key === "S")
          ? 'kbd[data-key="Alt+s"]'
          : `kbd[data-key="${e.key}"]`);
    const kbdEl = document.querySelector(kbdSel);
    if (kbdEl) {
      kbdEl.classList.add("is-pressed");
      setTimeout(() => kbdEl.classList.remove("is-pressed"), 140);
    }

    const inInput = e.target === $("q");

    if (inInput) {
      const suggestOpen = !$("suggest").classList.contains("hidden");
      // 建议面板展开时支持上下键与回车直达
      if (suggestOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        moveSuggest(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (suggestOpen && e.key === "Enter" && suggestIdx >= 0) {
        const btns = suggestButtons();
        if (btns[suggestIdx]) {
          e.preventDefault();
          btns[suggestIdx].click();
          return;
        }
      }
      // 在输入框中按 Tab 且无下拉面板时切换作用域（趋势视图除外）
      if (e.key === "Tab" && !suggestOpen && state.view !== "trend") {
        e.preventDefault();
        setScope(state.scope === "github" ? "local" : "github");
        return;
      }
      // 本地搜索空态时按 Enter 一键切为全站搜索
      if (e.key === "Enter" && state.scope === "local" && state.view !== "trend" && !state.filtered.length && $("q").value.trim()) {
        e.preventDefault();
        setScope("github");
        return;
      }
    }

    if (e.key === "/" && !inInput) {
      e.preventDefault();
      $("q").focus();
      $("q").select();
      return;
    }
    if (e.key === "Escape") {
      const themePop = $("themePopover");
      if (themePop && !themePop.classList.contains("hidden")) {
        closeThemePopover();
        $("themeMenuBtn")?.focus();
        return;
      }
      const openSelect = document.querySelector(".custom-select.is-open");
      if (openSelect) {
        openSelect.classList.remove("is-open");
        openSelect.querySelector(".select-dropdown")?.classList.add("hidden");
        openSelect.querySelector(".select-trigger")?.setAttribute("aria-expanded", "false");
        openSelect.querySelector(".select-trigger")?.focus();
        return;
      }
      // 面板开着时，Esc 先收面板，不直接清掉搜索词
      if (!$("suggest").classList.contains("hidden")) {
        hideSuggest();
        return;
      }
      if (state.peekOpen && !inInput) {
        closePeekDrawer();
        return;
      }
      if (inInput && $("q").value) {
        $("q").value = "";
        syncSearchClear();
        if (state.scope === "github") {
          setScope("local");
        } else {
          applyFilters();
        }
        hideSuggest();
      } else if (state.scope === "github") {
        setScope("local");
      } else {
        $("q").blur();
      }
      return;
    }
    if (inInput && e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") {
      return;
    }

    if (e.key === "ArrowDown" || (e.key === "j" && !inInput)) {
      e.preventDefault();
      moveSel(1);
    } else if (e.key === "ArrowUp" || (e.key === "k" && !inInput)) {
      e.preventDefault();
      moveSel(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) copyCurrent();
      else openCurrent();
    } else if (e.key === "s" && !inInput) {
      e.preventDefault();
      if (state.sel < 0 && state.filtered.length) {
        moveSel(1);
      }
      if (state.sel >= 0 && state.filtered[state.sel]) {
        const item = $("list").querySelector(`.row[data-idx="${state.sel}"]`);
        const starBtn = item ? item.querySelector('button[data-act="star"]') : null;
        toggleStar(state.filtered[state.sel], starBtn);
      }
    } else if (e.key === "t" && !inInput) {
      e.preventDefault();
      if (state.sel < 0) moveSel(1);
      editTags();
    } else if (e.key === "o" && !inInput) {
      e.preventDefault();
      openCurrent();
    } else if (e.key === "i" && !inInput) {
      e.preventDefault();
      openInsightsDialog();
    } else if ((e.key === " " || e.key === "p" || e.key === "P") && !inInput && !(e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName))) {
      e.preventDefault();
      togglePeekDrawer();
    }
  });

  $("saveAndSync").addEventListener("click", async () => {
    const v = $("tokenInput").value.trim();
    const err = $("setupErr");
    if (!v) {
      err.textContent = "请先粘贴 GitHub Token";
      err.classList.remove("hidden");
      return;
    }
    err.classList.add("hidden");
    $("saveAndSync").disabled = true;
    $("saveAndSync").textContent = "正在验证...";

    await saveToken(v);
    try {
      await api("/user", {});
    } catch (e) {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.remove(K.token);
      }
      state.token = "";
      err.textContent = e.message;
      err.classList.remove("hidden");
      $("saveAndSync").disabled = false;
      $("saveAndSync").textContent = "保存并开始同步";
      return;
    }

    $("saveAndSync").disabled = false;
    $("saveAndSync").textContent = "保存并开始同步";
    showApp();
    runSync();
  });
}

/* ============================================================================
 * v3 性能优先光学微交互 + 筛选胶囊 + 联动抽屉 + ⌘K 命令面板 + 热力图 + 星图 + 版本雷达 + README 预热
 * ============================================================================ */

/* ---------------- 1. 60fps 零重排鼠标聚光灯 + 弹性滑动指示胶囊 + Star 星芒 + KPI 计数 ---------------- */

function initSpotlightTracker() {
  if (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  const SEL = ".row, .kpi-card, .health-chip, .random-card";
  let activeEl = null;
  let activeRect = null;
  let rafId = 0;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener("scroll", () => {
    activeRect = null;
  }, { passive: true });

  document.addEventListener("pointerover", (e) => {
    const card = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (card !== activeEl) {
      activeEl = card;
      activeRect = card ? card.getBoundingClientRect() : null;
    }
  }, { passive: true });

  document.addEventListener("pointermove", (e) => {
    if (!activeEl) return;
    lastX = e.clientX;
    lastY = e.clientY;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!activeEl || !activeEl.isConnected) return;
      if (!activeRect) activeRect = activeEl.getBoundingClientRect();
      const x = Math.round(lastX - activeRect.left);
      const y = Math.round(lastY - activeRect.top);
      activeEl.style.setProperty("--mx", x + "px");
      activeEl.style.setProperty("--my", y + "px");
    });
  }, { passive: true });
}

function syncSegThumb(group) {
  if (!group || group.classList.contains("hidden")) return;
  const thumb = group.querySelector(":scope > .seg-thumb");
  const active = group.querySelector(":scope > button.on");
  if (!thumb || !active) return;
  const w = active.offsetWidth;
  if (!w) return;
  const x = active.offsetLeft;
  thumb.style.width = w + "px";
  thumb.style.transform = `translate3d(${x}px, 0, 0)`;
  group.classList.add("has-thumb");
}

function syncAllSegThumbs() {
  syncSegThumb($("viewPick"));
  syncSegThumb($("scopePill"));
  syncSegThumb($("tabs"));
  syncSegThumb($("periodPick"));
}

function spawnStarburst(anchorEl) {
  if (!anchorEl || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = anchorEl.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const wrap = document.createElement("span");
  wrap.className = "star-burst";
  wrap.style.left = cx + "px";
  wrap.style.top = cy + "px";
  const count = 7;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
    const dist = 20 + Math.random() * 14;
    const p = document.createElement("span");
    p.className = "star-particle";
    p.style.setProperty("--dx", Math.round(Math.cos(angle) * dist) + "px");
    p.style.setProperty("--dy", Math.round(Math.sin(angle) * dist) + "px");
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 460);
}

function animateCountUp(el, target, formatter) {
  if (!el || !isFinite(target) || target <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (el) el.textContent = formatter(target);
    return;
  }
  const dur = 340;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatter(target * eased);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = formatter(target);
  }
  requestAnimationFrame(tick);
}

/* ---------------- 2. 缓存分面索引、DSL 自动补全、彩色筛选胶囊、标签建议与离线相似推荐 ---------------- */

let _facetCache = null;

function invalidateFacetCache() {
  _facetCache = null;
}

function getFacetIndex() {
  if (_facetCache && _facetCache.len === state.repos.length) return _facetCache;
  const langs = new Map();
  const tags = new Map();
  const owners = new Map();
  for (const r of state.repos) {
    if (r.language) langs.set(r.language, (langs.get(r.language) || 0) + 1);
    if (r.owner) owners.set(r.owner, (owners.get(r.owner) || 0) + 1);
    for (const tg of (r.tags || "").split(/\s+/).filter(Boolean)) {
      tags.set(tg, (tags.get(tg) || 0) + 1);
    }
  }
  _facetCache = {
    len: state.repos.length,
    langs: Array.from(langs.entries()).sort((a, b) => b[1] - a[1]),
    tags: Array.from(tags.entries()).sort((a, b) => b[1] - a[1]),
    owners: Array.from(owners.entries()).sort((a, b) => b[1] - a[1]),
  };
  return _facetCache;
}

function buildDslAutocomplete(rawValue) {
  const raw = String(rawValue || "");
  if (!raw || /\s$/.test(raw)) return [];
  const parts = raw.split(/\s+/);
  const last = parts[parts.length - 1] || "";
  const lower = last.toLowerCase();
  const neg = lower.startsWith("-") ? "-" : "";
  const body = neg ? lower.slice(1) : lower;
  const facets = getFacetIndex();
  const items = [];

  if (body.startsWith("lang:") || body.startsWith("language:")) {
    const prefix = body.slice(body.indexOf(":") + 1);
    for (const [l, n] of facets.langs) {
      if (!prefix || l.toLowerCase().includes(prefix)) {
        const tok = l.includes(" ") ? `"${l}"` : l.toLowerCase();
        items.push({ label: `${neg}lang:${tok}`, insert: `${neg}lang:${l.toLowerCase().replace(/\s+/g, "-")}`, desc: `${l} (${n})` });
      }
      if (items.length >= 6) break;
    }
    return items;
  }

  if (body.startsWith("#") || body.startsWith("tag:")) {
    const isHash = body.startsWith("#");
    const prefix = isHash ? body.slice(1) : body.slice(4);
    for (const [tg, n] of facets.tags) {
      if (!prefix || tg.includes(prefix)) {
        const ins = isHash ? `${neg}#${tg}` : `${neg}tag:${tg}`;
        items.push({ label: ins, insert: ins, desc: `自定义标签 (${n})` });
      }
      if (items.length >= 6) break;
    }
    return items;
  }

  if (body.startsWith("owner:")) {
    const prefix = body.slice(6);
    for (const [o, n] of facets.owners) {
      if (!prefix || o.toLowerCase().includes(prefix)) {
        items.push({ label: `owner:${o}`, insert: `owner:${o}`, desc: `作者 / 组织 (${n})` });
      }
      if (items.length >= 6) break;
    }
    return items;
  }

  if (body.startsWith("is:") || body.startsWith("has:") || body.startsWith("no:")) {
    const flags = [
      ["is:pinned", "已置顶追踪版本的重点库"],
      ["is:rising", "近期星标上涨黑马"],
      ["is:archived", "已归档仓库"],
      ["is:stale", "超过 2 年未提交"],
      ["is:fork", "我的 Fork"],
      ["is:owned", "我自建的仓库"],
      ["has:tag", "已打自定义标签"],
      ["no:tag", "尚未打标签（待整理）"],
      ["has:note", "已写个人中文备注"],
      ["no:note", "尚未写备注"],
    ];
    for (const [f, d] of flags) {
      if (f.startsWith(body)) items.push({ label: neg + f, insert: neg + f, desc: d });
    }
    return items.slice(0, 6);
  }

  if (body.startsWith("stars:")) {
    return [
      { label: "stars:>1k", insert: "stars:>1k", desc: "星标大于 1,000" },
      { label: "stars:>10k", insert: "stars:>10k", desc: "万星殿堂项目" },
      { label: "stars:>50k", insert: "stars:>50k", desc: "50k+ 顶级开源项目" },
      { label: "stars:<500", insert: "stars:<500", desc: "小众宝藏项目" },
    ].filter((x) => x.label.startsWith(body));
  }

  if (body.startsWith("pushed:") || body.startsWith("starred:")) {
    const k = body.startsWith("pushed:") ? "pushed" : "starred";
    const yr = new Date().getFullYear();
    return [
      { label: `${k}:>${yr}-01`, insert: `${k}:>${yr}-01`, desc: `${yr} 年以来` },
      { label: `${k}:${yr}`, insert: `${k}:${yr}`, desc: `仅 ${yr} 年` },
      { label: `${k}:${yr - 1}`, insert: `${k}:${yr - 1}`, desc: `仅 ${yr - 1} 年` },
    ];
  }
  return [];
}

function applyDslInsert(insertText) {
  const inp = $("q");
  const raw = inp.value;
  const next = raw.replace(/\S+$/, insertText) + " ";
  inp.value = next;
  syncSearchClear();
  applyFilters();
  renderSuggest();
  inp.focus();
}

function renderFilterPills() {
  const bar = $("filterPills");
  if (!bar) return;
  if (state.scope === "github" || state.view === "trend") {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  const pills = [];
  const langVal = $("lang").value;
  if (langVal) {
    pills.push({ kind: "langSelect", val: langVal, label: `语言: ${langVal}`, ptype: "lang" });
  }
  const rawQ = $("q").value.trim();
  if (rawQ) {
    const tokens = rawQ.split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      if (tok === "OR") continue;
      const neg = tok.startsWith("-") && tok.length > 1;
      const body = neg ? tok.slice(1) : tok;
      if (body.startsWith("#") && body.length > 1) {
        pills.push({ kind: "token", val: tok, label: tok, ptype: neg ? "exclude" : "tag" });
      } else if (/^(lang|language|tag|topic|owner|user|org|stars|star|pushed|starred|has|no|is):.+$/i.test(body)) {
        const ptype = neg ? "exclude" : (/^(has|no|is):/i.test(body) ? "flag" : (/^(tag|topic):/i.test(body) ? "tag" : "lang"));
        pills.push({ kind: "token", val: tok, label: tok, ptype });
      } else if (neg) {
        pills.push({ kind: "token", val: tok, label: `排除 ${body}`, ptype: "exclude" });
      }
    }
  }
  if (!pills.length) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  bar.innerHTML = pills.map((p) =>
    `<span class="fpill" data-ptype="${p.ptype}">` +
      `<span>${escapeHtml(p.label)}</span>` +
      `<button type="button" class="fpill-x" data-remove-kind="${p.kind}" data-remove-pill="${escapeHtml(p.val)}" aria-label="移除筛选 ${escapeHtml(p.label)}">×</button>` +
    `</span>`
  ).join("") +
    (pills.length > 1 ? '<button type="button" class="link-btn" data-remove-kind="all" data-remove-pill="all">清空全部</button>' : "");
  bar.classList.remove("hidden");
}

function removeFilterPill(kind, value) {
  if (kind === "all") {
    resetFilters();
    return;
  }
  if (kind === "langSelect") {
    $("lang").value = "";
    $("langSelect")?._refresh?.();
    applyFilters();
    return;
  }
  if (kind === "token") {
    const tokens = $("q").value.trim().split(/\s+/).filter(Boolean);
    const idx = tokens.indexOf(value);
    if (idx >= 0) tokens.splice(idx, 1);
    // 清理多余的孤立 OR
    while (tokens[0] === "OR") tokens.shift();
    while (tokens[tokens.length - 1] === "OR") tokens.pop();
    $("q").value = tokens.join(" ");
    syncSearchClear();
    applyFilters();
  }
}

function renderTagSuggestions() {
  const box = $("tagSuggestions");
  if (!box) return;
  invalidateFacetCache();
  const facets = getFacetIndex();
  if (!facets.tags.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const raw = $("tagInput").value || "";
  const curTokens = new Set(raw.trim().toLowerCase().split(/\s+/).filter(Boolean));
  const trailingSpace = /\s$/.test(raw);
  const lastWord = trailingSpace ? "" : (raw.trim().split(/\s+/).pop() || "").toLowerCase();
  // 若末尾词本身已是完整已有标签，则展示全部高频标签以便用户继续点选组合
  const filterPrefix = lastWord && !facets.tags.some(([tg]) => tg === lastWord) ? lastWord : "";
  const list = facets.tags
    .filter(([tg]) => !filterPrefix || curTokens.has(tg) || tg.includes(filterPrefix))
    .slice(0, 14);
  if (!list.length) {
    box.classList.add("hidden");
    return;
  }
  box.innerHTML = list.map(([tg, n]) =>
    `<button type="button" class="tag-sug-chip${curTokens.has(tg) ? " on" : ""}" data-sug-tag="${escapeHtml(tg)}">#${escapeHtml(tg)} · ${n}</button>`
  ).join("");
  box.classList.remove("hidden");
}

function computeSimilarRepos(target, limit = 4) {
  if (!target || !state.repos.length) return [];
  const targetKey = (target.full_name || "").toLowerCase();
  const tLang = (target.language || "").toLowerCase();
  const tTokens = new Set();
  for (const tp of target.topics || []) tTokens.add(String(tp).toLowerCase());
  for (const tg of (target.tags || "").toLowerCase().split(/\s+/).filter(Boolean)) tTokens.add(tg);
  const descWords = String(target.description || "").toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter((w) => w.length >= 4);
  for (const w of descWords.slice(0, 10)) tTokens.add(w);

  const scored = [];
  for (const r of state.repos) {
    if (!r.full_name || r.full_name.toLowerCase() === targetKey) continue;
    let score = 0;
    if (tLang && (r.language || "").toLowerCase() === tLang) score += 2.2;
    for (const tp of r.topics || []) {
      if (tTokens.has(String(tp).toLowerCase())) score += 3.2;
    }
    for (const tg of (r.tags || "").toLowerCase().split(/\s+/).filter(Boolean)) {
      if (tTokens.has(tg)) score += 3.8;
    }
    if (score > 0 && descWords.length) {
      const d = (r.description || "").toLowerCase();
      for (const w of descWords.slice(0, 6)) {
        if (d.includes(w)) score += 0.9;
      }
    }
    if (score >= 3.2) {
      score += Math.min(1.5, Math.log10((r.stars || 0) + 1) * 0.28);
      scored.push({ r, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.r);
}

/* ---------------- 3. 重点库置顶追踪 & Release 版本雷达 ---------------- */

async function togglePinRepo(r) {
  if (!r || !r.full_name) return;
  const key = r.full_name.toLowerCase();
  if (!state._pinnedSet) state._pinnedSet = new Set(state.pinned || []);
  let added = false;
  if (state._pinnedSet.has(key)) {
    state._pinnedSet.delete(key);
    state.pinned = state.pinned.filter((x) => x !== key);
  } else {
    if (state.pinned.length >= 30) {
      showToast("置顶版本追踪上限为 30 个核心仓库（保护 API 配额）", { isError: true });
      return;
    }
    state._pinnedSet.add(key);
    state.pinned.unshift(key);
    added = true;
  }
  await setStoredObj(K.pinned, state.pinned);
  if (detailRepo && detailRepo.full_name.toLowerCase() === key) paintDetail(detailRepo);
  if (state.peekOpen && state.peekRepo && state.peekRepo.full_name.toLowerCase() === key) {
    renderPeekBase(state.peekRepo);
  }
  applyFilters();
  showToast(added ? `已置顶追踪 ${r.name || r.full_name} 的 Release 更新` : `已取消版本追踪`);
  if (added && state.token && state.token !== "demo_mode") {
    fetchLatestReleaseFor(r.full_name).then((rel) => {
      if (rel) {
        if (detailRepo && detailRepo.full_name.toLowerCase() === key) paintDetail(detailRepo);
        if (state.peekOpen && state.peekRepo && state.peekRepo.full_name.toLowerCase() === key) renderPeekBase(state.peekRepo);
        applyFilters();
      }
    }).catch(() => {});
  }
}

async function fetchLatestReleaseFor(fullName) {
  const [owner, name] = String(fullName || "").split("/");
  if (!owner || !name || !state.token || state.token === "demo_mode") return null;
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/latest`, {
    headers: {
      Authorization: "Bearer " + state.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) return null;
  const d = await res.json();
  if (!d || !d.tag_name) return null;
  const rec = {
    tag: d.tag_name,
    name: d.name || d.tag_name,
    published_at: d.published_at || d.created_at || "",
    url: d.html_url || `https://github.com/${fullName}/releases`,
    body: String(d.body || "").slice(0, 800),
    checked_at: Date.now(),
  };
  state.releases[fullName.toLowerCase()] = rec;
  await setStoredObj(K.releases, state.releases);
  return rec;
}

async function checkPinnedReleases(btn, { silent = false } = {}) {
  const list = state.pinned || [];
  if (!list.length) {
    if (!silent) showToast("尚未置顶任何仓库：在仓库详情或预览抽屉点「追踪版本」即可加入雷达");
    return;
  }
  if (!state.token || state.token === "demo_mode") {
    if (!silent) showToast("请先配置真实 GitHub Token 后检查 Release", { isError: true });
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "雷达探测中…"; }
  let updated = 0;
  try {
    const queue = list.slice(0, 30);
    // 温和并发 = 2，跳过 12 小时内已查过的仓库
    const workers = [0, 1].map(async (offset) => {
      for (let i = offset; i < queue.length; i += 2) {
        const key = queue[i];
        const prev = state.releases[key];
        if (silent && prev && Date.now() - (prev.checked_at || 0) < 12 * 3600 * 1000) continue;
        const r = findLocal(key);
        const rel = await fetchLatestReleaseFor(r ? r.full_name : key);
        if (rel && (!prev || prev.tag !== rel.tag)) updated++;
      }
    });
    await Promise.all(workers);
    renderReleaseRadar();
    applyFilters();
    if (!silent) {
      showToast(updated ? `版本雷达发现 ${updated} 个新 Release` : `已刷新 ${queue.length} 个置顶仓库，均为最新版本`);
    }
  } catch (e) {
    if (!silent) showToast("版本雷达刷新失败：" + e.message, { isError: true });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.id === "settingsCheckReleasesBtn" ? "刷新版本雷达" : "检查最新 Release";
    }
  }
}

function renderReleaseRadar() {
  const listEl = $("insightsRadarList");
  if (!listEl) return;
  const pinned = state.pinned || [];
  if (!pinned.length) {
    listEl.innerHTML = '<div class="md-note">暂无置顶追踪仓库 · 在任意仓库详情或右侧预览抽屉点击「追踪版本」，即可自动监控大版本 Release 动态。</div>';
    return;
  }
  listEl.innerHTML = pinned.map((key) => {
    const r = findLocal(key);
    const name = r ? r.full_name : key;
    const rel = state.releases[key];
    return `<button type="button" class="radar-row" data-random-repo="${escapeHtml(name)}">` +
      `<div style="min-width:0">` +
        `<div class="radar-name">${escapeHtml(name)}</div>` +
        `<div class="radar-sub">${rel ? "发布于 " + fmtDate(rel.published_at) : "点击右上角检查最新 Release"}</div>` +
      `</div>` +
      `<span class="release-badge">${escapeHtml(rel ? rel.tag : "待检查")}</span>` +
    `</button>`;
  }).join("");
}

/* ---------------- 4. 右侧联动预览抽屉（QuickLook Split Drawer） ---------------- */

let peekDebounce = 0;

function togglePeekDrawer(force) {
  const next = typeof force === "boolean" ? force : !state.peekOpen;
  if (next === state.peekOpen) return;
  state.peekOpen = next;
  document.body.classList.toggle("peek-open", next);
  $("peekDrawer")?.classList.toggle("hidden", !next);
  $("peekToggleBtn")?.classList.toggle("on", next);
  requestAnimationFrame(syncAllSegThumbs);
  if (next) {
    const target = currentRepo() || state.filtered[0];
    if (target) {
      if (state.sel < 0 && state.filtered.length) {
        state.sel = 0;
        const firstRow = $("list").querySelector('.row[data-idx="0"]');
        if (firstRow) firstRow.classList.add("sel");
      }
      openPeekForRepo(target, { immediate: true });
    }
  } else {
    clearTimeout(peekDebounce);
    state.peekRepo = null;
  }
}

function closePeekDrawer() {
  togglePeekDrawer(false);
}

function renderPeekBase(r) {
  if (!r) return;
  const ownerName = r.owner || (r.full_name || "").split("/")[0] || "";
  $("peekOwner").textContent = ownerName;
  $("peekTitle").textContent = r.name || (r.full_name || "").split("/").pop();
  $("peekDesc").textContent = r.description || "（无描述）";

  const localRec = findLocal(r.full_name) || r;
  const noteEl = $("peekNote");
  if (noteEl) {
    noteEl.textContent = localRec.note ? "个人备注：" + localRec.note : "";
    noteEl.classList.toggle("hidden", !localRec.note);
  }
  $("peekMeta").innerHTML = [
    `★ ${fmtCount(r.stars || 0)}`,
    r.language ? escapeHtml(r.language) : "未标注语言",
    r.pushed_at ? `推送 ${fmtDate(r.pushed_at)}` : "",
    r.starred_at ? `收藏 ${fmtDate(r.starred_at)}` : "",
  ].filter(Boolean).map((x) => `<span>${x}</span>`).join("");

  const tags = (localRec.tags || "").split(/\s+/).filter(Boolean)
    .map((t) => `<span class="t mine" data-filter-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`);
  const topics = (r.topics || []).slice(0, 8)
    .map((t) => `<span class="t" data-filter-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`);
  $("peekTags").innerHTML = tags.concat(topics).join("");

  $("peekQuickLinks").innerHTML = (state.quickLinks || DEFAULT_QUICK_LINKS).map((lnk) => {
    const href = String(lnk.url || "").replace(/\{full_name\}/g, r.full_name || "");
    if (!/^https?:\/\//i.test(href)) return "";
    return `<a class="quick-link-pill" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lnk.name)} ↗</a>`;
  }).join("");

  const rel = state.releases[(r.full_name || "").toLowerCase()];
  const relEl = $("peekRelease");
  if (rel && rel.tag) {
    relEl.innerHTML = `<strong>最新 Release ${escapeHtml(rel.tag)}</strong> · ${escapeHtml(fmtDate(rel.published_at))}<div style="margin-top:4px">${escapeHtml((rel.body || "").slice(0, 180))}</div>`;
    relEl.classList.remove("hidden");
  } else {
    relEl.classList.add("hidden");
  }

  const on = isStarred(r);
  const starBtn = $("peekStarBtn");
  starBtn.classList.toggle("on", on);
  starBtn.querySelector("span").textContent = on ? "已 Star" : "Star";
  const pinBtn = $("peekPinBtn");
  const pinned = isPinned(r.full_name);
  pinBtn.classList.toggle("on", pinned);
  pinBtn.textContent = pinned ? "已追踪" : "追踪版本";
}

function openPeekForRepo(r, { immediate = false } = {}) {
  if (!r || !state.peekOpen) return;
  state.peekRepo = r;
  renderPeekBase(r);
  const readmeBox = $("peekReadme");
  const hint = $("peekReadmeHint");
  const cached = state.readmeCache[(r.full_name || "").toLowerCase()];
  if (cached && cached.text) {
    readmeBox.innerHTML = `<p>${escapeHtml(cached.text)}</p>`;
    hint.textContent = "命中本地离线缓存 · ↑/↓ 切换";
  } else {
    readmeBox.innerHTML = '<p class="md-note">正在读取 README…</p>';
    hint.textContent = "↑/↓ 快速切换（已防抖）";
  }

  clearTimeout(peekDebounce);
  const runFetch = async () => {
    const [owner, name] = (r.full_name || "").split("/");
    if (!owner || !name) return;
    const defaultBranch = r.branch || r.default_branch || "HEAD";
    readmeRepoUrl = "https://github.com/" + r.full_name;
    readmeBase = "https://github.com/" + r.full_name + "/blob/" + defaultBranch;
    readmeRawBase = "https://raw.githubusercontent.com/" + r.full_name + "/" + defaultBranch;
    try {
      const md = await fetchReadme(owner, name);
      if (state.peekRepo !== r || !state.peekOpen) return;
      if (md) {
        cacheReadmeExcerpt(r.full_name, md);
        readmeBox.innerHTML = renderMarkdown(md.slice(0, 10000)) || '<p class="md-note">README 为空</p>';
        hint.textContent = "已实时渲染并缓存";
      } else {
        readmeBox.innerHTML = '<p class="md-note">该仓库无 README</p>';
      }
    } catch (e) {
      if (state.peekRepo !== r || !state.peekOpen) return;
      if (!cached) readmeBox.innerHTML = `<p class="md-note">离线预览：${escapeHtml(e.message)}</p>`;
    }
  };
  peekDebounce = setTimeout(runFetch, immediate ? 40 : 240);
}

function initPeekDrawer() {
  $("peekToggleBtn")?.addEventListener("click", () => togglePeekDrawer());
  $("peekCloseBtn")?.addEventListener("click", closePeekDrawer);
  $("peekFullBtn")?.addEventListener("click", () => {
    if (state.peekRepo) openRepoDetail(state.peekRepo);
  });
  $("peekOpenBtn")?.addEventListener("click", () => {
    if (state.peekRepo) window.open(state.peekRepo.url, "_blank", "noopener");
  });
  $("peekStarBtn")?.addEventListener("click", () => {
    if (state.peekRepo) {
      toggleStar(state.peekRepo, $("peekStarBtn"));
      setTimeout(() => state.peekRepo && renderPeekBase(state.peekRepo), 30);
    }
  });
  $("peekPinBtn")?.addEventListener("click", () => {
    if (state.peekRepo) togglePinRepo(state.peekRepo);
  });
  $("peekTags")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter-tag]");
    if (chip) filterByTag(chip.dataset.filterTag);
  });
}

/* ---------------- 5. 全局 ⌘K 命令面板 ---------------- */

let cmdItems = [];
let cmdIdx = 0;
let cmdLastFocus = null;

function buildCommandCatalog(query) {
  const q = String(query || "").trim().toLowerCase();
  const actions = [
    { group: "快捷操作", title: state.layout === "grid" ? "切换为列表视图" : "切换为 Bento 卡片网格视图", sub: "布局切换", kbd: "Layout", run: () => saveLayout(state.layout === "grid" ? "list" : "grid") },
    { group: "快捷操作", title: state.peekOpen ? "关闭右侧联动预览抽屉" : "打开右侧联动预览抽屉", sub: "↑/↓ 连续阅览 README", kbd: "Space", run: () => togglePeekDrawer() },
    { group: "快捷操作", title: "打开资产洞察 · GitHub DNA 看板", sub: "热力图、语言彩带、健康体检", kbd: "i", run: () => openInsightsDialog("overview") },
    { group: "快捷操作", title: "打开交互式技术栈星图 (Constellation)", sub: "离线力导向技术关系星图", kbd: "Graph", run: () => openInsightsDialog("graph") },
    { group: "快捷操作", title: "打开标签管理中心", sub: "重命名、合并与清理 #标签", kbd: "Tags", run: () => openTagManager() },
    { group: "快捷操作", title: state.batchMode ? "退出批量整理模式" : "进入批量整理模式", sub: "批量打标、取消 Star、AI 对比", kbd: "Batch", run: () => setBatchMode(!state.batchMode) },
    { group: "快捷操作", title: "切换搜索范围（本地 ↔ GitHub 全站）", sub: "全站检索公开仓库", kbd: "⌥S", run: () => setScope(state.scope === "github" ? "local" : "github") },
    { group: "快捷操作", title: "增量同步 GitHub 收藏", sub: "32 分片极速同步", kbd: "Sync", run: () => runSync() },
    { group: "快捷操作", title: "刷新重点库 Release 版本雷达", sub: `检查 ${state.pinned.length} 个置顶仓库最新发版`, kbd: "Radar", run: () => checkPinnedReleases(null) },
    { group: "快捷操作", title: "启动 README 离线全文预热", sub: "后台静默缓存前 120 个高星/已打标库", kbd: "Prewarm", run: () => { openSettingsDialog(); startPrewarmQueue(120); } },
    { group: "快捷操作", title: "巡检 404 / 失联收藏仓库", sub: "探测删库或不可访问项目", kbd: "404", run: () => { openInsightsDialog("overview"); scan404Repos(); } },
    { group: "快捷操作", title: "从 GitHub Star Lists 导入标签", sub: "GraphQL 官方列表同步", kbd: "Lists", run: () => pullGithubLists(null) },
    { group: "快捷操作", title: "切换 Git Clone 协议（HTTPS ↔ SSH）", sub: `当前：${state.cloneMode.toUpperCase()}`, kbd: "Git", run: async () => { state.cloneMode = state.cloneMode === "ssh" ? "https" : "ssh"; await setStored(K.cloneMode, state.cloneMode); syncCloneModeUI(); showToast(`已切换 Clone 协议为 ${state.cloneMode.toUpperCase()}`); } },
    { group: "快捷操作", title: "导出 JSON 完整备份", sub: "保留标签、中文备注与置顶配置", kbd: "JSON", run: () => exportBackupJson() },
    { group: "快捷操作", title: "导出 Awesome Markdown 清单", sub: "按标签与语言自动分节", kbd: "MD", run: () => exportAwesomeMarkdown() },
    { group: "快捷操作", title: "打开设置与 AI 助手配置", sub: "主题、外链、Ollama/BYOK、Token", kbd: "Settings", run: () => openSettingsDialog() },
  ];

  const themeActions = THEMES.map((t) => ({
    group: "切换主题",
    title: `主题：${THEME_NAMES[t] || t}`,
    sub: document.documentElement.dataset.theme === t ? "当前使用中" : t,
    kbd: t,
    run: () => { saveTheme(t); showToast(`已切换主题：${THEME_NAMES[t] || t}`); },
  }));

  const viewActions = (state.views || []).map((v) => ({
    group: "快捷视图",
    title: `视图：${v.name}`,
    sub: v.q || v.lang || "自定义筛选",
    kbd: "View",
    run: () => applySavedView(v),
  }));

  const facets = getFacetIndex();
  const tagActions = facets.tags.slice(0, 10).map(([tg, n]) => ({
    group: "高频标签",
    title: `#${tg}`,
    sub: `${n} 个仓库`,
    kbd: "Tag",
    run: () => filterByTag(`#${tg}`),
  }));

  let list = actions.concat(viewActions, themeActions, tagActions);
  if (q) {
    list = list.filter((it) => `${it.title} ${it.sub} ${it.kbd}`.toLowerCase().includes(q));
    // 同时给出最多 6 条本地仓库直达
    const repoHits = localMatches(q, 6).map((r) => ({
      group: "直达仓库",
      title: r.full_name,
      sub: `${r.language || "未标注"} · ★ ${fmtNum(r.stars)}${r.note ? " · " + r.note : ""}`,
      kbd: "↵",
      run: () => state.peekOpen ? openPeekForRepo(r, { immediate: true }) : openRepoDetail(r),
    }));
    list = repoHits.concat(list);
  } else if (state.recentViewed && state.recentViewed.length) {
    const recents = state.recentViewed.slice(0, 4).map((fn) => findLocal(fn)).filter(Boolean).map((r) => ({
      group: "最近查看",
      title: r.full_name,
      sub: r.note || r.description || "",
      kbd: "Recent",
      run: () => openRepoDetail(r),
    }));
    list = recents.concat(list);
  }
  return list.slice(0, 28);
}

function renderCmdList() {
  const listEl = $("cmdList");
  if (!listEl) return;
  cmdItems = buildCommandCatalog($("cmdInput")?.value || "");
  cmdIdx = 0;
  if (!cmdItems.length) {
    listEl.innerHTML = '<div class="suggest-empty">没有匹配的命令或仓库</div>';
    return;
  }
  let html = "";
  let lastGroup = "";
  cmdItems.forEach((it, i) => {
    if (it.group !== lastGroup) {
      lastGroup = it.group;
      html += `<div class="cmd-group-label">${escapeHtml(it.group)}</div>`;
    }
    html += `<button type="button" class="cmd-item${i === 0 ? " is-active" : ""}" data-cmd-idx="${i}" role="option">` +
      `<div class="cmd-item-main"><span class="cmd-item-title">${escapeHtml(it.title)}</span>` +
      (it.sub ? `<span class="cmd-item-sub">${escapeHtml(it.sub)}</span>` : "") + `</div>` +
      `<span class="cmd-item-kbd">${escapeHtml(it.kbd || "")}</span></button>`;
  });
  listEl.innerHTML = html;
}

function openCmdPalette() {
  cmdLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  hideSuggest();
  $("cmdInput").value = "";
  renderCmdList();
  $("cmdDialog").classList.remove("hidden");
  setModalOpen(true);
  requestAnimationFrame(() => $("cmdInput")?.focus());
}

function closeCmdPalette() {
  $("cmdDialog").classList.add("hidden");
  setModalOpen(false);
  if (cmdLastFocus && cmdLastFocus.isConnected) cmdLastFocus.focus();
  cmdLastFocus = null;
}

function initCmdPalette() {
  $("cmdPaletteBtn")?.addEventListener("click", openCmdPalette);
  $("cmdDialog")?.addEventListener("click", (e) => {
    if (e.target.dataset.close) { closeCmdPalette(); return; }
    const item = e.target.closest("[data-cmd-idx]");
    if (!item) return;
    const target = cmdItems[Number(item.dataset.cmdIdx)];
    closeCmdPalette();
    if (target && target.run) target.run();
  });
  $("cmdInput")?.addEventListener("input", renderCmdList);
  $("cmdInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeCmdPalette(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!cmdItems.length) return;
      const btns = $("cmdList").querySelectorAll(".cmd-item");
      btns[cmdIdx]?.classList.remove("is-active");
      cmdIdx = (cmdIdx + (e.key === "ArrowDown" ? 1 : -1) + cmdItems.length) % cmdItems.length;
      btns[cmdIdx]?.classList.add("is-active");
      btns[cmdIdx]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target = cmdItems[cmdIdx];
      closeCmdPalette();
      if (target && target.run) target.run();
    }
  });
}

/* ---------------- 6. 洞察升级：365 天收藏热力图 + 语言彩带 + 离线 Canvas 2D 技术栈星图 ---------------- */

function renderInsightsHeatmap(repos) {
  const box = $("insightsHeatmap");
  const sumEl = $("insightsHeatmapSummary");
  if (!box) return;
  const dayCounts = new Map();
  let totalYear = 0;
  let maxDay = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 363 * 86400000);
  const startIso = start.toISOString().slice(0, 10);

  for (const r of repos) {
    const d = String(r.starred_at || r.created_at || "").slice(0, 10);
    if (d.length === 10 && d >= startIso) {
      const c = (dayCounts.get(d) || 0) + 1;
      dayCounts.set(d, c);
      totalYear++;
      if (c > maxDay) maxDay = c;
    }
  }
  if (sumEl) sumEl.textContent = `近 365 天新增 ${fmtCount(totalYear)} 个收藏 · 单日峰值 ${maxDay}`;

  const cells = [];
  for (let i = 0; i < 364; i++) {
    const dt = new Date(start.getTime() + i * 86400000);
    const iso = dt.toISOString().slice(0, 10);
    const ym = iso.slice(0, 7);
    const cnt = dayCounts.get(iso) || 0;
    const lv = cnt === 0 ? 0 : (maxDay <= 1 ? 3 : Math.min(4, Math.ceil((cnt / maxDay) * 4)));
    cells.push(
      `<button type="button" class="hm-cell" data-lv="${lv}" data-dsl="starred:${ym}" title="${iso}：${cnt} 个收藏（点击筛选 ${ym}）"></button>`
    );
  }
  box.innerHTML =
    `<div class="heatmap-grid">${cells.join("")}</div>` +
    `<div class="heatmap-legend"><span>${startIso.slice(0, 7)} → ${today.toISOString().slice(0, 7)}（点击色块按月筛选）</span>` +
    `<span class="heatmap-scale"><span>少</span><span class="hm-cell" data-lv="0"></span><span class="hm-cell" data-lv="1"></span><span class="hm-cell" data-lv="2"></span><span class="hm-cell" data-lv="3"></span><span class="hm-cell" data-lv="4"></span><span>多</span></span></div>`;
}

function renderLangRibbon(langMap, total) {
  const bar = $("insightsLangBar");
  if (!bar) return;
  const entries = Array.from(langMap.entries()).sort((a, b) => b[1] - a[1]);
  const labeledTotal = entries.reduce((s, [, n]) => s + n, 0) || total || 1;
  const top = entries.slice(0, 10);
  const restCount = entries.slice(10).reduce((s, [, n]) => s + n, 0);
  const segs = top.map(([l, n]) => {
    const pct = ((n / labeledTotal) * 100).toFixed(1);
    const color = LANG_COLORS[l] || "#64748b";
    return `<button type="button" class="lang-ribbon-seg" data-lang-pick="${escapeHtml(l)}" style="flex:${n};background:${color}" title="${escapeHtml(l)}：${fmtCount(n)} (${pct}%)"></button>`;
  });
  if (restCount > 0) {
    segs.push(`<span class="lang-ribbon-seg" style="flex:${restCount};background:var(--control)" title="其它语言：${fmtCount(restCount)}"></span>`);
  }
  bar.innerHTML = segs.join("");
}

/* 离线交互式技术栈星图（Canvas 2D，上限 110 节点，物理收敛后自动停止 rAF，0 闲置 CPU） */
const graphState = {
  nodes: [],
  edges: [],
  rafId: 0,
  alpha: 0,
  camX: 0,
  camY: 0,
  scale: 1,
  hoverNode: null,
  dragNode: null,
  panning: false,
  panStartX: 0,
  panStartY: 0,
  dragMoved: false,
  langFilter: "",
  wired: false,
};

function switchInsightsTab(tab) {
  const isGraph = tab === "graph";
  document.querySelectorAll("#insightsTabPick button").forEach((b) => {
    const on = b.dataset.itab === tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  $("insightsOverviewPane")?.classList.toggle("hidden", isGraph);
  $("insightsGraphPane")?.classList.toggle("hidden", !isGraph);
  if (isGraph) {
    requestAnimationFrame(startConstellation);
  } else {
    stopConstellation();
  }
}

function buildConstellationData(langFilter) {
  const source = langFilter
    ? state.repos.filter((r) => r.language === langFilter)
    : state.repos;

  const langCounts = new Map();
  for (const r of source) {
    const l = r.language || "Other";
    langCounts.set(l, (langCounts.get(l) || 0) + 1);
  }
  const topLangs = Array.from(langCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, langFilter ? 1 : 9);

  const nodes = [];
  const edges = [];
  const hubByLang = new Map();

  // 1. 语言主星系中心节点
  topLangs.forEach(([l, cnt], idx) => {
    const ang = (Math.PI * 2 * idx) / Math.max(1, topLangs.length);
    const dist = topLangs.length === 1 ? 0 : 175;
    const node = {
      id: "lang:" + l,
      kind: "lang",
      label: l,
      count: cnt,
      color: LANG_COLORS[l] || "#38bdf8",
      r: Math.max(10, Math.min(18, 8 + Math.sqrt(cnt) * 0.34)),
      x: Math.cos(ang) * dist,
      y: Math.sin(ang) * dist,
      vx: 0,
      vy: 0,
    };
    hubByLang.set(l, nodes.length);
    nodes.push(node);
  });

  // 2. 高星代表仓库节点（按语言均衡抽样，总节点上限 110）
  const perLangCap = langFilter ? 85 : 10;
  const repoNodes = [];
  const topicOwner = new Map();
  const sorted = source.slice().sort((a, b) => (b.stars || 0) - (a.stars || 0));
  const usedPerLang = new Map();
  for (const r of sorted) {
    const l = r.language || "Other";
    if (!hubByLang.has(l)) continue;
    const c = usedPerLang.get(l) || 0;
    if (c >= perLangCap) continue;
    usedPerLang.set(l, c + 1);
    const hubIdx = hubByLang.get(l);
    const hub = nodes[hubIdx];
    const ang = Math.random() * Math.PI * 2;
    const spread = 46 + Math.random() * 64;
    const nodeIdx = nodes.length;
    nodes.push({
      id: "repo:" + r.full_name,
      kind: "repo",
      repo: r,
      label: r.name || r.full_name,
      sub: `${r.full_name} · ★ ${fmtNum(r.stars)}`,
      color: LANG_COLORS[l] || "#94a3b8",
      r: Math.max(3.4, Math.min(8.5, 2.8 + Math.log10((r.stars || 10) + 1) * 1.15)),
      x: hub.x + Math.cos(ang) * spread,
      y: hub.y + Math.sin(ang) * spread,
      vx: 0,
      vy: 0,
    });
    edges.push({ a: hubIdx, b: nodeIdx, kind: "lang" });
    repoNodes.push({ nodeIdx, r });
    // 同 Topic/Tag 轻连线（最多每 topic 连前 3 个，避免边爆炸）
    const keys = (r.tags || "").split(/\s+/).filter(Boolean).concat((r.topics || []).slice(0, 3));
    for (const k of keys) {
      const low = String(k).toLowerCase();
      if (!topicOwner.has(low)) topicOwner.set(low, []);
      const arr = topicOwner.get(low);
      if (arr.length < 3) {
        for (const prevIdx of arr) edges.push({ a: prevIdx, b: nodeIdx, kind: "topic" });
        arr.push(nodeIdx);
      }
    }
    if (nodes.length >= 110) break;
  }

  return { nodes, edges, totalRepos: source.length };
}

function screenToGraph(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  return {
    x: (sx - rect.width / 2 - graphState.camX) / graphState.scale,
    y: (sy - rect.height / 2 - graphState.camY) / graphState.scale,
    sx,
    sy,
  };
}

function renderConstellationFrame() {
  const canvas = $("constellationCanvas");
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 400;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cs = getComputedStyle(document.documentElement);
  const textCol = cs.getPropertyValue("--text").trim() || "#f1f5f9";
  const mutedCol = cs.getPropertyValue("--muted").trim() || "#94a3b8";
  const accentCol = cs.getPropertyValue("--accent").trim() || "#38bdf8";
  const surfaceCol = cs.getPropertyValue("--surface").trim() || "#0e1528";

  ctx.save();
  ctx.translate(w / 2 + graphState.camX, h / 2 + graphState.camY);
  ctx.scale(graphState.scale, graphState.scale);

  const hov = graphState.hoverNode;
  const hovNeighbors = new Set();
  if (hov) {
    hovNeighbors.add(hov);
    for (const e of graphState.edges) {
      const na = graphState.nodes[e.a];
      const nb = graphState.nodes[e.b];
      if (na === hov) hovNeighbors.add(nb);
      else if (nb === hov) hovNeighbors.add(na);
    }
  }

  // 1. 边线
  for (const e of graphState.edges) {
    const a = graphState.nodes[e.a];
    const b = graphState.nodes[e.b];
    const hot = hov && (a === hov || b === hov);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = hot ? 1.5 / graphState.scale : 0.85 / graphState.scale;
    ctx.strokeStyle = hot ? accentCol : (e.kind === "topic" ? mutedCol : a.color);
    ctx.globalAlpha = hov ? (hot ? 0.85 : 0.08) : (e.kind === "topic" ? 0.14 : 0.26);
    ctx.stroke();
  }

  // 2. 节点星体
  for (const n of graphState.nodes) {
    const dim = hov && !hovNeighbors.has(n);
    const isHov = n === hov;
    ctx.globalAlpha = dim ? 0.2 : 1;

    if (n.kind === "lang" || isHov) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + (isHov ? 6 : 4.5), 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.globalAlpha = dim ? 0.05 : (isHov ? 0.3 : 0.18);
      ctx.fill();
      ctx.globalAlpha = dim ? 0.2 : 1;
    }

    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = n.color;
    ctx.fill();
    if (isHov) {
      ctx.lineWidth = 2 / graphState.scale;
      ctx.strokeStyle = textCol;
      ctx.stroke();
    }
  }

  // 3. 第二遍独立绘制带背板胶囊的标签，确保语言中心标签绝不被周围星点遮挡
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const n of graphState.nodes) {
    const isHov = n === hov;
    if (!(n.kind === "lang" || isHov || graphState.scale >= 1.35)) continue;
    const dim = hov && !hovNeighbors.has(n);
    const fontSize = n.kind === "lang"
      ? Math.max(10, 11.5 / Math.sqrt(graphState.scale))
      : Math.max(9, 10 / Math.sqrt(graphState.scale));
    ctx.font = `${n.kind === "lang" ? 600 : 500} ${fontSize}px "Public Sans", sans-serif`;
    const ly = n.y + n.r + 12 / Math.sqrt(graphState.scale);
    const tw = ctx.measureText(n.label).width;
    const padX = 5 / Math.sqrt(graphState.scale);
    const boxH = fontSize + 5 / Math.sqrt(graphState.scale);
    ctx.globalAlpha = dim ? 0.22 : 0.86;
    ctx.fillStyle = surfaceCol;
    ctx.beginPath();
    ctx.roundRect(n.x - tw / 2 - padX, ly - boxH / 2, tw + padX * 2, boxH, 4 / Math.sqrt(graphState.scale));
    ctx.fill();
    ctx.globalAlpha = dim ? 0.25 : 1;
    ctx.fillStyle = textCol;
    ctx.fillText(n.label, n.x, ly);
  }
  ctx.restore();
}

function stepConstellation() {
  graphState.rafId = 0;
  const nodes = graphState.nodes;
  const edges = graphState.edges;
  const alpha = graphState.alpha;

  if (alpha > 0.008) {
    // O(N^2) with N <= 110 (~6,000 ops ≈ 0.3ms/frame!)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x || 0.01;
        let dy = b.y - a.y || 0.01;
        const d2 = dx * dx + dy * dy + 25;
        const rep = (a.kind === "lang" && b.kind === "lang" ? 3600 : 480) / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * rep * alpha;
        const fy = (dy / d) * rep * alpha;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    for (const e of edges) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      const targetLen = e.kind === "lang" ? 72 : 108;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const pull = (d - targetLen) * (e.kind === "lang" ? 0.055 : 0.015) * alpha;
      const fx = (dx / d) * pull;
      const fy = (dy / d) * pull;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    for (const n of nodes) {
      if (n === graphState.dragNode) continue;
      // 轻向心力防止飞散
      n.vx -= n.x * 0.004 * alpha;
      n.vy -= n.y * 0.004 * alpha;
      n.vx *= 0.78;
      n.vy *= 0.78;
      n.x += n.vx;
      n.y += n.vy;
    }
    graphState.alpha *= 0.945;
  }

  renderConstellationFrame();

  if (graphState.alpha > 0.008 || graphState.dragNode) {
    graphState.rafId = requestAnimationFrame(stepConstellation);
  }
}

function stopConstellation() {
  if (graphState.rafId) {
    cancelAnimationFrame(graphState.rafId);
    graphState.rafId = 0;
  }
}

function startConstellation() {
  stopConstellation();
  const sel = $("graphFilterLang");
  if (sel) {
    const facets = getFacetIndex();
    const cur = graphState.langFilter;
    sel.innerHTML = '<option value="">全部核心技术栈</option>' +
      facets.langs.slice(0, 14).map(([l, n]) =>
        `<option value="${escapeHtml(l)}"${l === cur ? " selected" : ""}>${escapeHtml(l)} (${n})</option>`
      ).join("");
  }
  const { nodes, edges, totalRepos } = buildConstellationData(graphState.langFilter);
  graphState.nodes = nodes;
  graphState.edges = edges;
  graphState.camX = 0;
  graphState.camY = 0;
  graphState.scale = 1;
  graphState.hoverNode = null;
  graphState.dragNode = null;
  graphState.alpha = 1;
  if ($("graphStats")) {
    $("graphStats").textContent = `展示 ${nodes.length} 颗星标节点 · ${edges.length} 条技术连线（源自 ${fmtCount(totalRepos)} 个收藏 · 拖拽/滚轮缩放，点击星体直达）`;
  }
  graphState.rafId = requestAnimationFrame(stepConstellation);
}

function initConstellationControls() {
  if (graphState.wired) return;
  graphState.wired = true;
  const canvas = $("constellationCanvas");
  const tip = $("graphTooltip");
  if (!canvas) return;

  const hitTest = (gx, gy) => {
    for (let i = graphState.nodes.length - 1; i >= 0; i--) {
      const n = graphState.nodes[i];
      const dx = gx - n.x;
      const dy = gy - n.y;
      const rad = n.r + 5 / graphState.scale;
      if (dx * dx + dy * dy <= rad * rad) return n;
    }
    return null;
  };

  canvas.addEventListener("pointerdown", (e) => {
    const pt = screenToGraph(canvas, e.clientX, e.clientY);
    const hit = hitTest(pt.x, pt.y);
    graphState.dragMoved = false;
    if (hit) {
      graphState.dragNode = hit;
      graphState.alpha = Math.max(graphState.alpha, 0.25);
      if (!graphState.rafId) graphState.rafId = requestAnimationFrame(stepConstellation);
    } else {
      graphState.panning = true;
      graphState.panStartX = e.clientX - graphState.camX;
      graphState.panStartY = e.clientY - graphState.camY;
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const pt = screenToGraph(canvas, e.clientX, e.clientY);
    if (graphState.dragNode) {
      graphState.dragNode.x = pt.x;
      graphState.dragNode.y = pt.y;
      graphState.dragMoved = true;
      if (!graphState.rafId) graphState.rafId = requestAnimationFrame(renderConstellationFrame);
      return;
    }
    if (graphState.panning) {
      graphState.camX = e.clientX - graphState.panStartX;
      graphState.camY = e.clientY - graphState.panStartY;
      graphState.dragMoved = true;
      renderConstellationFrame();
      return;
    }
    const hit = hitTest(pt.x, pt.y);
    if (hit !== graphState.hoverNode) {
      graphState.hoverNode = hit;
      canvas.style.cursor = hit ? "pointer" : "grab";
      renderConstellationFrame();
    }
    if (hit && tip) {
      tip.innerHTML = hit.kind === "lang"
        ? `<strong>${escapeHtml(hit.label)}</strong><br>共 ${fmtCount(hit.count)} 个收藏（点击筛选）`
        : `<strong>${escapeHtml(hit.repo.full_name)}</strong><br>★ ${fmtNum(hit.repo.stars)} · ${escapeHtml(hit.repo.language || "未标注")}<br>${escapeHtml((hit.repo.note || hit.repo.description || "").slice(0, 72))}`;
      tip.style.left = Math.min(canvas.clientWidth - 220, pt.sx + 14) + "px";
      tip.style.top = Math.max(8, pt.sy - 14) + "px";
      tip.classList.remove("hidden");
    } else if (tip) {
      tip.classList.add("hidden");
    }
  });

  window.addEventListener("pointerup", () => {
    graphState.dragNode = null;
    graphState.panning = false;
  });

  canvas.addEventListener("click", (e) => {
    if (graphState.dragMoved) return;
    const pt = screenToGraph(canvas, e.clientX, e.clientY);
    const hit = hitTest(pt.x, pt.y);
    if (!hit) return;
    closeInsightsDialog();
    if (hit.kind === "lang") {
      if (state.view !== "mine") setView("mine");
      if (state.scope !== "local") setScope("local");
      $("lang").value = hit.label;
      $("langSelect")?._refresh?.();
      applyFilters();
    } else if (hit.repo) {
      openRepoDetail(hit.repo);
    }
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.14 : 0.88;
    graphState.scale = Math.max(0.45, Math.min(3.2, graphState.scale * factor));
    renderConstellationFrame();
  }, { passive: false });

  $("graphZoomIn")?.addEventListener("click", () => {
    graphState.scale = Math.min(3.2, graphState.scale * 1.22);
    renderConstellationFrame();
  });
  $("graphZoomOut")?.addEventListener("click", () => {
    graphState.scale = Math.max(0.45, graphState.scale * 0.82);
    renderConstellationFrame();
  });
  $("graphReset")?.addEventListener("click", () => {
    graphState.camX = 0; graphState.camY = 0; graphState.scale = 1;
    renderConstellationFrame();
  });
  $("graphFilterLang")?.addEventListener("change", (e) => {
    graphState.langFilter = e.target.value || "";
    startConstellation();
  });
}

/* ---------------- 7. 可控速 README 离线全文预热队列 ---------------- */

let prewarmRunning = false;
let prewarmAbort = false;

function updatePrewarmStatusUI(extra) {
  const el = $("prewarmStatus");
  if (!el) return;
  const cachedCount = Object.keys(state.readmeCache || {}).length;
  el.textContent = extra || `已缓存 ${fmtCount(cachedCount)} 份 README · 开启后可对置顶、已打标及高星仓库后台建全文索引`;
}

async function startPrewarmQueue(maxCount = 120) {
  if (prewarmRunning) return;
  if (!state.token || state.token === "demo_mode") {
    showToast("请先配置真实 GitHub Token 后再执行 README 离线预热", { isError: true });
    return;
  }
  // 优先预热：置顶追踪 > 已打标/备注 > 高星，跳过已缓存仓库
  const candidates = state.repos
    .filter((r) => r.full_name && !state.readmeCache[r.full_name.toLowerCase()])
    .slice()
    .sort((a, b) => {
      const pa = (isPinned(a.full_name) ? 1000000 : 0) + ((a.tags || a.note) ? 500000 : 0) + (a.stars || 0);
      const pb = (isPinned(b.full_name) ? 1000000 : 0) + ((b.tags || b.note) ? 500000 : 0) + (b.stars || 0);
      return pb - pa;
    })
    .slice(0, maxCount);

  if (!candidates.length) {
    showToast("目标仓库 README 均已缓存完成");
    updatePrewarmStatusUI();
    return;
  }

  prewarmRunning = true;
  prewarmAbort = false;
  $("prewarmStartBtn")?.classList.add("hidden");
  $("prewarmStopBtn")?.classList.remove("hidden");
  $("prewarmProgress")?.classList.remove("hidden");

  let ok = 0;
  let dirtyBatch = 0;
  try {
    for (let i = 0; i < candidates.length; i++) {
      if (prewarmAbort) break;
      const r = candidates[i];
      const [owner, name] = r.full_name.split("/");
      const pct = Math.round(((i + 1) / candidates.length) * 100);
      if ($("prewarmBar")) $("prewarmBar").style.width = pct + "%";
      updatePrewarmStatusUI(`后台预热中 ${i + 1}/${candidates.length}（已新增 ${ok} 份）· ${r.full_name}`);

      if (owner && name) {
        try {
          const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/readme`, {
            headers: {
              Authorization: "Bearer " + state.token,
              Accept: "application/vnd.github.raw+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          });
          const rem = Number(res.headers.get("X-RateLimit-Remaining") || "999");
          if (res.ok) {
            const md = await res.text();
            if (md) {
              cacheReadmeExcerpt(r.full_name, md, { persist: false });
              ok++;
              dirtyBatch++;
              if (dirtyBatch >= 5) {
                await setStoredObj(K.readmeCache, state.readmeCache);
                dirtyBatch = 0;
              }
            }
          }
          if (isFinite(rem) && rem < 30) {
            showToast("GitHub API 剩余配额偏低，已自动暂停预热");
            break;
          }
        } catch {}
      }
      // 温和节流 260ms，绝不阻塞主线程或触发二级限流
      await new Promise((res) => setTimeout(res, 260));
    }
    if (dirtyBatch > 0) {
      await setStoredObj(K.readmeCache, state.readmeCache);
    }
    showToast(prewarmAbort ? `已暂停预热，本轮新增缓存 ${ok} 份 README` : `预热完成：新增 ${ok} 份 README 离线全文索引`);
  } finally {
    prewarmRunning = false;
    prewarmAbort = false;
    $("prewarmStartBtn")?.classList.remove("hidden");
    $("prewarmStopBtn")?.classList.add("hidden");
    setTimeout(() => $("prewarmProgress")?.classList.add("hidden"), 600);
    updatePrewarmStatusUI();
  }
}

function stopPrewarmQueue() {
  prewarmAbort = true;
}

async function clearReadmeCache() {
  stopPrewarmQueue();
  state.readmeCache = {};
  await setStoredObj(K.readmeCache, {});
  updatePrewarmStatusUI();
  showToast("已清空本地 README 缓存");
}

async function main() {
  if (typeof chrome !== "undefined" && chrome.action && chrome.action.setIcon) {
    chrome.action.setIcon({
      path: {
        16: "/assets/icons/16.png",
        32: "/assets/icons/32.png",
        48: "/assets/icons/48.png",
        128: "/assets/icons/128.png"
      }
    }).catch(() => {});
  }
  await loadTheme();
  await loadDensity();
  await loadExtras();
  await loadState();
  adaptShortcutLabels();
  wireEvents();
  if (!state.token) return showSetup();

  showApp();
  renderSavedViews();
  // 支持 Omnibox 地址栏搜索跳转携带 ?q=...
  try {
    const initialQ = new URLSearchParams(location.search).get("q");
    if (initialQ) {
      $("q").value = initialQ;
      applyFilters();
    }
  } catch {}
  syncSearchClear();
  syncFootHeight();
  window.addEventListener("resize", syncFootHeight);
  if (!state.repos.length) return runSync();

  if (Date.now() - state.syncedAt > 12 * 3600 * 1000) runSync();
}

main();
