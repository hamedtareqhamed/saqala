#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const {
  listCustomTemplates,
  createCustomTemplate,
  extractZipTemplate,
  copyCustomTemplateFiles,
  inspectTemplateVariants,
} = require(path.join(__dirname, "templates.js"));

/* System zip-based templates (maps key → zip filename) */
const SYSTEM_TEMPLATES = {
  "node-js": { key: "node-js", zipPath: "node-js.zip", lang: "js" },
  "node-ts": { key: "node-ts", zipPath: "node-ts.zip", lang: "ts" },
};
const { loadGenerators, saveCustomGenerator } = require(path.join(__dirname, "generators.js"));

/* ---------- Runtime Paths ---------- */
const WORKSPACE_DIR = path.resolve(process.cwd());
const PROJECTS_DIR = path.join(WORKSPACE_DIR, "projects");
const STATIC_DIR = __dirname;
const TEMPLATES_ZIP_DIR = path.join(__dirname, "templates");

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

let desiredPort = Number(process.env.PORT) || 8080;
let currentPort = desiredPort;

const SYSTEM_DIRS = new Set(["node_modules", ".git", ".vscode", ".idea", ".saqala", "templates"]);
const SYSTEM_FILES = new Set([
  "server.js",
  "templates.js",
  "generators.js",
  "index.html",
  "styles.css",
  "app.js",
  "package.json",
  "package-lock.json",
  "README.md",
  "server.log"
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const STATIC_FILES = ["index.html", "styles.css", "app.js", "favicon.svg"];

function send(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error("Request payload exceeds limit"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

/* ---------- Path Security & Input Hardening ---------- */
function cleanProjectName(name) {
  if (!name || typeof name !== "string") return null;
  const raw = name.trim().toLowerCase();
  const cleaned = raw.replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..")) return null;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(cleaned)) return null;
  return cleaned;
}

function safeJoin(name) {
  const cleanName = cleanProjectName(name);
  if (!cleanName) return null;

  const target = path.resolve(PROJECTS_DIR, cleanName);
  if (!target.startsWith(PROJECTS_DIR + path.sep)) {
    return null;
  }
  return target;
}

/* ---------- CSRF Protection ---------- */
function isOriginAllowed(req) {
  const origin = req.headers["origin"] || req.headers["referer"];
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const host = originUrl.hostname;
    const port = originUrl.port || (originUrl.protocol === "https:" ? "443" : "80");

    const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    const isMatchingPort = String(port) === String(currentPort);

    return isLocalhost && isMatchingPort;
  } catch {
    return false;
  }
}

/* ---------- Directory Stats ---------- */
function dirStats(dir) {
  let size = 0;
  let files = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        const sub = dirStats(p);
        size += sub.size;
        files += sub.files;
      } else {
        size += fs.statSync(p).size;
        files++;
      }
    }
  } catch { /* empty */ }
  return { size, files };
}

