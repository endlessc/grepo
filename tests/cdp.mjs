/* 极简 CDP 客户端：Node 22+ 自带 WebSocket，不需要任何依赖。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.onmessage = (ev) => this._onMessage(ev.data);
  }

  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = (e) => rej(new Error("ws error: " + (e.message || "unknown")));
    });
    return new CDP(ws);
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
      else p.res(msg.result);
      return;
    }
    const h = this.handlers.get(msg.method);
    if (h) h(msg.params);
  }

  on(method, fn) {
    this.handlers.set(method, fn);
  }

  send(method, params) {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async eval(expression, awaitPromise) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: !!awaitPromise,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const d =
        r.exceptionDetails.exception?.description ||
        r.exceptionDetails.text ||
        "eval failed";
      throw new Error(d);
    }
    return r.result.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function launchChrome(profileDir, extraArgs) {
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(process.env.EXT_ARGS ? [] : ["--disable-extensions"]),
    "--disable-background-networking",
    "--disable-sync",
    "--enable-precise-memory-info",
    "--window-size=1440,900",
    ...(extraArgs || []),
    "about:blank",
  ];
  const proc = spawn(CHROME, args, { stdio: "ignore" });

  const portFile = path.join(profileDir, "DevToolsActivePort");
  let port = null;
  for (let i = 0; i < 200; i++) {
    if (fs.existsSync(portFile)) {
      const txt = fs.readFileSync(portFile, "utf8").split("\n");
      if (txt[0]) {
        port = Number(txt[0]);
        if (port) break;
      }
    }
    await sleep(100);
  }
  if (!port) {
    proc.kill();
    throw new Error("Chrome 没能启动调试端口");
  }

  let target = null;
  for (let i = 0; i < 100; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) =>
        r.json()
      );
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target) {
    proc.kill();
    throw new Error("找不到可调试的页面");
  }

  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return { proc, cdp, port };
}

export function newProfile(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `grepo-${tag}-`));
}
