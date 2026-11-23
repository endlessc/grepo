/* 压测用的浏览器替身：
 *   · 造一个 chrome.storage.local。它落到 IndexedDB 而不是 localStorage ——
 *     真实扩展带 unlimitedStorage 权限，没有 5MB 上限，用 localStorage 会
 *     把旧方案的整块数据直接撑爆，对比就失真了。
 *   · 把 api.github.com 的请求换成本地生成的仓库数据。
 */
(function () {
  /* ---- 用 IndexedDB 模拟 chrome.storage.local ---- */
  let kvPromise = null;
  function kv() {
    if (kvPromise) return kvPromise;
    kvPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("mock-storage", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("kv", { keyPath: "k" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return kvPromise;
  }

  function kvGet(k) {
    return kv().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction("kv", "readonly");
          const r = tx.objectStore("kv").get(k);
          r.onsuccess = () => resolve(r.result ? r.result.v : undefined);
          r.onerror = () => reject(r.error);
        })
    );
  }

  function kvSet(k, v) {
    return kv().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put({ k, v });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function kvDel(keys) {
    return kv().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction("kv", "readwrite");
          const st = tx.objectStore("kv");
          for (const k of keys) st.delete(k);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys)
            ? keys
            : typeof keys === "string"
            ? [keys]
            : keys == null
            ? []
            : Object.keys(keys);
          const out = {};
          for (const k of list) out[k] = await kvGet(k);
          return out;
        },
        async set(obj) {
          stats.setKeys += Object.keys(obj).length;
          for (const [k, v] of Object.entries(obj)) {
            stats.setBytes += JSON.stringify({ k, v }).length;
            await kvSet(k, v);
          }
        },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          stats.removed += list.length;
          await kvDel(list);
        },
      },
    },
    tabs: {
      async query() {
        return [];
      },
    },
  };

  // ?setup 时故意不写 token，好让首次配置页显示出来
  if (!location.search.includes("setup")) kvSet("grepo.token", "mock_token");

  /* ---- 用本地数据替换 GitHub API ---- */
  const stats = { requests: 0, starPages: 0, ownPages: 0, searchReqs: 0, setKeys: 0, setBytes: 0, removed: 0, starWrites: 0 };
  window.__mock = {
    stats,
    reset() {
      stats.requests = 0; stats.starPages = 0; stats.ownPages = 0; stats.searchReqs = 0;
      stats.setKeys = 0; stats.setBytes = 0; stats.removed = 0; stats.starWrites = 0; window.__mock.starMethod = "";
    },
    shardKeys() {
      return kv().then((db) => new Promise((res, rej) => {
        const tx = db.transaction("kv", "readonly");
        const r = tx.objectStore("kv").getAllKeys();
        r.onsuccess = () => res(r.result.filter((k) => /^grepo\.r\d+$/.test(k)));
        r.onerror = () => rej(r.error);
      }));
    },
    addStars(n) {
      return loadData().then((d) => {
        // 必须比现有最新星标更新，否则会被水印正确跳过
        let max = '';
        for (const it of d.stars) {
          if (it.starred_at > max) max = it.starred_at;
        }
        const base = max ? Date.parse(max) : Date.now();
        for (let i = 0; i < n; i++) {
          const t = new Date(base + (i + 1) * 60000).toISOString();
          d.stars.unshift({
            starred_at: t,
            repo: {
              id: 900000 + Math.floor(Math.random() * 100000),
              full_name: 'newstar/injected-' + i,
              owner: { login: 'newstar' },
              name: 'injected-' + i,
              description: 'injected for incremental test',
              html_url: 'https://github.com/newstar/injected-' + i,
              language: 'Go',
              stargazers_count: 1,
              forks_count: 0,
              topics: ['test'],
              archived: false,
              fork: false,
              pushed_at: t,
              updated_at: t,
              created_at: t,
            },
          });
        }
        return d.stars.length;
      });
    },
  };

  /* ---- 模拟全站热门仓库：星数随天数增长，用来验证涨幅统计 ---- */
  const trendBase = [];
  (function seedTrend() {
    const NAMES = [
      "agent-os", "llm-router", "mcp-server", "rag-pipeline", "rust-ferry",
      "tiny-infer", "vector-lite", "flow-engine", "ui-forge", "data-mesh",
    ];
    const OWNERS = ["meta", "anthropics", "addyosmani", "vercel", "astral-sh", "cloudflare"];
    const LANGS = ["TypeScript", "Python", "Rust", "Go"];
    const TOPICS = [["ai-agents"], ["rag", "llm"], ["mcp"], ["rust", "cli"], ["ui", "design-system"]];
    for (let i = 0; i < 40; i++) {
      trendBase.push({
        id: 700000 + i,
        full_name: OWNERS[i % OWNERS.length] + "/" + NAMES[i % NAMES.length] + "-" + i,
        owner: { login: OWNERS[i % OWNERS.length] },
        name: NAMES[i % NAMES.length] + "-" + i,
        description: "Trending sample repo #" + i + " for deltas",
        html_url: "https://github.com/x/y-" + i,
        language: LANGS[i % LANGS.length],
        stargazers_count: 1000 + i * 137,
        forks_count: 10,
        topics: TOPICS[i % TOPICS.length],
        archived: false,
        fork: false,
        created_at: "2026-10-01T00:00:00Z",
        pushed_at: new Date(Date.now() - (i % 5) * 86400000).toISOString(),
        updated_at: new Date(Date.now() - (i % 5) * 86400000).toISOString(),
        // 每个仓库每天涨的星数不同，便于区分排行
        _growth: 5 + (i % 17),
      });
    }
  })();

  // 以"第几天"为单位给出星数，模拟真实增长
  window.__mock.trendDay = 0;
  function trendItems(day) {
    return trendBase.map((r) => ({
      ...r,
      stargazers_count: r.stargazers_count + r._growth * day,
    }));
  }

  let dataPromise = null;
  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch("/data/repos.json").then((r) => r.json());
    }
    return dataPromise;
  }

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const realFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    let url;
    try {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : input.url;
      url = new URL(href, location.href);
    } catch {
      return realFetch(input, init);
    }

    // 本地数据文件本身要走真实网络栈，不能被自己拦
    if (url.pathname === "/data/repos.json") return realFetch(input, init);

    if (url.hostname === "github.com" && url.pathname === "/trending") {
      if (window.__mock.slowTrendMs) await new Promise((r) => setTimeout(r, window.__mock.slowTrendMs));
      if (window.__mock.blockGithub) throw new TypeError("Failed to fetch");
      stats.trendReqs = (stats.trendReqs || 0) + 1;
      const since = url.searchParams.get("since") || "daily";
      const mult = since === "weekly" ? 7 : since === "monthly" ? 30 : 1;
      const nameMap = {
        daily: "今日",
        weekly: "本周",
        monthly: "本月",
      };
      const rows = trendItems(window.__mock.trendDay || 0).slice(0, 12).map((r, idx) => {
        const gain = Math.round((24 - idx) * mult);
        return `
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/${r.full_name}" class="Link">
      <span class="text-normal">${r.full_name.split("/")[0]} /</span>
      ${r.full_name.split("/")[1]}
    </a>
  </h2>
  <p class="col-9 color-fg-muted my-1 tmp-pr-4">${r.description}</p>
  <div class="f6 color-fg-muted mt-2">
    <span class="tmp-mr-3 d-inline-block">
      <span class="repo-language-color" style="background-color: #3178c6"></span>
      <span itemprop="programmingLanguage">${r.language}</span>
    </span>
    <a href="/${r.full_name}/stargazers" class="Link Link--muted">${r.stargazers_count.toLocaleString("en-US")}</a>
    <a href="/${r.full_name}/forks" class="Link Link--muted">${r.forks_count}</a>
    <span class="d-inline-block float-sm-right">
      ${gain} ${nameMap[since] === "今日" ? "stars today" : since === "weekly" ? "stars this week" : "stars this month"}
    </span>
  </div>
</article>`;
      }).join("\n");
      const html = `<!DOCTYPE html><html lang="en"><body><main>
<div class="Box"><div>${rows}</div></div>
</main></body></html>`;
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.hostname !== "api.github.com") return realFetch(input, init);

    stats.requests++;
    const data = await loadData();
    const page = Number(url.searchParams.get("page") || 1);
    if (url.pathname === "/user/starred") stats.starPages++;
    if (/^\/user\/starred\/[^/]+\/[^/]+$/.test(url.pathname)) {
      stats.starWrites++;
      window.__mock.starMethod = String((init && init.method) || "GET").toUpperCase();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/user/repos") stats.ownPages++;
    const per = Number(url.searchParams.get("per_page") || 30);

    if (url.pathname === "/search/repositories") {
      stats.searchReqs++;
      const q = url.searchParams.get("q") || "";
      let items = trendItems(window.__mock.trendDay || 0);
      if (/stars:>(\d+)/.test(q)) {
        const min = Number(q.match(/stars:>(\d+)/)[1]);
        items = items.filter((r) => r.stargazers_count > min);
      }
      // 自由关键词按名称/描述过滤，供远程搜索用例验证命中与空结果
      const plain = q
        .replace(/stars:>\d+/g, "")
        .replace(/created:>[^\s]+/g, "")
        .replace(/pushed:>[^\s]+/g, "")
        .trim();
      if (plain) {
        const low = plain.toLowerCase();
        items = items.filter((r) =>
          String(r.full_name || "").toLowerCase().indexOf(low) >= 0 ||
          String(r.description || "").toLowerCase().indexOf(low) >= 0
        );
      }
      const want = url.searchParams.get("sort") === "stars";
      if (want) items = items.slice().sort((a, b) => b.stargazers_count - a.stargazers_count);
      const per = Number(url.searchParams.get("per_page") || 30);
      return jsonResponse({ total_count: items.length, items: items.slice(0, per) });
    }
    if (/^\/repos\/[^/]+\/[^/]+\/readme$/.test(url.pathname)) {
      stats.readmeReqs = (stats.readmeReqs || 0) + 1;
      const name = url.pathname.split("/")[3];
      if (window.__mock.readmeMissing) {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }
      const md = [
        "# " + name + " 项目说明",
        "",
        "这是一个 **加粗** 与 *斜体* 的段落，还有 `inline code`。",
        "",
        "## 安装",
        "",
        "- 第一步：安装依赖",
        "- 第二步：运行 `npm start`",
        "",
        "1. 有序项一",
        "2. 有序项二",
        "",
        "\`\`\`bash",
        "echo \"hello\"",
        "\`\`\`",
        "",
        "> 引用一句话",
        "",
        "[官网](https://example.com) 与 [相对链接](/owner/repo)",
        "",
        "![封面图](https://example.com/cover.png)",
        "",
        "<p align=\"center\">",
        "  <img src=\"./logo.png\" alt=\"项目 Logo\" width=\"220\" />",
        "</p>",
        "",
        "![Python](https://img.shields.io/badge/Python-3.12-blue)",
        "[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)",
        "",
        "| 功能 | 说明 |",
        "|------|------|",
        "| 表格 | 用来验 **GFM** 表格 |",
        "| 行内码 | `code` |",
        "",
        "- 一级",
        "  - 二级",
        "    - 三级",
        "",
        "<table>",
        "<tr>",
        "<td align=\"center\"><img src=\"a.png\" alt=\"图一\" /><br/><sub><b>图注一</b></sub></td>",
        "<td align=\"center\"><img src=\"b.png\" alt=\"图二\" /><br/><sub><b>图注二</b></sub></td>",
        "</tr>",
        "</table>",
        "",
        "[脚本链接](javascript:window.__xss=3)",
        "",
        "<script>window.__xss = 1</script>",
        "<img src=x onerror=\"window.__xss=2\">",
        "",
        "---",
        "",
        "结尾一段。",
      ].join("\n");
      return new Response(md, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (/^\/repos\/[^/]+\/[^/]+$/.test(url.pathname)) {
      stats.repoDetailReqs = (stats.repoDetailReqs || 0) + 1;
      const [, , owner, name] = url.pathname.split("/");
      await loadData();
      const hit = data.stars.map((x) => x.repo).concat(data.own)
        .find((r) => r.full_name === owner + "/" + name);
      return jsonResponse({
        id: hit ? hit.id : 1,
        full_name: owner + "/" + name,
        name,
        owner: { login: owner },
        description: hit ? hit.description : "detail from api",
        stargazers_count: hit ? hit.stargazers_count : 1234,
        forks_count: hit ? hit.forks_count : 56,
        open_issues_count: 7,
        language: hit ? hit.language : "TypeScript",
        license: { spdx_id: "MIT" },
        default_branch: "main",
        size: 2048,
        pushed_at: "2026-11-10T00:00:00Z",
        created_at: "2024-01-01T00:00:00Z",
        topics: (hit && hit.topics) || ["demo"],
        html_url: "https://github.com/" + owner + "/" + name,
      });
    }
    if (url.pathname === "/user") return jsonResponse({ login: "demo-user", id: 1 });
    if (url.pathname === "/user/starred") {
      let list = data.stars;
      if (url.searchParams.get("sort") === "created") {
        list = list.slice().sort((a, b) =>
          String(b.starred_at).localeCompare(String(a.starred_at)));
      }
      return jsonResponse(list.slice((page - 1) * per, page * per));
    }
    if (url.pathname === "/user/repos") {
      let list = data.own;
      if (url.searchParams.get("sort") === "updated") {
        list = list.slice().sort((a, b) =>
          String(b.updated_at).localeCompare(String(a.updated_at)));
      }
      return jsonResponse(list.slice((page - 1) * per, page * per));
    }
    return jsonResponse({ message: "Not Found" }, 404);
  };
})();