/* ---------- Package & Dependencies ---------- */
function readPkg(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function depsInfo(dir) {
  const pkg = readPkg(dir);
  if (!pkg) return { deps: [], devDeps: [], nodeModules: 0, hasPkg: false };
  const nm = path.join(dir, "node_modules");
  const installed = fs.existsSync(nm)
    ? new Set(fs.readdirSync(nm).filter((n) => !n.startsWith(".")))
    : new Set();
  const map = (o) =>
    Object.entries(o || {}).map(([name, version]) => ({
      name,
      version: String(version).replace(/^[\^~]/, ""),
      installed: installed.has(name),
    }));
  return {
    deps: map(pkg.dependencies),
    devDeps: map(pkg.devDependencies),
    nodeModules: installed.size,
    hasPkg: true,
  };
}

/* ---------- Running Projects ---------- */
const RUNNING = new Map();

function isProcAlive(entry) {
  return !!(entry && entry.proc && entry.proc.exitCode === null);
}

function stopProject(name) {
  const entry = RUNNING.get(name);
  if (entry) {
    try {
      process.kill(-entry.proc.pid, "SIGTERM");
    } catch {
      try { entry.proc.kill("SIGTERM"); } catch { /* process exited */ }
    }
    setTimeout(() => {
      try { process.kill(-entry.proc.pid, "SIGKILL"); } catch { /* process exited */ }
    }, 3000);
    RUNNING.delete(name);
  }
  return { running: false, port: null };
}

function runProject(name) {
  return new Promise((resolve) => {
    const dir = safeJoin(name);
    if (!dir || !fs.existsSync(dir)) return resolve({ error: "Project directory not found" });

    const existing = RUNNING.get(name);
    if (isProcAlive(existing)) return resolve({ running: true, port: existing.port });

    const pkg = readPkg(dir);
    const hasDeps =
      pkg &&
      Object.keys(pkg.dependencies || {}).length +
        Object.keys(pkg.devDependencies || {}).length >
        0;
    if (hasDeps && !fs.existsSync(path.join(dir, "node_modules"))) {
      return resolve({
        error: "Dependencies not installed. Run `npm install` inside the project folder first.",
      });
    }

    let meta = null;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, ".scaffold.json"), "utf8"));
    } catch {
      meta = null;
    }

    const runCmdStr = meta?.runCommand || "npm run dev";
    const parts = runCmdStr.split(" ");
    const cmdBinary = parts[0] || "npm";
    const cmdArgs = parts.slice(1);

    const env = { ...process.env };
    delete env.PORT;
    const proc = spawn(cmdBinary, cmdArgs, {
      cwd: dir,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const entry = { proc, port: null, log: [] };
    RUNNING.set(name, entry);

    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      entry.log.push(text);
      if (entry.log.length > 60) entry.log.shift();
      const m = text.match(/(?:localhost|127\.0\.0\.1):(\d+)/);
      if (m && !entry.port) entry.port = parseInt(m[1], 10);
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);

    proc.on("exit", () => {
      if (RUNNING.get(name) === entry) RUNNING.delete(name);
    });

    let waited = 0;
    const poll = setInterval(() => {
      if (entry.port) {
        clearInterval(poll);
        return resolve({ running: true, port: entry.port });
      }
      if (!isProcAlive(entry) || waited > 10000) {
        clearInterval(poll);
        if (RUNNING.get(name) === entry) RUNNING.delete(name);
        return resolve({
          running: false,
          error: entry.log.join("").slice(-800) || "Server process terminated unexpectedly",
        });
      }
      waited += 250;
    }, 250);
  });
}

function inferTemplate(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.react || deps["react-dom"]) return "react";
    if (deps.vite) return "vite";
    return "node-js";
  } catch {
    return null;
  }
}

function inferLang(dir, template) {
  if (!template) return null;
  if (template.includes("ts")) return "ts";
  const check = template.includes("node") ? "src/index.ts" : "src/main.ts";
  return fs.existsSync(path.join(dir, check)) ? "ts" : "js";
}

function projectInfo(name) {
  const dir = safeJoin(name);
  if (!dir || !fs.existsSync(dir)) return null;

  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, ".scaffold.json"), "utf8"));
  } catch {
    meta = null;
  }

  const template = meta?.template ?? inferTemplate(dir);
  const lang = meta?.lang ?? inferLang(dir, template);
  const stats = dirStats(dir);
  const stat = fs.statSync(dir);
  const runEntry = RUNNING.get(name);

  return {
    name,
    template,
    lang,
    files: stats.files,
    size: stats.size,
    createdAt: meta?.createdAt ?? stat.birthtimeMs,
    modifiedAt: stat.mtimeMs,
    running: isProcAlive(runEntry),
    port: runEntry?.port ?? null,
  };
}

function listProjects() {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return [];
    return fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          !SYSTEM_DIRS.has(e.name)
      )
      .map((e) => projectInfo(e.name))
      .filter(Boolean)
      .sort((a, b) => b.modifiedAt - a.modifiedAt);
  } catch {
    return [];
  }
}

/* ---------- File Tree Builder ---------- */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache"]);

function buildFileTree(dir, depth = 0) {
  const children = [];
  if (depth > 8) return children;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".env") continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) {
          children.push({ name: e.name, type: "dir", skipped: true, children: [] });
        } else {
          children.push({ name: e.name, type: "dir", children: buildFileTree(path.join(dir, e.name), depth + 1) });
        }
      } else {
        const stat = fs.statSync(path.join(dir, e.name));
        children.push({ name: e.name, type: "file", size: stat.size });
      }
    }
  } catch { /* empty */ }
  return children;
}

/* ---------- User Settings ---------- */
const SETTINGS_DIR = path.join(WORKSPACE_DIR, ".saqala");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

const DEFAULT_IDES = [
  { id: "vscode",   name: "VS Code",    command: "code ./" },
  { id: "cursor",   name: "Cursor",     command: "cursor ./" },
  { id: "zed",      name: "Zed",        command: "zed ./" },
  { id: "neovim",   name: "Neovim",     command: "nvim ." },
  { id: "webstorm", name: "WebStorm",   command: "webstorm ./" },
];

function loadSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    } catch { /* fall through */ }
  }
  const defaults = { defaultIde: "vscode", ides: DEFAULT_IDES };
  saveSettings(defaults);
  return defaults;
}

function saveSettings(data) {
  if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf8");
}

/* ---------- Terminal PTY Session ---------- */
class TermScreen {
  constructor(maxLines = 400) {
    this.lines = [""];
    this.row = 0;
    this.col = 0;
    this.max = maxLines;
  }

  ensureRow(r) {
    while (this.lines.length <= r) this.lines.push("");
    if (this.lines.length > this.max) {
      const drop = this.lines.length - this.max;
      this.lines.splice(0, drop);
      this.row = Math.max(0, this.row - drop);
    }
  }

  esc(params, cmd) {
    const p = params.split(";").map(Number);
    switch (cmd) {
      case "A": this.row = Math.max(0, this.row - (p[0] || 1)); break;
      case "B": this.row += p[0] || 1; this.ensureRow(this.row); break;
      case "C": this.col += p[0] || 1; break;
      case "D": this.col = Math.max(0, this.col - (p[0] || 1)); break;
      case "G": this.col = Math.max(0, (p[0] || 1) - 1); break;
      case "H":
      case "f":
        this.row = Math.max(0, (p[0] || 1) - 1);
        this.col = Math.max(0, (p[1] || 1) - 1);
        this.ensureRow(this.row);
        break;
      case "K":
        if (p[0] === 2) this.lines[this.row] = "";
        else this.lines[this.row] = this.lines[this.row].slice(0, this.col);
        break;
      case "J":
        this.lines = [""];
        this.row = 0;
        this.col = 0;
        break;
      default: break;
    }
  }

  writeChar(ch) {
    if (!this.lines[this.row]) this.ensureRow(this.row);
    const line = this.lines[this.row];
    this.lines[this.row] =
      this.col >= line.length
        ? line + ch
        : line.slice(0, this.col) + ch + line.slice(this.col + 1);
    this.col++;
  }

  feed(chunk) {
    let i = 0;
    while (i < chunk.length) {
      const c = chunk[i];
      if (c === "\x1b") {
        const m = chunk.slice(i).match(/^\x1b\[([0-9;?]*)([A-Za-z])/);
        if (m) {
          this.esc(m[1], m[2]);
          i += m[0].length;
        } else {
          i++;
        }
        continue;
      }
      if (c === "\r") { this.col = 0; }
      else if (c === "\n") { this.ensureRow(this.row + 1); this.row++; this.col = 0; }
      else if (c === "\b") { this.col = Math.max(0, this.col - 1); }
      else if (c === "\x07") { /* bell */ }
      else this.writeChar(c);
      i++;
    }
  }

  text() {
    return this.lines.join("\n");
  }

  clear() {
    this.lines = [""];
    this.row = 0;
    this.col = 0;
  }
}

let ptySession = null;
let sseRes = null;

function ptyBroadcast(event, data) {
  if (sseRes) {
    sseRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

function dirNames() {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return new Set();
    return new Set(
      fs
        .readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() &&
            !e.name.startsWith(".") &&
            !SYSTEM_DIRS.has(e.name)
        )
        .map((e) => e.name)
    );
  } catch {
    return new Set();
  }
}

function killSession() {
  if (!ptySession) return;
  try {
    ptySession.proc.kill("SIGTERM");
    setTimeout(() => {
      try { ptySession.proc.kill("SIGKILL"); } catch { /* empty */ }
    }, 2500);
  } catch { /* empty */ }
  ptySession = null;
}

function startPty(cmd, options = {}) {
  killSession();

  const before = dirNames();
  const screen = new TermScreen();
  
  let ptyBinary = "script";
  let ptyArgs = ["-qefc", cmd, "/dev/null"];
  
  if (process.platform === "win32") {
    ptyBinary = "cmd.exe";
    ptyArgs = ["/c", cmd];
  } else if (process.platform === "darwin") {
    ptyBinary = "sh";
    ptyArgs = ["-c", cmd];
  }

  const proc = spawn(ptyBinary, ptyArgs, {
    cwd: PROJECTS_DIR,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "inherit"],
    shell: process.platform === "win32",
  });

