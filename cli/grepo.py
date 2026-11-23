#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
grepo — 本地 GitHub star / fork 仓库索引与检索

  grepo                     fzf 交互浏览（模糊匹配名称、描述、topic）
  grepo <关键词>            fzf 交互浏览，带初始搜索词
  grepo -l [关键词]         纯文本列表，可管道给 grep / jq
  grepo -l --json [关键词]  JSON 输出
  grepo sync                同步 star 与自有 / fork 仓库
  grepo html [--open]       生成离线 HTML 搜索页
  grepo stats               统计信息
  grepo tags [关键词]       列出 / 过滤自定义标签
  grepo tag <仓库> <标签..>  给仓库打标签
  grepo note <仓库> <文本>   给仓库写备注
  grepo open <仓库>         浏览器打开
  grepo clone <仓库>        克隆到当前目录
  grepo setup               录入 GitHub token

过滤参数（可用于 -l 与浏览模式）:
  --lang  python,go        编程语言
  --topic rag              topic
  --kind  star,fork,owned  仓库类型
  --stars ">1000"          仓库自身 star 数
  --since 2024-01          该时间之后 star / 创建
  --sort  starred|stars|name|updated
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

APP = "grepo"
DATA_DIR = os.path.join(
    os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")), APP
)
CONFIG_DIR = os.path.join(
    os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), APP
)
DB_PATH = os.path.join(DATA_DIR, "stars.db")
HTML_PATH = os.path.join(DATA_DIR, "index.html")
KEYCHAIN_SERVICE = "grepo-token"
API = "https://api.github.com"
SCRIPT = os.path.abspath(__file__)


# --------------------------------------------------------------------------
# 终端着色
# --------------------------------------------------------------------------
def _tty():
    return sys.stdout.isatty()


def col(text, code):
    return "\033[%sm%s\033[0m" % (code, text) if _tty() else str(text)


def cyan(s):
    return col(s, "36;1")


def dim(s):
    return col(s, "2")


def green(s):
    return col(s, "32")


def yellow(s):
    return col(s, "33")


def magenta(s):
    return col(s, "35")


ANSI_RE = re.compile(r"\033\[[0-9;]*m")


def strip_ansi(s):
    return ANSI_RE.sub("", s)


def die(msg, code=1):
    sys.stderr.write(col("grepo: ", "31;1") + msg + "\n")
    sys.exit(code)


# --------------------------------------------------------------------------
# Token
# --------------------------------------------------------------------------
def get_token():
    for env in ("GREPO_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"):
        v = os.environ.get(env)
        if v and v.strip():
            return v.strip()

    if sys.platform == "darwin" and shutil.which("security"):
        try:
            r = subprocess.run(
                ["security", "find-generic-password", "-a", os.environ.get("USER", ""),
                 "-s", KEYCHAIN_SERVICE, "-w"],
                capture_output=True, text=True,
            )
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        except Exception:
            pass

    path = os.path.join(CONFIG_DIR, "token")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            v = fh.read().strip()
            if v:
                return v
    return None


def require_token():
    tok = get_token()
    if not tok:
        die("没有找到 GitHub token。先运行： grepo setup")
    return tok


def cmd_setup(_args):
    print("创建一个 GitHub token：")
    print("  " + cyan("https://github.com/settings/tokens/new"))
    print(dim("  Note 填 grepo，Expiration 选 No expiration（或 90 天）"))
    print(dim("  Scope 勾 public_repo —— 足够读你的 star 与公开 fork"))
    print(dim("  想让索引覆盖私有仓库就改勾 repo（整个 repo 权限），自行权衡。\n"))
    print(dim("  也可以建 fine-grained token，但需额外给 Starring 读权限，更麻烦。\n"))

    token = None
    if not sys.stdin.isatty():
        token = sys.stdin.read().strip()
    if not token:
        import getpass

        try:
            token = getpass.getpass("粘贴 token（输入不回显）: ").strip()
        except (EOFError, KeyboardInterrupt):
            die("已取消")

    if not token:
        die("没有输入内容")

    if not re.match(r"^(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})$", token):
        print(yellow("  注意：token 格式不像 GitHub 的经典/细粒度 token，仍将尝试保存。"))

    saved = False
    if sys.platform == "darwin" and shutil.which("security"):
        r = subprocess.run(
            ["security", "add-generic-password", "-a", os.environ.get("USER", ""),
             "-s", KEYCHAIN_SERVICE, "-w", token, "-U"],
            capture_output=True, text=True,
        )
        saved = r.returncode == 0

    if not saved:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        path = os.path.join(CONFIG_DIR, "token")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(token + "\n")
        os.chmod(path, 0o600)
        print(dim("  已写入 " + path))

    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        user = api_get("/user", token)
        print(green("\n验证通过：@" + user["login"]))
        if "public_repos" in user:
            print(dim("  公开仓库 %d 个" % user["public_repos"]))
    except SystemExit:
        raise
    except Exception as exc:
        die("token 验证失败：%s" % exc)

    print("\n下一步： " + cyan("grepo sync"))


