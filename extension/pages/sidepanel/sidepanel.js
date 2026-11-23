/* grepo Chrome Side Panel 逻辑：
 * 1) 感知当前标签页是否为 GitHub 仓库页，展示本地收藏状态、标签与中文备注并支持原地保存
 * 2) 纯本地离线计算「相似收藏 Top 5」（语言 + Topics + 描述词重叠）
 * 3) 内置迷你本地速搜，随时检索 4,000+ 仓库
 */

const SHARDS = 32;
const shardKey = (i) => "grepo.r" + i;
const shardOf = (id) => Math.abs(Number(id) || 0) % SHARDS;
const DEFAULT_QUICK_LINKS = [
  { name: "github.dev", url: "https://github.dev/{full_name}" },
  { name: "DeepWiki", url: "https://deepwiki.com/{full_name}" },
  { name: "Gitingest", url: "https://gitingest.com/{full_name}" },
];

const $ = (id) => document.getElementById(id);

const sp = {
  token: "",
  repos: [],
  quickLinks: DEFAULT_QUICK_LINKS,
  cloneMode: "https",
  currentFullName: "",
  currentLocal: null,
  currentRemote: null,
};

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtNum(n) {
  n = n || 0;
  if (n >= 100000) return Math.round(n / 1000) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function parseGithubRepoUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return "";
    const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length < 2) return "";
    const reserved = new Set([
      "settings", "notifications", "explore", "topics", "trending", "collections",
      "events", "sponsors", "login", "signup", "new", "organizations", "marketplace",
      "search", "pulls", "issues", "codespaces", "features", "enterprise", "pricing",
    ]);
    if (reserved.has(parts[0].toLowerCase())) return "";
    return `${parts[0]}/${parts[1]}`;
  } catch {
    return "";
  }
}

async function loadData() {
  const keys = ["grepo.token", "grepo.theme", "grepo.quickLinks", "grepo.cloneMode", "grepo.repos"];
  for (let i = 0; i < SHARDS; i++) keys.push(shardKey(i));
  const got = await chrome.storage.local.get(keys);
  document.documentElement.dataset.theme = got["grepo.theme"] || "atelier";
  sp.token = got["grepo.token"] || "";
  sp.cloneMode = got["grepo.cloneMode"] === "ssh" ? "ssh" : "https";
  if (Array.isArray(got["grepo.quickLinks"]) && got["grepo.quickLinks"].length) {
    sp.quickLinks = got["grepo.quickLinks"];
  }
  const out = [];
  if (Array.isArray(got["grepo.repos"]) && got["grepo.repos"].length) {
    out.push(...got["grepo.repos"]);
  } else {
    for (let i = 0; i < SHARDS; i++) {
      if (Array.isArray(got[shardKey(i)])) out.push(...got[shardKey(i)]);
    }
  }
  sp.repos = out;
  $("spCount").textContent = out.length ? `${out.length.toLocaleString("en-US")} 索引` : "";
}

async function saveTouchedShard(id) {
  const idx = shardOf(id);
  const bucket = sp.repos.filter((r) => shardOf(r.id) === idx);
  await chrome.storage.local.set({ [shardKey(idx)]: bucket });
}

function findLocal(fullName) {
  const key = fullName.toLowerCase();
  return sp.repos.find((r) => (r.full_name || "").toLowerCase() === key) || null;
}

function tokenizeWords(text) {
  const stop = new Set(["the", "and", "for", "with", "from", "that", "this", "your", "into", "using", "based", "tool", "library", "framework", "project", "github", "repo"]);
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/)
      .filter((w) => w.length >= 2 && !stop.has(w))
  );
}

function findSimilarRepos(target, limit = 5) {
  if (!target) return [];
  const tKey = (target.full_name || "").toLowerCase();
  const tLang = (target.language || "").toLowerCase();
  const tTopics = new Set((target.topics || []).map((x) => x.toLowerCase()));
  const tWords = tokenizeWords(`${target.name || ""} ${target.description || ""} ${target.tags || ""}`);

  const scored = [];
  for (const r of sp.repos) {
    if (!r.full_name || r.full_name.toLowerCase() === tKey) continue;
    let score = 0;
    const reasons = [];
    if (tLang && (r.language || "").toLowerCase() === tLang) {
      score += 2.5;
    }
    let sharedTopics = 0;
    for (const tp of r.topics || []) {
      if (tTopics.has(tp.toLowerCase())) sharedTopics++;
    }
    if (sharedTopics) {
      score += sharedTopics * 5;
      reasons.push(`${sharedTopics} 个共同 topic`);
    }
    const rWords = tokenizeWords(`${r.name || ""} ${r.description || ""} ${r.tags || ""}`);
    let sharedWords = 0;
    for (const w of tWords) {
      if (rWords.has(w)) sharedWords++;
    }
    if (sharedWords) {
      score += Math.min(12, sharedWords * 2.2);
    }
    if (score >= 4.5) {
      scored.push({ r, score, reasons });
    }
  }
  scored.sort((a, b) => b.score - a.score || (b.r.stars || 0) - (a.r.stars || 0));
  return scored.slice(0, limit);
}

