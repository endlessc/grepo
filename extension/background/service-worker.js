// grepo MV3 Service Worker：
// 1) 工具栏图标打开/复用主界面标签页
// 2) 地址栏 Omnibox 秒搜（gr <关键词>）
// 3) 全局快捷键（打开主界面 / 打开侧边栏）
// 4) 本地 32 分片内存缓存（随 storage 变更自动失效）

const PAGE = "pages/dashboard/index.html";
const SHARDS = 32;
const shardKey = (i) => "grepo.r" + i;

let cachedRepos = null;
let loadPromise = null;

function updateActionIcon() {
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
}

function openGrepo(query) {
  const base = chrome.runtime.getURL(PAGE);
  const targetUrl = query ? `${base}?q=${encodeURIComponent(query)}` : base;
  chrome.tabs.query({ url: base + "*" }, (tabs) => {
    if (tabs && tabs.length) {
      const tab = tabs[0];
      if (query) {
        chrome.tabs.update(tab.id, { active: true, url: targetUrl });
      } else {
        chrome.tabs.update(tab.id, { active: true });
      }
      chrome.windows.update(tab.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: targetUrl });
    }
  });
}

async function getReposForOmnibox() {
  if (cachedRepos) return cachedRepos;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const keys = [];
    for (let i = 0; i < SHARDS; i++) keys.push(shardKey(i));
    keys.push("grepo.repos");
    const got = await chrome.storage.local.get(keys);
    const out = [];
    if (Array.isArray(got["grepo.repos"]) && got["grepo.repos"].length) {
      out.push(...got["grepo.repos"]);
    } else {
      for (let i = 0; i < SHARDS; i++) {
        const arr = got[shardKey(i)];
        if (Array.isArray(arr)) out.push(...arr);
      }
    }
    cachedRepos = out;
    loadPromise = null;
    return out;
  })();
  return loadPromise;
}

function escapeXml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[c]));
}

function fmtStars(n) {
  n = n || 0;
  if (n >= 100000) return Math.round(n / 1000) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function rankOmnibox(repos, raw) {
  const terms = String(raw || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return repos
      .slice()
      .sort((a, b) => String(b.starred_at || b.created_at || "").localeCompare(String(a.starred_at || a.created_at || "")))
      .slice(0, 6);
  }
  const scored = [];
  for (const r of repos) {
    if (!r || !r.full_name) continue;
    const fn = r.full_name.toLowerCase();
    const tags = (r.tags || "").toLowerCase();
    const note = (r.note || "").toLowerCase();
    const topics = (r.topics || []).join(" ").toLowerCase();
    const desc = (r.description || "").toLowerCase();
    const hay = `${fn} ${tags} ${note} ${topics} ${desc}`;
    let ok = true;
    for (const t of terms) {
      if (!hay.includes(t)) { ok = false; break; }
    }
    if (!ok) continue;
    let score = 0;
    for (const t of terms) {
      if (fn.includes(t)) score += 30;
      if (tags.includes(t)) score += 20;
      if (note.includes(t)) score += 16;
      if (topics.includes(t)) score += 10;
      if (desc.includes(t)) score += 5;
    }
    score += Math.min(12, Math.log10((r.stars || 0) + 1) * 2.5);
    scored.push({ r, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 6).map((x) => x.r);
}

// 监听分片变更，保持 Omnibox 索引实时有效
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const k of Object.keys(changes)) {
      if (k === "grepo.repos" || k.startsWith("grepo.r")) {
        cachedRepos = null;
        break;
      }
    }
  });
}

// 地址栏 Omnibox（gr <关键词>）
if (chrome.omnibox) {
  chrome.omnibox.setDefaultSuggestion({
    description: "在 grepo 本地索引中搜索 <match>%s</match>"
  });

  chrome.omnibox.onInputStarted.addListener(() => {
    getReposForOmnibox().catch(() => {});
  });

  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    try {
      const repos = await getReposForOmnibox();
      const hits = rankOmnibox(repos, text);
      const suggestions = hits.map((r) => {
        const meta = [
          r.stars ? `★ ${fmtStars(r.stars)}` : "",
          r.language || "",
          r.tags ? `#${r.tags.split(/\s+/).join(" #")}` : "",
        ].filter(Boolean).join(" · ");
        const blurb = (r.note || r.description || "").slice(0, 80);
        return {
          content: r.url || `https://github.com/${r.full_name}`,
          description:
            `<match>${escapeXml(r.full_name)}</match>` +
            (meta ? ` <url>${escapeXml(meta)}</url>` : "") +
            (blurb ? ` <dim>— ${escapeXml(blurb)}</dim>` : ""),
        };
      });
      suggest(suggestions);
    } catch {
      suggest([]);
    }
  });

  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    const val = String(text || "").trim();
    const isUrl = /^https?:\/\//i.test(val);
    if (isUrl) {
      if (disposition === "currentTab") {
        chrome.tabs.update({ url: val });
      } else {
        chrome.tabs.create({ url: val, active: disposition !== "newBackgroundTab" });
      }
      return;
    }
    openGrepo(val);
  });
}

// 全局快捷键
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "open-grepo") {
      openGrepo();
    } else if (command === "open-sidepanel" && chrome.sidePanel) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.windowId != null) {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        }
      } catch {}
    }
  });
}

function setupContextMenus() {
  if (!chrome.contextMenus) return;
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "open-grepo-sidepanel",
        title: "打开 grepo 侧边栏（备注与相似收藏）",
        contexts: ["action", "page"],
      });
      chrome.contextMenus.create({
        id: "open-grepo-main",
        title: "打开 grepo 主界面",
        contexts: ["action"],
      });
    });
  } catch {}
}

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "open-grepo-sidepanel" && chrome.sidePanel) {
      try {
        const winId = tab && tab.windowId != null
          ? tab.windowId
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.windowId;
        if (winId != null) await chrome.sidePanel.open({ windowId: winId });
      } catch {}
    } else if (info.menuItemId === "open-grepo-main") {
      openGrepo();
    }
  });
}

chrome.action.onClicked.addListener(() => openGrepo());

chrome.runtime.onStartup.addListener(() => {
  updateActionIcon();
  setupContextMenus();
});
chrome.runtime.onInstalled.addListener((details) => {
  updateActionIcon();
  setupContextMenus();
  if (details.reason === "install") openGrepo();
});

updateActionIcon();
setupContextMenus();