# --------------------------------------------------------------------------
# GitHub API
# --------------------------------------------------------------------------
def api_get(path, token, params=None):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github.star+json, application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "grepo/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        if exc.code in (403, 429):
            reset = exc.headers.get("X-RateLimit-Reset")
            remaining = exc.headers.get("X-RateLimit-Remaining")
            if remaining == "0" and reset:
                when = datetime.fromtimestamp(int(reset)).strftime("%H:%M:%S")
                die("API 配额用尽，%s 后恢复。" % when)
            die("被 GitHub 拒绝（HTTP %s）：%s" % (exc.code, body))
        if exc.code == 401:
            die("token 无效或已过期，重新运行： grepo setup")
        die("HTTP %s：%s" % (exc.code, body))
    except urllib.error.URLError as exc:
        die("网络错误：%s" % exc.reason)


# --------------------------------------------------------------------------
# 数据库
# --------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS repos (
    id          INTEGER PRIMARY KEY,
    full_name   TEXT NOT NULL,
    owner       TEXT,
    name        TEXT,
    description TEXT,
    url         TEXT,
    homepage    TEXT,
    language    TEXT,
    stars       INTEGER DEFAULT 0,
    forks       INTEGER DEFAULT 0,
    topics      TEXT,
    kind        TEXT,
    archived    INTEGER DEFAULT 0,
    is_fork     INTEGER DEFAULT 0,
    pushed_at   TEXT,
    updated_at  TEXT,
    starred_at  TEXT,
    created_at  TEXT,
    my_tags     TEXT,
    note        TEXT,
    synced_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_repos_name  ON repos(full_name);
CREATE INDEX IF NOT EXISTS idx_repos_lang  ON repos(language);
CREATE INDEX IF NOT EXISTS idx_repos_kind  ON repos(kind);
CREATE INDEX IF NOT EXISTS idx_repos_stars ON repos(stars);