function renderRepoCards(container, list) {
  if (!list.length) {
    container.innerHTML = '<div class="sp-empty">暂无匹配仓库</div>';
    return;
  }
  container.innerHTML = list.map((item) => {
    const r = item.r || item;
    const tags = (r.tags || "").split(/\s+/).filter(Boolean).map((t) => `#${escapeHtml(t)}`).join(" ");
    return (
      `<a class="sp-item" href="${escapeHtml(r.url || "https://github.com/" + r.full_name)}" target="_blank" rel="noopener">` +
        `<div class="sp-item-head">` +
          `<span class="sp-item-name">${escapeHtml(r.full_name)}</span>` +
          `<span class="sp-item-stars">★ ${fmtNum(r.stars)}</span>` +
        `</div>` +
        (r.description ? `<p class="sp-item-desc">${escapeHtml(r.description)}</p>` : "") +
        (r.note ? `<p class="sp-item-note">${escapeHtml(r.note)}</p>` : "") +
        `<div class="sp-item-meta">` +
          (r.language ? `<span>${escapeHtml(r.language)}</span>` : "") +
          (tags ? `<span>${tags}</span>` : "") +
        `</div>` +
      `</a>`
    );
  }).join("");
}

function renderContext() {
  const sec = $("spContext");
  if (!sp.currentFullName) {
    sec.classList.add("hidden");
    return;
  }
  sec.classList.remove("hidden");
  const [owner, name] = sp.currentFullName.split("/");
  const rec = sp.currentLocal || sp.currentRemote || { full_name: sp.currentFullName, owner, name };
  const starred = !!sp.currentLocal;

  $("spOwner").textContent = owner;
  $("spRepo").textContent = name;
  $("spDesc").textContent = rec.description || "（无描述）";

  const starBtn = $("spStarBtn");
  starBtn.classList.toggle("on", starred);
  starBtn.querySelector("span").textContent = starred ? "已 Star" : "Star";
  starBtn.querySelector("svg").setAttribute("fill", starred ? "currentColor" : "none");

  $("spAnnotateWrap").classList.toggle("hidden", !starred);
  if (starred) {
    $("spTags").value = sp.currentLocal.tags || "";
    $("spNote").value = sp.currentLocal.note || "";
  }
  $("spSavedTip").textContent = "";

  const cloneLabel = sp.cloneMode === "ssh" ? "复制 SSH Clone" : "复制 Clone";
  const extHtml = sp.quickLinks.map((lnk) => {
    const href = lnk.url.replace(/\{full_name\}/g, sp.currentFullName);
    return `<a class="sp-ext-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(lnk.name)} ↗</a>`;
  }).join("");
  $("spExtLinks").innerHTML =
    `<button type="button" class="sp-ext-link" data-sp-copy="clone">${cloneLabel}</button>` +
    `<button type="button" class="sp-ext-link" data-sp-copy="md">复制 MD</button>` +
    extHtml;

  const sim = findSimilarRepos(rec, 5);
  $("spSimCount").textContent = sim.length ? `${sim.length} 个相关` : "";
  renderRepoCards($("spSimilar"), sim);
}

async function fetchRemoteMeta(fullName) {
  if (!sp.token) return null;
  const [owner, name] = fullName.split("/");
  try {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
      headers: {
        Authorization: "Bearer " + sp.token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    const d = await res.json();
    return {
      id: d.id,
      full_name: d.full_name,
      owner: (d.owner && d.owner.login) || owner,
      name: d.name || name,
      description: d.description || "",
      language: d.language || "",
      stars: d.stargazers_count || 0,
      forks: d.forks_count || 0,
      url: d.html_url || `https://github.com/${fullName}`,
      topics: d.topics || [],
      pushed_at: d.pushed_at || "",
      updated_at: d.updated_at || "",
      created_at: d.created_at || "",
      archived: !!d.archived,
      kind: "star",
      tags: "",
      note: "",
    };
  } catch {
    return null;
  }
}

async function syncActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const fullName = tab && tab.url ? parseGithubRepoUrl(tab.url) : "";
    sp.currentFullName = fullName;
    sp.currentLocal = fullName ? findLocal(fullName) : null;
    sp.currentRemote = null;
    renderContext();
    if (fullName && !sp.currentLocal) {
      const meta = await fetchRemoteMeta(fullName);
      if (sp.currentFullName === fullName && meta) {
        sp.currentRemote = meta;
        renderContext();
      }
    }
  } catch {}
}