  const autoAnswered = new Set();
  const AUTO_ANSWERS = [
    { key: "install", match: /Install with npm and start now/i, reply: "\x1b[B\r" },
    { key: "remove", match: /Remove existing files/i, reply: "\x1b[B\r" },
    { key: "linter", match: /Which linter/i, reply: "\r" },
    { key: "prettier", match: /use Prettier/i, reply: "\r" },
    { key: "router", match: /React Router/i, reply: "\r" },
  ];

  ptySession = {
    proc,
    screen,
    running: true,
    cmd,
    before,
    startedAt: Date.now(),
  };

  proc.stdout.on("data", (d) => {
    const text = d.toString("utf8");
    screen.feed(text);
    if (options.autoAnswer) {
      const cur = screen.text();
      for (const a of AUTO_ANSWERS) {
        if (!autoAnswered.has(a.key) && a.match.test(cur)) {
          autoAnswered.add(a.key);
          try { proc.stdin.write(a.reply); } catch { /* empty */ }
          break;
        }
      }
    }
    ptyBroadcast("out", { screen: screen.text() });
  });

  proc.on("error", (err) => {
    ptyBroadcast("exit", { code: -1, error: err.message, newProjects: [] });
    ptySession = null;
  });

  proc.on("close", (code) => {
    const after = dirNames();
    const newProjects = [...after].filter((n) => !before.has(n));
    ptyBroadcast("exit", { code, error: null, newProjects });
    if (ptySession) ptySession.running = false;
  });

  ptyBroadcast("out", { screen: "", cmd, note: "starting" });
  return ptySession;
}

function openFolder(name, cb) {
  const dir = safeJoin(name);
  if (!dir || !fs.existsSync(dir)) return cb(new Error("Folder does not exist"));

  let cmd, args;
  if (process.platform === "darwin") {
    cmd = "open";
    args = [dir];
  } else if (process.platform === "win32") {
    cmd = "explorer";
    args = [dir];
  } else {
    cmd = "xdg-open";
    args = [dir];
  }

  execFile(cmd, args, { timeout: 10000 }, (err) => cb(err));
}