CREATE VIRTUAL TABLE IF NOT EXISTS repos_fts USING fts5(
    full_name, description, topics, my_tags, note,
    content='repos', content_rowid='id',
    tokenize="unicode61 remove_diacritics 2"
);
"""


def connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    return db


def rebuild_fts(db):
    db.execute("INSERT INTO repos_fts(repos_fts) VALUES('rebuild')")
    db.commit()


def upsert(db, repo, kind, starred_at=None):
    topics = " ".join(repo.get("topics") or [])
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.execute(
        """
        INSERT INTO repos (id, full_name, owner, name, description, url, homepage,
                           language, stars, forks, topics, kind, archived, is_fork,
                           pushed_at, updated_at, starred_at, created_at, synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            full_name=excluded.full_name,
            owner=excluded.owner,
            name=excluded.name,
            description=excluded.description,
            url=excluded.url,
            homepage=excluded.homepage,
            language=excluded.language,
            stars=excluded.stars,
            forks=excluded.forks,
            topics=excluded.topics,
            kind=CASE WHEN repos.kind='star' THEN 'star' ELSE excluded.kind END,
            archived=excluded.archived,
            is_fork=excluded.is_fork,
            pushed_at=excluded.pushed_at,
            updated_at=excluded.updated_at,
            starred_at=COALESCE(excluded.starred_at, repos.starred_at),
            synced_at=excluded.synced_at
        """,
        (
            repo["id"],
            repo["full_name"],
            (repo.get("owner") or {}).get("login"),
            repo.get("name"),
            repo.get("description"),
            repo.get("html_url"),
            repo.get("homepage"),
            repo.get("language"),
            repo.get("stargazers_count") or 0,
            repo.get("forks_count") or 0,
            topics,
            kind,
            1 if repo.get("archived") else 0,
            1 if repo.get("fork") else 0,
            repo.get("pushed_at"),
            repo.get("updated_at"),
            starred_at,
            repo.get("created_at"),
            now,
        ),
    )


# --------------------------------------------------------------------------
# 同步
# --------------------------------------------------------------------------
def _progress(label, n, page):
    sys.stderr.write("\r  %s %s  %s" % (label, col(str(n), "1"), dim("第 %d 页" % page)))
    sys.stderr.flush()


def cmd_sync(args):
    token = require_token()
    db = connect()
    before = db.execute("SELECT COUNT(*) FROM repos").fetchone()[0]
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")

    print(col("同步中", "1"), flush=True)
    n_star = 0
    page = 1
    while True:
        data = api_get("/user/starred", token, {"per_page": 100, "page": page})
        if not data:
            break
        for item in data:
            repo = item.get("repo") if isinstance(item, dict) and "repo" in item else item
            starred_at = item.get("starred_at") if isinstance(item, dict) else None
            if not repo:
                continue
            upsert(db, repo, "star", starred_at)
            n_star += 1
        _progress("starred", n_star, page)
        if len(data) < 100:
            break
        page += 1
    db.commit()
    sys.stderr.write("\r" + " " * 60 + "\r")
    print("  " + green("★ star") + "  %d 个" % n_star, flush=True)

    n_own = 0
    n_fork = 0
    page = 1
    while True:
        data = api_get(
            "/user/repos", token,
            {"affiliation": "owner", "per_page": 100, "page": page, "sort": "updated"},
        )
        if not data:
            break
        for repo in data:
            if repo.get("fork"):
                upsert(db, repo, "fork")
                n_fork += 1
            else:
                upsert(db, repo, "owned")
                n_own += 1
        _progress("own/fork", n_own + n_fork, page)
        if len(data) < 100:
            break
        page += 1
    db.commit()
    sys.stderr.write("\r" + " " * 60 + "\r")
    print("  " + magenta("⑂ fork") + "  %d 个" % n_fork, flush=True)
    print("  " + cyan("● 自有") + "  %d 个" % n_own, flush=True)

    # 清理本轮已不存在于 GitHub 的记录（取消 star、删除 fork 等）
    removed = db.execute(
        "SELECT COUNT(*) FROM repos WHERE synced_at IS NULL OR synced_at < ?", (stamp,)
    ).fetchone()[0]
    db.execute("DELETE FROM repos WHERE synced_at IS NULL OR synced_at < ?", (stamp,))
    db.commit()
    if removed:
        print(dim("  清理已失效记录 %d 个" % removed))

    rebuild_fts(db)
    after = db.execute("SELECT COUNT(*) FROM repos").fetchone()[0]
    delta = after - before
    sign = "+" if delta > 0 else ""
    print("\n索引就绪：%s → %s（净变化 %s%d）"
          % (before, col(str(after), "1;32"), sign, delta), flush=True)
    print(dim("  数据库 " + DB_PATH))

    if getattr(args, "html", True):
        print()
        cmd_html(argparse.Namespace(open=False))

    print("\n开始检索： " + cyan("grepo") + "   或   " + cyan("grepo 关键词"))


# --------------------------------------------------------------------------
# 查询
# --------------------------------------------------------------------------
def fts_expr(q):
    parts = re.findall(r"[0-9A-Za-z_\u4e00-\u9fff][0-9A-Za-z_\-\./\u4e00-\u9fff]*", q)
    if not parts:
        return None
    return " AND ".join('"%s"*' % p.replace('"', "") for p in parts)


def parse_stars(expr):
    if not expr:
        return None
    m = re.match(r"^\s*(>=|<=|>|<|=)?\s*(\d+)\s*$", expr)
    if not m:
        return None
    op = m.group(1) or ">="
    return op, int(m.group(2))


def build_query(args):
    where, params = [], []
    joins_fts = False

    q = (args.query or "").strip()
    if q:
        expr = fts_expr(q)
        if expr:
            joins_fts = True
            where.append("repos_fts MATCH ?")
            params.append(expr)

    if args.lang:
        langs = [x.strip() for x in re.split(r"[,\s]+", args.lang) if x.strip()]
        if langs:
            where.append("LOWER(repos.language) IN (%s)" % ",".join("?" * len(langs)))
            params.extend([x.lower() for x in langs])

    if args.topic:
        topics = [x.strip().lower() for x in re.split(r"[,\s]+", args.topic) if x.strip()]
        for t in topics:
            where.append("LOWER(' ' || COALESCE(repos.topics,'') || ' ') LIKE ?")
            params.append("% " + t + " %")

    if args.kind:
        kinds = [x.strip().lower() for x in re.split(r"[,\s]+", args.kind) if x.strip()]
        if kinds:
            where.append("repos.kind IN (%s)" % ",".join("?" * len(kinds)))
            params.extend(kinds)

    sp = parse_stars(args.stars)
    if sp:
        where.append("repos.stars %s ?" % sp[0])
        params.append(sp[1])

    if args.since:
        where.append("COALESCE(repos.starred_at, repos.created_at) >= ?")
        params.append(args.since)

    if getattr(args, "tag", None):
        where.append("LOWER(' ' || COALESCE(repos.my_tags,'') || ' ') LIKE ?")
        params.append("% " + args.tag.strip().lower() + " %")

    if not getattr(args, "all", False):
        where.append("COALESCE(repos.archived,0)=0")

    order = {
        "starred": "COALESCE(repos.starred_at, repos.created_at) DESC",
        "stars": "repos.stars DESC",
        "name": "repos.full_name COLLATE NOCASE ASC",
        "updated": "COALESCE(repos.pushed_at, repos.updated_at) DESC",
    }.get(args.sort, "COALESCE(repos.starred_at, repos.created_at) DESC")

    if joins_fts:
        sql = (
            "SELECT repos.*, bm25(repos_fts, 10.0, 2.0, 3.0, 5.0, 3.0) AS _rank "
            "FROM repos_fts JOIN repos ON repos.id = repos_fts.rowid "
            "WHERE " + " AND ".join(where) + " ORDER BY " + (
                "_rank ASC"
            if args.sort == "starred" and q and not getattr(args, "force_sort", False)
            else order
            )
        )
    else:
        sql = "SELECT repos.* FROM repos WHERE " + (" AND ".join(where) if where else "1") + " ORDER BY " + order

    return sql + " LIMIT ?", params


def fetch(args, limit=None):
    db = connect()
    sql, params = build_query(args)
    if limit is None:
        limit = getattr(args, "limit", None) or 20000
    rows = db.execute(sql, params + [limit]).fetchall()
    return rows


# --------------------------------------------------------------------------
# 展示
# --------------------------------------------------------------------------
def fmt_num(n):
    n = n or 0
    if n >= 1000:
        return "%.1fk" % (n / 1000.0)
    return str(n)


KIND_MARK = {"star": "★", "fork": "⑂", "owned": "●"}


def row_line(r):
    name = r["full_name"]
    lang = r["language"] or "-"
    mark = KIND_MARK.get(r["kind"], "·")
    desc = (r["description"] or "").replace("\n", " ").replace("\r", " ").strip()
    tags = r["my_tags"] or ""
    line = "%s│%s│%s│%s %s" % (
        cyan(name),
        yellow(lang),
        green("★" + fmt_num(r["stars"])),
        mark,
        desc,
    )
    if tags:
        line += "  " + magenta("[" + tags + "]")
    return line


def cmd_list(args):
    rows = fetch(args)
    if args.json:
        out = []
        for r in rows:
            out.append({
                "full_name": r["full_name"],
                "description": r["description"],
                "language": r["language"],
                "stars": r["stars"],
                "kind": r["kind"],
                "topics": (r["topics"] or "").split(),
                "url": r["url"],
                "starred_at": r["starred_at"],
                "pushed_at": r["pushed_at"],
                "tags": r["my_tags"],
                "note": r["note"],
            })
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return
    for r in rows:
        if args.plain:
            print("%s\t%s\t%s\t%d\t%s\t%s" % (
                r["full_name"], r["kind"], r["language"] or "", r["stars"] or 0,
                (r["description"] or "").replace("\n", " ").strip(), r["url"] or "",
            ))
        else:
            print(row_line(r))
    if not rows:
        sys.stderr.write(dim("没有匹配结果\n"))


def cmd_preview(args):
    """供 fzf --preview 调用（收到的是带 ANSI 的第一个字段）"""
    name = strip_ansi(args.name).strip()
    db = connect()
    r = db.execute(
        "SELECT * FROM repos WHERE full_name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if not r:
        cand = db.execute(
            "SELECT * FROM repos WHERE full_name LIKE ? COLLATE NOCASE LIMIT 2",
            ("%" + name + "%",),
        ).fetchall()
        if len(cand) == 1:
            r = cand[0]
    if not r:
        print(dim("未找到 " + name))
        return
    w = 78
    print(col(r["full_name"], "36;1"))
    print(dim("─" * min(w, len(r["full_name"]) + 20)))
    desc = (r["description"] or "(无描述)").strip()
    print(desc)
    print()
    meta = [
        ("类型", {"star": "★ star", "fork": "⑂ fork", "owned": "● 自有"}.get(r["kind"], r["kind"])),
        ("语言", r["language"] or "-"),
        ("star", fmt_num(r["stars"])),
        ("fork", fmt_num(r["forks"])),
        ("最后提交", (r["pushed_at"] or "-")[:10]),
        ("star 于", (r["starred_at"] or "-")[:10]),
        ("状态", "已归档" if r["archived"] else "活跃"),
    ]
    for k, v in meta:
        print("  %s %s" % (dim(k.rjust(8)), v))
    if r["topics"]:
        print()
        print("  " + dim("topics") + "  " + " ".join(
            yellow(t) for t in r["topics"].split()[:12]
        ))
    if r["my_tags"]:
        print("  " + dim("标签") + "    " + magenta(r["my_tags"]))
    if r["note"]:
        print("  " + dim("备注") + "    " + r["note"])
    print()
    print("  " + dim(r["url"] or ""))
    if r["homepage"]:
        print("  " + dim(r["homepage"]))


# --------------------------------------------------------------------------
# fzf 交互
# --------------------------------------------------------------------------
def fzf_bin():
    for cand in ("fzf", "/opt/homebrew/bin/fzf", "/usr/local/bin/fzf"):
        p = shutil.which(cand) if "/" not in cand else (cand if os.path.exists(cand) else None)
        if p:
            return p
    return None


def cmd_browse(args):
    rows = fetch(args)
    if not rows:
        sys.stderr.write(dim("没有匹配结果\n"))
        return

    fz = fzf_bin()
    if not fz:
        for r in rows:
            print(row_line(r))
        sys.stderr.write(dim("\n未找到 fzf，已降级为纯文本输出。放 fzf 到 PATH 可获得交互浏览。\n"))
        return

    lines = [row_line(r) for r in rows]
    py, sc = sh_quote(sys.executable), sh_quote(SCRIPT)
    cmd = [
        fz,
        "--ansi",
        "--height=90%",
        "--layout=reverse",
        "--cycle",
        "--no-sort",
        "--delimiter=│",
        "--prompt=repo> ",
        "--pointer=▸",
        "--marker=✓",
        "--preview=%s %s __preview {1}" % (py, sc),
        "--preview-window=right:60%:wrap",
        "--header=共 %d 个仓库　enter 打开 · ctrl-y 复制链接 · ctrl-g 克隆到当前目录"
        % len(rows),
        "--bind=ctrl-y:execute-silent(%s %s __url {1} | pbcopy)+abort" % (py, sc),
        "--bind=ctrl-g:execute-silent(%s %s clone {1} >/dev/null 2>&1)+abort" % (py, sc),
    ]
    if args.query:
        cmd += ["--query", args.query]

    try:
        proc = subprocess.run(cmd, input="\n".join(lines), capture_output=True, text=True)
    except KeyboardInterrupt:
        return

    sel = proc.stdout.strip()
    if not sel:
        return
    name = strip_ansi(sel).split("│")[0].strip()
    if name:
        url = "https://github.com/" + name
        subprocess.run(["open", url], check=False)
        print(dim("→ " + url))


def sh_quote(s):
    return "'" + s.replace("'", "'\\''") + "'"


def cmd_url(args):
    """供 fzf ctrl-y 调用：只输出干净的仓库地址"""
    name = resolve_name(strip_ansi(args.name))
    print("https://github.com/" + name)


# --------------------------------------------------------------------------
# 其它动作
# --------------------------------------------------------------------------
def cmd_open(args):
    name = resolve_name(args.name)
    subprocess.run(["open", "https://github.com/" + name], check=False)


def cmd_clone(args):
    name = resolve_name(args.name)
    subprocess.run(["git", "clone", "https://github.com/%s.git" % name], check=False)


def resolve_name(name):
    name = strip_ansi(name).strip()
    db = connect()
    r = db.execute(
        "SELECT full_name FROM repos WHERE full_name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if r:
        return r["full_name"]
    like = db.execute(
        "SELECT full_name FROM repos WHERE full_name LIKE ? COLLATE NOCASE LIMIT 2",
        ("%" + name + "%",),
    ).fetchall()
    if len(like) == 1:
        return like[0]["full_name"]
    if len(like) > 1:
        die("匹配到多个仓库：" + ", ".join(x["full_name"] for x in like))
    die("找不到仓库：" + name)


def cmd_tag(args):
    name = resolve_name(args.name)
    db = connect()
    row = db.execute("SELECT my_tags FROM repos WHERE full_name=?", (name,)).fetchone()
    old = (row["my_tags"] or "").split()
    new = [t.strip().lower() for t in args.tags if t.strip()]
    merged = old + [t for t in new if t not in old]
    db.execute("UPDATE repos SET my_tags=? WHERE full_name=?", (" ".join(merged), name))
    db.commit()
    rebuild_fts(db)
    print("%s → %s" % (cyan(name), magenta(" ".join(merged))))


def cmd_note(args):
    name = resolve_name(args.name)
    db = connect()
    db.execute("UPDATE repos SET note=? WHERE full_name=?", (" ".join(args.text), name))
    db.commit()
    rebuild_fts(db)
    print("已记录备注：%s" % name)


def cmd_tags(args):
    db = connect()
    rows = db.execute(
        "SELECT my_tags FROM repos WHERE COALESCE(my_tags,'') <> ''"
    ).fetchall()
    counts = {}
    for r in rows:
        for t in r["my_tags"].split():
            counts[t] = counts.get(t, 0) + 1
    if not counts:
        print(dim("还没有任何自定义标签。用 grepo tag <仓库> <标签...> 添加。"))
        return
    for t, n in sorted(counts.items(), key=lambda x: -x[1]):
        print("%s %s" % (magenta(t.ljust(20)), dim(str(n))))


def cmd_stats(args):
    db = connect()
    total = db.execute("SELECT COUNT(*) FROM repos").fetchone()[0]
    if not total:
        print(dim("索引为空，先运行 grepo sync"))
        return

    def table(title, sql):
        print(col(title, "1"))
        for r in db.execute(sql):
            print("  %-24s %s" % (r[0] or "-", dim(str(r[1]))))
        print()

    print("\n%s  %s\n" % (col("总计", "1"), col(str(total) + " 个仓库", "1;32")))
    table("类型", "SELECT kind, COUNT(*) FROM repos GROUP BY kind ORDER BY 2 DESC")
    table("语言 Top 12", "SELECT language, COUNT(*) FROM repos GROUP BY language "
                         "ORDER BY 2 DESC LIMIT 12")
    table("Topic Top 12", """
        WITH RECURSIVE split(name, rest) AS (
            SELECT '', topics || ' ' FROM repos WHERE COALESCE(topics,'') <> ''
            UNION ALL
            SELECT substr(rest, 1, instr(rest,' ')-1), substr(rest, instr(rest,' ')+1)
            FROM split WHERE rest <> ''
        )
        SELECT name, COUNT(*) FROM split WHERE name <> ''
        GROUP BY name ORDER BY 2 DESC LIMIT 12
    """)
    row = db.execute(
        "SELECT SUM(stars), AVG(stars), MIN(starred_at), MAX(starred_at) FROM repos WHERE kind='star'"
    ).fetchone()
    if row and row[3]:
        print(col("star 时间跨度", "1"))
        print("  %s → %s" % ((row[2] or "")[:10], (row[3] or "")[:10]))
    if os.path.exists(HTML_PATH):
        print(dim("\nHTML 页面：" + HTML_PATH))


# --------------------------------------------------------------------------
# HTML 导出
# --------------------------------------------------------------------------
HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>grepo · __TOTAL__ 个仓库</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --border: #30363d; --fg: #e6edf3;
    --muted: #8b949e; --accent: #58a6ff; --green: #3fb950; --yellow: #d29922;
    --purple: #bc8cff; --red: #f85149;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff; --panel: #f6f8fa; --border: #d0d7de; --fg: #1f2328;
      --muted: #656d76; --accent: #0969da; --green: #1a7f37; --yellow: #9a6700;
      --purple: #8250df; --red: #cf222e;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC",
          "Helvetica Neue", sans-serif;
  }
  header {
    position: sticky; top: 0; z-index: 10; background: var(--bg);
    border-bottom: 1px solid var(--border); padding: 14px 20px 10px;
  }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  input[type=search], select {
    background: var(--panel); color: var(--fg); border: 1px solid var(--border);
    border-radius: 6px; padding: 7px 10px; font-size: 14px; outline: none;
  }
  input[type=search] { flex: 1; min-width: 240px; }
  input[type=search]:focus, select:focus { border-color: var(--accent); }
  .stat { color: var(--muted); font-size: 12px; margin-top: 8px; }
  .stat b { color: var(--fg); }
  main { padding: 8px 20px 60px; }
  .item {
    display: grid; grid-template-columns: 1fr auto; gap: 4px 14px;
    padding: 11px 12px; border-bottom: 1px solid var(--border);
    border-radius: 6px; cursor: pointer;
  }
  .item:hover { background: var(--panel); }
  .name { font-weight: 600; color: var(--accent); text-decoration: none; font-size: 14.5px; }
  .name:hover { text-decoration: underline; }
  .kind { color: var(--muted); font-weight: 400; margin-right: 3px; }
  .desc { color: var(--muted); font-size: 13px; margin-top: 2px;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden; }
  .meta { text-align: right; color: var(--muted); font-size: 12px;
          white-space: nowrap; line-height: 1.9; }
  .lang { color: var(--yellow); }
  .stars { color: var(--green); font-variant-numeric: tabular-nums; }
  .topics { margin-top: 5px; }
  .tag {
    display: inline-block; font-size: 11px; padding: 1px 7px; margin: 2px 4px 0 0;
    border: 1px solid var(--border); border-radius: 999px; color: var(--muted);
  }
  .tag.mine { color: var(--purple); border-color: var(--purple); }
  .empty { color: var(--muted); text-align: center; padding: 60px 0; }
  #more { display: block; margin: 18px auto; padding: 9px 22px; cursor: pointer;
          background: var(--panel); color: var(--fg);
          border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
  kbd { background: var(--panel); border: 1px solid var(--border); border-bottom-width: 2px;
        border-radius: 4px; padding: 1px 5px; font-size: 11px; font-family: inherit; }
</style>
</head>
<body>
<header>
  <div class="row">
    <input type="search" id="q" placeholder="搜索仓库名 / 描述 / topic / 标签…" autofocus>
    <select id="kind">
      <option value="">全部类型</option>
      <option value="star">★ star</option>
      <option value="fork">⑂ fork</option>
      <option value="owned">● 自有</option>
    </select>
    <select id="lang"><option value="">全部语言</option></select>
    <select id="sort">
      <option value="starred">最近 star</option>
      <option value="stars">star 最多</option>
      <option value="name">名称</option>
      <option value="pushed">最近提交</option>
    </select>
  </div>
  <div class="stat" id="stat"></div>
</header>
<main id="list"></main>
<button id="more">显示更多</button>

<script id="data" type="application/json">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const PAGE = 120;
let shown = PAGE;

const qEl = document.getElementById('q');
const kindEl = document.getElementById('kind');
const langEl = document.getElementById('lang');
const sortEl = document.getElementById('sort');
const listEl = document.getElementById('list');
const statEl = document.getElementById('stat');
const moreEl = document.getElementById('more');

const langs = {};
for (const r of DATA) if (r.language) langs[r.language] = (langs[r.language] || 0) + 1;
Object.entries(langs).sort((a, b) => b[1] - a[1]).forEach(([l, n]) => {
  const o = document.createElement('option');
  o.value = l; o.textContent = `${l} (${n})`;
  langEl.appendChild(o);
});

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function num(n) {
  n = n || 0;
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}
const MARK = { star: '★', fork: '⑂', owned: '●' };
const KEY = 'grepo-last-query';

function filtered() {
  const q = qEl.value.trim().toLowerCase();
  const terms = q ? q.split(/\\s+/) : [];
  const kind = kindEl.value;
  const lang = langEl.value;
  let out = DATA.filter(r => {
    if (kind && r.kind !== kind) return false;
    if (lang && r.language !== lang) return false;
    if (!terms.length) return true;
    const hay = (r.full_name + ' ' + (r.description || '') + ' ' +
                 (r.topics || []).join(' ') + ' ' + (r.tags || '')).toLowerCase();
    return terms.every(t => hay.includes(t));
  });
  const s = sortEl.value;
  if (s === 'stars') out.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  else if (s === 'name') out.sort((a, b) => a.full_name.localeCompare(b.full_name));
  else if (s === 'pushed') out.sort((a, b) => String(b.pushed_at || '').localeCompare(String(a.pushed_at || '')));
  else out.sort((a, b) => String(b.starred_at || b.created_at || '').localeCompare(String(a.starred_at || a.created_at || '')));
  return out;
}

function render(reset) {
  const rows = filtered();
  if (reset) { listEl.innerHTML = ''; shown = PAGE; }
  const slice = rows.slice(0, shown);
  if (reset) {
    statEl.innerHTML = `<b>${rows.length}</b> / ${DATA.length} 个仓库　·　<kbd>/</kbd> 聚焦搜索　<kbd>Esc</kbd> 清空`;
  }
  const frag = document.createDocumentFragment();
  for (const r of slice.slice(listEl.children.length)) {
    const el = document.createElement('div');
    el.className = 'item';
    const tags = (r.tags || '').split(/\\s+/).filter(Boolean)
      .map(t => `<span class="tag mine">${esc(t)}</span>`).join('');
    const topics = (r.topics || []).slice(0, 8)
      .map(t => `<span class="tag">${esc(t)}</span>`).join('');
    el.innerHTML =
      `<div><a class="name" href="${esc(r.url)}" target="_blank" rel="noopener">` +
      `<span class="kind">${MARK[r.kind] || ''}</span>${esc(r.full_name)}</a>` +
      `<div class="desc">${esc(r.description)}</div>` +
      (topics || tags ? `<div class="topics">${topics}${tags}</div>` : '') +
      `</div>` +
      `<div class="meta"><span class="stars">★ ${num(r.stars)}</span><br>` +
      `<span class="lang">${esc(r.language || '-')}</span><br>` +
      `<span>${esc(String(r.starred_at || r.pushed_at || '').slice(0, 10))}</span></div>`;
    frag.appendChild(el);
  }
  listEl.appendChild(frag);
  if (!rows.length) {
    listEl.innerHTML = '<div class="empty">没有匹配结果</div>';
  }
  moreEl.style.display = rows.length > listEl.children.length ? 'block' : 'none';
  moreEl.textContent = `显示更多（还有 ${rows.length - listEl.children.length} 个）`;
}

qEl.addEventListener('input', () => { localStorage.setItem(KEY, qEl.value); render(true); });
kindEl.addEventListener('change', () => render(true));
langEl.addEventListener('change', () => render(true));
sortEl.addEventListener('change', () => render(true));
moreEl.addEventListener('click', () => { shown += PAGE; render(false); });
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== qEl) { e.preventDefault(); qEl.focus(); qEl.select(); }
  if (e.key === 'Escape') { qEl.value = ''; localStorage.removeItem(KEY); render(true); }
});
const saved = localStorage.getItem(KEY);
if (saved) qEl.value = saved;
render(true);
</script>
</body>
</html>
"""


def cmd_html(args):
    db = connect()
    rows = db.execute(
        "SELECT full_name, description, language, stars, kind, topics, url, "
        "starred_at, pushed_at, created_at, my_tags, note FROM repos "
        "ORDER BY COALESCE(starred_at, created_at) DESC"
    ).fetchall()
    if not rows:
        die("索引为空，先运行 grepo sync")

    data = []
    for r in rows:
        data.append({
            "full_name": r["full_name"],
            "description": r["description"] or "",
            "language": r["language"] or "",
            "stars": r["stars"] or 0,
            "kind": r["kind"] or "",
            "topics": (r["topics"] or "").split(),
            "url": r["url"] or ("https://github.com/" + r["full_name"]),
            "starred_at": r["starred_at"] or "",
            "pushed_at": r["pushed_at"] or "",
            "created_at": r["created_at"] or "",
            "tags": r["my_tags"] or "",
            "note": r["note"] or "",
        })

    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</", "<\\/").replace("<!--", "<\\!--")
    html = HTML_TEMPLATE.replace("__DATA__", payload).replace("__TOTAL__", str(len(data)))

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(HTML_PATH, "w", encoding="utf-8") as fh:
        fh.write(html)
    size = os.path.getsize(HTML_PATH) / 1024.0
    print("已生成 %s（%.0f KB，%d 个仓库）" % (col(HTML_PATH, "36"), size, len(data)))
    if args.open:
        subprocess.run(["open", HTML_PATH], check=False)


# --------------------------------------------------------------------------
# 入口
# --------------------------------------------------------------------------
SUBCOMMANDS = {"sync", "html", "stats", "setup", "tag", "note", "tags",
               "open", "clone", "__preview", "__url", "list", "ls", "browse"}


def add_filters(p):
    p.add_argument("query", nargs="?", default="")
    p.add_argument("--lang", default="")
    p.add_argument("--topic", default="")
    p.add_argument("--kind", default="")
    p.add_argument("--stars", default="")
    p.add_argument("--since", default="")
    p.add_argument("--tag", default="")
    p.add_argument("--sort", default="starred",
                   choices=["starred", "stars", "name", "updated"])
    p.add_argument("--all", action="store_true", help="包含已归档仓库")
    p.add_argument("--limit", type=int, default=20000)


def main():
    argv = sys.argv[1:]
    first = argv[0] if argv else ""

    if first in ("-h", "--help", "help"):
        print(__doc__.strip())
        return
    if first in ("-V", "--version", "version"):
        print("grepo 1.0")
        return

    if not first or first not in SUBCOMMANDS:
        # 默认：浏览模式，参数全部当过滤条件
        if first in ("-l", "--list"):
            args_in = argv[1:]
            parser = argparse.ArgumentParser(add_help=False)
            add_filters(parser)
            parser.add_argument("--json", action="store_true")
            parser.add_argument("--plain", action="store_true")
            ns, _extra = parser.parse_known_args(args_in)
            return cmd_list(ns)
        if first == "-j":
            args_in = argv[1:]
            parser = argparse.ArgumentParser(add_help=False)
            add_filters(parser)
            ns, _extra = parser.parse_known_args(args_in)
            ns.json = True
            ns.plain = False
            return cmd_list(ns)

        parser = argparse.ArgumentParser(add_help=False)
        add_filters(parser)
        ns, _extra = parser.parse_known_args(argv)
        ns.json = False
        ns.plain = False
        ns.force_sort = False
        return cmd_browse(ns)

    # 子命令
    if first == "sync":
        return cmd_sync(argparse.Namespace())

    if first == "setup":
        return cmd_setup(argparse.Namespace())

    if first == "html":
        p = argparse.ArgumentParser(prog="grepo html")
        p.add_argument("--open", action="store_true")
        return cmd_html(p.parse_args(argv[1:]))

    if first == "stats":
        return cmd_stats(argparse.Namespace())

    if first == "tags":
        return cmd_tags(argparse.Namespace())

    if first == "open":
        p = argparse.ArgumentParser(prog="grepo open")
        p.add_argument("name")
        return cmd_open(p.parse_args(argv[1:]))

    if first == "clone":
        p = argparse.ArgumentParser(prog="grepo clone")
        p.add_argument("name")
        return cmd_clone(p.parse_args(argv[1:]))

    if first == "tag":
        p = argparse.ArgumentParser(prog="grepo tag")
        p.add_argument("name")
        p.add_argument("tags", nargs="+")
        return cmd_tag(p.parse_args(argv[1:]))

    if first == "note":
        p = argparse.ArgumentParser(prog="grepo note")
        p.add_argument("name")
        p.add_argument("text", nargs="+")
        return cmd_note(p.parse_args(argv[1:]))

    if first == "__preview":
        p = argparse.ArgumentParser(prog="grepo __preview")
        p.add_argument("name", nargs="?", default="")
        return cmd_preview(p.parse_args(argv[1:]))

    if first == "__url":
        p = argparse.ArgumentParser(prog="grepo __url")
        p.add_argument("name", nargs="?", default="")
        return cmd_url(p.parse_args(argv[1:]))

    if first in ("list", "ls"):
        parser = argparse.ArgumentParser(add_help=False)
        add_filters(parser)
        parser.add_argument("--json", action="store_true")
        parser.add_argument("--plain", action="store_true")
        ns, _ = parser.parse_known_args(argv[1:])
        return cmd_list(ns)

    if first == "browse":
        parser = argparse.ArgumentParser(add_help=False)
        add_filters(parser)
        ns, _ = parser.parse_known_args(argv[1:])
        ns.force_sort = False
        return cmd_browse(ns)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except Exception:
            pass
        os._exit(0)
    except KeyboardInterrupt:
        sys.exit(130)