function runMiniSearch() {
  const q = ($("spSearchInput").value || "").trim().toLowerCase();
  if (!q) {
    const recent = sp.repos
      .slice()
      .sort((a, b) => String(b.starred_at || b.created_at || "").localeCompare(String(a.starred_at || a.created_at || "")))
      .slice(0, 8);
    renderRepoCards($("spSearchResults"), recent);
    return;
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const r of sp.repos) {
    let ok = true;
    for (const t of terms) {
      if (t.startsWith("lang:")) {
        if ((r.language || "").toLowerCase() !== t.slice(5)) { ok = false; break; }
      } else if (t.startsWith("tag:")) {
        const tg = t.slice(4);
        const all = ((r.tags || "") + " " + (r.topics || []).join(" ")).toLowerCase();
        if (!all.includes(tg)) { ok = false; break; }
      } else {
        const hay = `${r.full_name} ${r.description || ""} ${(r.topics || []).join(" ")} ${r.tags || ""} ${r.note || ""}`.toLowerCase();
        if (!hay.includes(t)) { ok = false; break; }
      }
    }
    if (ok) hits.push(r);
    if (hits.length >= 20) break;
  }
  renderRepoCards($("spSearchResults"), hits);
}

async function init() {
  await loadData();
  await syncActiveTab();
  runMiniSearch();

  $("spOpenMain").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("pages/dashboard/index.html") });
  });

  $("spExtLinks").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-sp-copy]");
    if (!btn || !sp.currentFullName) return;
    const mode = btn.dataset.spCopy;
    const text = mode === "md"
      ? `[${sp.currentFullName}](https://github.com/${sp.currentFullName})`
      : (sp.cloneMode === "ssh"
          ? `git clone git@github.com:${sp.currentFullName}.git`
          : `git clone https://github.com/${sp.currentFullName}.git`);
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = "已复制";
      setTimeout(() => { btn.textContent = prev; }, 1200);
    } catch {}
  });

  $("spSaveMeta").addEventListener("click", async () => {
    if (!sp.currentLocal) return;
    sp.currentLocal.tags = $("spTags").value.trim().toLowerCase().replace(/\s+/g, " ");
    sp.currentLocal.note = $("spNote").value.trim();
    await saveTouchedShard(sp.currentLocal.id);
    $("spSavedTip").textContent = "已保存";
    runMiniSearch();
    setTimeout(() => { $("spSavedTip").textContent = ""; }, 1800);
  });

  $("spStarBtn").addEventListener("click", async () => {
    if (!sp.currentFullName || !sp.token) return;
    const [owner, name] = sp.currentFullName.split("/");
    const willStar = !sp.currentLocal;
    const btn = $("spStarBtn");
    btn.disabled = true;
    try {
      const res = await fetch(`https://api.github.com/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
        method: willStar ? "PUT" : "DELETE",
        headers: {
          Authorization: "Bearer " + sp.token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      if (willStar) {
        const rec = sp.currentRemote || (await fetchRemoteMeta(sp.currentFullName)) || {
          id: Date.now(), full_name: sp.currentFullName, owner, name,
          url: `https://github.com/${sp.currentFullName}`, kind: "star", tags: "", note: "", topics: [],
        };
        rec.starred_at = new Date().toISOString();
        sp.repos.push(rec);
        sp.currentLocal = rec;
        await saveTouchedShard(rec.id);
      } else {
        const oldId = sp.currentLocal.id;
        sp.repos = sp.repos.filter((r) => (r.full_name || "").toLowerCase() !== sp.currentFullName.toLowerCase());
        sp.currentLocal = null;
        await saveTouchedShard(oldId);
      }
      renderContext();
      runMiniSearch();
    } catch (e) {
      $("spSavedTip").textContent = "操作失败：" + e.message;
    } finally {
      btn.disabled = false;
    }
  });

  let timer = 0;
  $("spSearchInput").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(runMiniSearch, 100);
  });

  if (chrome.tabs) {
    chrome.tabs.onActivated.addListener(() => syncActiveTab());
    chrome.tabs.onUpdated.addListener((_, info, tab) => {
      if (tab && tab.active && info.url) syncActiveTab();
    });
  }
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local") return;
      if (changes["grepo.theme"]) {
        document.documentElement.dataset.theme = changes["grepo.theme"].newValue || "atelier";
      }
      if (Object.keys(changes).some((k) => k.startsWith("grepo.r") || k === "grepo.quickLinks")) {
        await loadData();
        sp.currentLocal = sp.currentFullName ? findLocal(sp.currentFullName) : null;
        renderContext();
        runMiniSearch();
      }
    });
  }
}

init();
