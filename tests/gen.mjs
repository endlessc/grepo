/* 生成 4000 条接近真实分布的仓库数据，供压测使用。
 * 固定随机种子，保证新旧方案跑的是同一份数据。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let seed = 20261110;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}
function pickW(pairs) {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
function int(a, b) {
  return a + Math.floor(rnd() * (b - a + 1));
}

const ORGS = [
  "microsoft", "google", "facebook", "vercel", "denoland", "nodejs", "rust-lang",
  "golang", "apache", "kubernetes", "docker", "hashicorp", "cloudflare", "netlify",
  "supabase", "prisma", "sveltejs", "vuejs", "withastro", "remix-run", "tailwindlabs",
  "typst", "zed-industries", "astral-sh", "ggml-org", "ollama", "openai", "huggingface",
  "run-llama", "langchain-ai", "chroma-core", "qdrant", "meilisearch", "typesense",
  "redis", "duckdb", "duckdb", "pola-rs", "apache", "jupyter", "pandas-dev",
];
const USERS = [];
for (let i = 0; i < 60; i++) USERS.push("user" + i);

const ADJ = [
  "fast", "tiny", "light", "smart", "simple", "modern", "legacy", "open", "auto",
  "micro", "deep", "flat", "zero", "pure", "lite", "next", "raw", "quiet", "sharp",
];
const NOUN = [
  "cli", "parser", "renderer", "server", "client", "sdk", "toolkit", "engine",
  "runner", "builder", "proxy", "cache", "queue", "store", "watcher", "loader",
  "planner", "tracker", "compiler", "bot", "bridge", "daemon", "shell", "kit",
];
const LANGS = [
  ["TypeScript", 26], ["Python", 22], ["JavaScript", 16], ["Go", 10], ["Rust", 9],
  ["C++", 5], ["Shell", 4], ["Java", 3], ["Kotlin", 2], ["Swift", 1.5], ["C", 1],
  ["HTML", 0.5], ["Dart", 0.5], ["Ruby", 0.5],
];
const TOPICS = [
  "cli", "tool", "api", "sdk", "devops", "docker", "kubernetes", "ai", "llm",
  "rag", "pdf", "markdown", "parser", "compiler", "database", "http", "proxy",
  "testing", "ci-cd", "terminal", "tui", "plugin", "generator", "monitoring",
  "security", "encryption", "vector-db", "embedding", "fine-tuning", "openai",
  "anthropic", "agent", "workflow", "automation", "scraping", "crawler", "image",
  "video", "audio", "speech", "game", "engine", "wasm", "webassembly", "rust-lang",
  "python-tool", "node", "deno", "bun", "serverless", "edge", "graphql",
  "websocket", "grpc", "postgres", "sqlite", "redis", "kafka", "duckdb", "polars",
  "numpy", "pytorch", "tensorflow", "llama", "gguf", "transformers", "diffusion",
  "browser", "chrome-extension", "vscode", "neovim", "zsh", "vim", "tmux",
];
const DESC_EN = [
  "A {adj} {noun} for {topic} workflows.",
  "{Topic} toolkit: a {adj} {noun} with first-class support for {topic2}.",
  "Self-hosted {noun} that turns {topic} into a {adj} pipeline.",
  "Blazingly {adj} {noun} for working with {topic} at scale.",
  "A batteries-included {noun} for {topic}, written in {lang}.",
  "Opinionated {topic} {noun} — {adj} by default, flexible when you need it.",
  "Command line {noun} for {topic}. Zero config, {adj} defaults.",
  "Library and {noun} for building {topic} applications in {lang}.",
  "Turn any {topic} file into structured data with this {adj} {noun}.",
  "Everything you need to build, ship and monitor {topic} services.",
];
const DESC_ZH = [
  "一个面向{topic}的{adj}{noun}，开箱即用。",
  "把{topic}文件转成结构化数据的{adj}工具。",
  "自托管的{topic}服务，部署简单，运行稳定。",
  "用 {lang} 写的{topic}{noun}，专注性能与可读性。",
  "一站式{topic}解决方案：解析、转换、检索一条龙。",
  "轻量的{topic}命令行工具，支持管道与脚本调用。",
];

const TOTAL = Number(process.env.TOTAL || 4000);
const OWNED = 60; // 自建仓库
const FORKED = 140; // fork

const stars = [];
const own = [];

function makeRepo(i) {
  const owner = pickW([
    [pick(ORGS), 6],
    [pick(USERS), 4],
  ]);
  const name = pick(ADJ) + "-" + pick(NOUN);
  const lang = pickW(LANGS);
  const topics = [];
  const tn = int(0, 6);
  for (let k = 0; k < tn; k++) {
    const t = pick(TOPICS);
    if (!topics.includes(t)) topics.push(t);
  }
  const isZh = rnd() < 0.3;
  const topic = pick(TOPICS);
  const desc = isZh
    ? pick(DESC_ZH)
        .replace("{topic}", topic)
        .replace("{adj}", pick(ADJ))
        .replace("{noun}", pick(NOUN))
        .replace("{lang}", lang)
    : pick(DESC_EN)
        .replace("{adj}", pick(ADJ))
        .replace("{noun}", pick(NOUN))
        .replace("{topic2}", pick(TOPICS))
        .replace("{topic}", topic)
        .replace("{lang}", lang);

  // 星标数按幂律分布
  const u = rnd();
  const starsCount = Math.floor(Math.pow(u, 3.2) * 60000) + int(0, 12);

  const year = int(2016, 2026);
  const month = int(1, year === 2026 ? 11 : 12);
  const day = int(1, 28);
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(int(0, 23)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}:00Z`;

  return {
    id: 100000 + i,
    full_name: `${owner}/${name}${i % 7 === 0 ? "-" + i : ""}`,
    owner: { login: owner },
    name: name + (i % 7 === 0 ? "-" + i : ""),
    description: desc,
    html_url: `https://github.com/${owner}/${name}`,
    homepage: "",
    language: rnd() < 0.07 ? null : lang,
    stargazers_count: starsCount,
    forks_count: Math.floor(starsCount * (0.05 + rnd() * 0.2)),
    topics,
    archived: rnd() < 0.03,
    fork: false,
    pushed_at: dateStr,
    updated_at: dateStr,
    created_at: dateStr,
    _starred_at: dateStr,
  };
}

for (let i = 0; i < TOTAL - OWNED - FORKED; i++) {
  const r = makeRepo(i);
  stars.push({ starred_at: r._starred_at, repo: r });
}
for (let i = 0; i < OWNED; i++) {
  const r = makeRepo(100000 + i);
  r.fork = false;
  delete r._starred_at;
  own.push(r);
}
for (let i = 0; i < FORKED; i++) {
  const r = makeRepo(200000 + i);
  r.fork = true;
  delete r._starred_at;
  own.push(r);
}

const out = { stars, own };
const file = path.join(HERE, process.env.OUT || "repos.json");
fs.writeFileSync(file, JSON.stringify(out));
const bytes = fs.statSync(file).size;
console.log(
  `生成 ${stars.length} 星标 + ${own.length} 自建/fork = ${stars.length + own.length} 条，` +
    `${(bytes / 1024 / 1024).toFixed(2)} MB → ${file}`
);