/* ---------- HTTP Server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  /* CSRF Protection */
  if (url.pathname.startsWith("/api/")) {
    if (!isOriginAllowed(req)) {
      return send(res, 403, { error: "Forbidden: CSRF Origin Check Failed" });
    }
  }

  try {
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }

      /* GET /api/templates */
      if (url.pathname === "/api/templates" && req.method === "GET") {
        // Build enriched system templates list
        const SYSTEM_TEMPLATE_META = {
          "node-js": {
            key: "node-js",
            name: "Node.js (JS)",
            icon: "node",
            color: "#6fc05a",
            tagline: "Clean Node.js JavaScript environment with automatic HTTP server integration.",
            chips: ["node:http", "esm", "javascript"],
            defaultName: "my-node-js",
            type: "zip",
            zipPath: "node-js.zip",
            hasVariants: false,
            variants: [],
          },
          "node-ts": {
            key: "node-ts",
            name: "Node.js (TS)",
            icon: "node",
            color: "#3178c6",
            tagline: "TypeScript Node.js project with TSX watcher and typed server integration.",
            chips: ["node:http", "typescript", "tsx"],
            defaultName: "my-node-ts",
            type: "zip",
            zipPath: "node-ts.zip",
            hasVariants: false,
            variants: [],
          },
        };
        const sysList = Object.values(SYSTEM_TEMPLATE_META).filter((t) =>
          fs.existsSync(path.join(TEMPLATES_ZIP_DIR, t.zipPath))
        );
        const customList = listCustomTemplates(WORKSPACE_DIR);
        return send(res, 200, { templates: [...sysList, ...customList] });
      }

      /* POST /api/templates/custom */
      if (url.pathname === "/api/templates/custom" && req.method === "POST") {
        const body = await readBody(req);
        try {
          const tpl = createCustomTemplate(WORKSPACE_DIR, body);
          return send(res, 201, { template: tpl });
        } catch (err) {
          if (err.code === "EXISTS") return send(res, 409, { error: "Custom template already exists" });
          return send(res, 400, { error: err.message });
        }
      }

      /* GET /api/generators */
      if (url.pathname === "/api/generators" && req.method === "GET") {
        return send(res, 200, { generators: loadGenerators(WORKSPACE_DIR) });
      }

      /* POST /api/generators */
      if (url.pathname === "/api/generators" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.name || !body.command) {
          return send(res, 400, { error: "Generator name and command are required" });
        }
        const gen = saveCustomGenerator(WORKSPACE_DIR, body);
        return send(res, 201, { generator: gen });
      }

      /* POST /api/scaffold/start */
      if (url.pathname === "/api/scaffold/start" && req.method === "POST") {
        const { name, template, lang, variant } = await readBody(req);
        const clean = cleanProjectName(name);

        if (!clean) {
          return send(res, 400, { error: "Invalid project name — letters, numbers, hyphens only" });
        }
        if (SYSTEM_DIRS.has(clean) || SYSTEM_FILES.has(clean)) {
          return send(res, 400, { error: "Reserved system directory name" });
        }

        const targetDir = safeJoin(clean);
        if (!targetDir) return send(res, 400, { error: "Invalid target path" });
        if (fs.existsSync(targetDir)) {
          return send(res, 409, { error: `Directory "${clean}" already exists.` });
        }

        // 1. System Zip Template
        if (SYSTEM_TEMPLATES[template]) {
          const sysTpl = SYSTEM_TEMPLATES[template];
          const zipPath = path.join(TEMPLATES_ZIP_DIR, sysTpl.zipPath);
          if (!fs.existsSync(zipPath)) {
            return send(res, 500, { error: `Zip archive ${sysTpl.zipPath} missing` });
          }
          extractZipTemplate(zipPath, targetDir, clean, (err) => {
            if (err) return send(res, 500, { error: "Failed to extract Zip template: " + err.message });
            fs.writeFileSync(
              path.join(targetDir, ".scaffold.json"),
              JSON.stringify({ name: clean, template, lang: lang || "js", createdAt: Date.now() }, null, 2)
            );
            return send(res, 201, { created: "static", project: projectInfo(clean) });
          });
          return;
        }

        // 2. Custom GUI Template (Dynamic Subfolders Detection)
        if (template.startsWith("custom-")) {
          const customList = listCustomTemplates(WORKSPACE_DIR);
          const custTpl = customList.find((t) => t.key === template);
          if (!custTpl) return send(res, 404, { error: "Custom template not found" });
          
          const selectedVar = variant || (custTpl.hasVariants ? custTpl.variants[0] : null);
          copyCustomTemplateFiles(custTpl.path, targetDir, clean, selectedVar);
          
          fs.writeFileSync(
            path.join(targetDir, ".scaffold.json"),
            JSON.stringify({ name: clean, template, lang: selectedVar || lang || "js", createdAt: Date.now() }, null, 2)
          );
          return send(res, 201, { created: "static", project: projectInfo(clean) });
        }

        // 3. Script Generator (Vite, React, or custom CLI)
        const generators = loadGenerators(WORKSPACE_DIR);
        const gen = generators.find((g) => g.id === template);
        if (gen) {
          const flag = gen.flags?.[lang] || (lang === "ts" ? "ts" : "js");
          const cmdStr = gen.command
            .replaceAll("__NAME__", clean)
            .replaceAll("__FLAG__", flag);
          const fullCmd = `stty cols 120 rows 50; ${cmdStr}`;
          
          // Write metadata file with template & runCommand info
          if (fs.existsSync(targetDir)) {
            fs.writeFileSync(
              path.join(targetDir, ".scaffold.json"),
              JSON.stringify({ name: clean, template, lang: lang || "js", runCommand: gen.runCommand || "npm run dev", createdAt: Date.now() }, null, 2)
            );
          }
          
          startPty(fullCmd, { autoAnswer: true });
          return send(res, 200, { created: "pty", cmd: fullCmd, projectName: clean });
        }

        return send(res, 400, { error: "Unknown template or generator" });
      }

      if (url.pathname === "/api/pty/stream" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`event: hello\ndata: {}\n\n`);
        sseRes = res;
        if (ptySession) {
          res.write(`event: out\ndata: ${JSON.stringify({ screen: ptySession.screen.text(), cmd: ptySession.cmd, running: ptySession.running })}\n\n`);
        }
        req.on("close", () => {
          if (sseRes === res) sseRes = null;
        });
        return;
      }

      if (url.pathname === "/api/projects" && req.method === "GET") {
        return send(res, 200, { projects: listProjects() });
      }

      /* GET /api/settings */
      if (url.pathname === "/api/settings" && req.method === "GET") {
        return send(res, 200, { settings: loadSettings() });
      }

      /* POST /api/settings */
      if (url.pathname === "/api/settings" && req.method === "POST") {
        const body = await readBody(req);
        saveSettings(body);
        return send(res, 200, { ok: true });
      }

      const name = parts[2];
      const action = parts[3];
      if (!name || (action && !["run", "stop", "open", "files", "open-ide", "log"].includes(action))) {
        return send(res, 404, { error: "Not found" });
      }

      const dir = safeJoin(name);
      if (!dir || !fs.existsSync(dir)) {
        return send(res, 404, { error: "Project directory not found" });
      }

      if (req.method === "GET" && !action) {
        const info = projectInfo(name);
        const files = {};
        const runEntry = RUNNING.get(name);
        const log = runEntry ? runEntry.log.join("").slice(-3000) : "";
        return send(res, 200, {
          project: { ...info, ...depsInfo(dir), files, log },
        });
      }

      if (req.method === "DELETE") {
        stopProject(name);
        if (dir !== WORKSPACE_DIR) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
        return send(res, 200, { ok: true });
      }

      if (req.method === "POST" && parts[3] === "run") {
        const result = await runProject(name);
        return send(res, 200, result);
      }

      if (req.method === "POST" && parts[3] === "stop") {
        return send(res, 200, stopProject(name));
      }

      if (req.method === "POST" && action === "open") {
        openFolder(name, (err) => {
          if (err) return send(res, 500, { error: "Failed to open folder: " + err.message });
          send(res, 200, { ok: true });
        });
        return;
      }

      /* GET /api/projects/:name/files — file tree */
      if (req.method === "GET" && action === "files") {
        const tree = buildFileTree(dir);
        return send(res, 200, { tree });
      }

      /* POST /api/projects/:name/open-ide — open in IDE */
      if (req.method === "POST" && action === "open-ide") {
        const body = await readBody(req);
        const ideCmd = String(body.command || "").trim();
        if (!ideCmd) return send(res, 400, { error: "IDE command is required" });
        const cmdParts = ideCmd.split(/\s+/);
        const binary = cmdParts[0];
        const args = cmdParts.slice(1).map((a) => a === "./" ? dir : a);
        if (args.length === 0) args.push(dir);
        execFile(binary, args, { cwd: dir, timeout: 10000 }, (err) => {
          if (err) return send(res, 500, { error: "Failed to open IDE: " + err.message });
        });
        return send(res, 200, { ok: true });
      }

      /* GET /api/projects/:name/log — SSE live run log */
      if (req.method === "GET" && action === "log") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const runEntry = RUNNING.get(name);
        const existing = runEntry ? runEntry.log.join("") : "";
        res.write(`event: log\ndata: ${JSON.stringify({ log: existing })}\n\n`);

        if (!runEntry || !isProcAlive(runEntry)) {
          res.write(`event: status\ndata: ${JSON.stringify({ running: false })}\n\n`);
          return res.end();
        }

        res.write(`event: status\ndata: ${JSON.stringify({ running: true })}\n\n`);

        const onData = (chunk) => {
          res.write(`event: log\ndata: ${JSON.stringify({ log: chunk.toString() })}\n\n`);
        };
        runEntry.proc.stdout && runEntry.proc.stdout.on("data", onData);
        runEntry.proc.stderr && runEntry.proc.stderr.on("data", onData);

        const onClose = () => {
          res.write(`event: status\ndata: ${JSON.stringify({ running: false })}\n\n`);
          res.end();
        };
        runEntry.proc.on("close", onClose);

        req.on("close", () => {
          runEntry.proc.stdout && runEntry.proc.stdout.off("data", onData);
          runEntry.proc.stderr && runEntry.proc.stderr.off("data", onData);
          runEntry.proc.off("close", onClose);
        });
        return;
      }

      return send(res, 405, { error: "Method not allowed" });
    }

    /* Static Assets Serving */
    const requested = parts[0] || "index.html";
    if (!STATIC_FILES.includes(requested)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const filePath = path.join(STATIC_DIR, requested);
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    return res.end(content);
  } catch (err) {
    console.error("[error]", err.message);
    send(res, 500, { error: "Server error: " + err.message });
  }
});

/* ---------- Start Server with Dynamic Port Allocation ---------- */
function startServer(port) {
  server.listen(port, () => {
    currentPort = port;
    console.log("");
    console.log("  ============================================");
    console.log("  Saqala — Project Management Dashboard Ready");
    console.log("  ============================================");
    console.log(`  Open in browser:  http://localhost:${currentPort}`);
    console.log(`  Workspace dir:    ${WORKSPACE_DIR}`);
    console.log("");
  });
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`  ⚠ Port ${desiredPort} busy, trying port ${desiredPort + 1}...`);
    desiredPort++;
    startServer(desiredPort);
  } else {
    console.error("  Server error:", err.message);
    process.exit(1);
  }
});

startServer(desiredPort);
