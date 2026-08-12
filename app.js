"use strict";

/* ============================================================
   Saqala — Local Project Workspace & Scaffold Center
   ============================================================ */

const state = {
  templates: [],
  generators: [],
  projects: [],
  template: null,
  lang: "js",
  running: false,
  projectSearch: "",
  projectFilter: "all",
  templateSearch: "",
  recentTemplates: JSON.parse(localStorage.getItem("saqala_recent") || "[]"),
  wizardVars: [], // Parsed dynamic CLI variables
  dynamicVarValues: {}, // Current values on creation screen
  logEventSource: null, // Active SSE connection for live project logs
};

const BRAND_ICONS = {
  vite: `<svg viewBox="0 0 32 32" width="26" height="26" fill="none"><path d="M30 4.5L17.2 29.8c-.5.9-1.8.9-2.3 0L2.1 4.5c-.5-1 .3-2.1 1.4-2l12.4 1.7c.3 0 .7 0 1 0l11.7-1.7c1.1-.1 1.9 1 1.4 2z" fill="url(#viteGrad)"/><defs><linearGradient id="viteGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#41D1FF"/><stop offset="100%" stop-color="#BD34FE"/></linearGradient></defs></svg>`,
  react: `<svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="#61DAFB" stroke-width="1.6"><ellipse cx="16" cy="16" rx="13" ry="5"/><ellipse cx="16" cy="16" rx="13" ry="5" transform="rotate(60 16 16)"/><ellipse cx="16" cy="16" rx="13" ry="5" transform="rotate(120 16 16)"/><circle cx="16" cy="16" r="2.5" fill="#61DAFB"/></svg>`,
  node: `<svg viewBox="0 0 32 32" width="26" height="26" fill="none"><path d="M16 2L3 9.5v15L16 32l13-7.5v-15L16 2z" fill="#339933"/><path d="M16 4.5l10.8 6.2v12.5L16 29.5 5.2 23.2V10.7L16 4.5z" fill="#026E00"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#10b981" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  code: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#10b981" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>`
};

const ARROW_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

const $ = (sel) => document.querySelector(sel);
const screens = {
  hero: $("#screen-hero"),
  dashboard: $("#screen-dashboard"),
  wizard: $("#screen-wizard"),
  term: $("#screen-term"),
  project: $("#screen-project"),
  settings: $("#screen-settings"),
};

const esc = (s) =>
  String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function formatSize(bytes) {
  if (!bytes) return "0 B";
  const kb = bytes / 1024;
  return kb < 1 ? `${bytes} B` : `${kb.toFixed(1)} KB`;
}

function formatDate(ms) {
  try {
    return new Date(ms).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Unexpected server error"), { status: res.status });
  return data;
}

function toast(message, type = "info", duration = 4200) {
  const icons = { success: "✓", error: "✕", info: "!" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
  $("#toast-wrap").appendChild(el);
  setTimeout(() => {
    el.classList.add("hide");
    setTimeout(() => el.remove(), 320);
  }, duration);
}

function copyText(text, btn) {
  const done = () => {
    btn.classList.add("copied");
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
    setTimeout(() => resetCopyBtn(btn), 1800);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch { /* empty */ }
  ta.remove();
}

function resetCopyBtn(btn) {
  btn.classList.remove("copied");
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke-linecap="round"/></svg>`;
}

function showScreen(name) {
  Object.keys(screens).forEach((key) => {
    const el = screens[key];
    if (el) {
      el.hidden = key !== name;
    }
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function pushRecentTemplate(key) {
  const normKey = key.toLowerCase().startsWith("node") ? "node" : key;
  state.recentTemplates = state.recentTemplates.map(k => k.toLowerCase().startsWith("node") ? "node" : k);
  state.recentTemplates = state.recentTemplates.filter((k) => k !== normKey);
  state.recentTemplates.unshift(normKey);
  if (state.recentTemplates.length > 5) state.recentTemplates.pop();
  localStorage.setItem("saqala_recent", JSON.stringify(state.recentTemplates));
  renderRecentTemplates();
}

function renderRecentTemplates() {
  const wrap = $("#recent-templates-list");
  if (!wrap) return;

  const allCards = getConsolidatedCards();
  const recentCards = state.recentTemplates
    .map((key) => {
      const normKey = key.toLowerCase().startsWith("node") ? "node" : key;
      return allCards.find((c) => c.key === normKey);
    })
    .filter(Boolean);

  if (recentCards.length === 0) {
    wrap.innerHTML = `<div style="font-size: 0.8rem; color: var(--text-muted); padding: 0.2rem 0.5rem;">No recent templates used yet.</div>`;
    return;
  }

  wrap.innerHTML = "";
  recentCards.forEach((tpl) => {
    const item = document.createElement("div");
    item.className = "recent-tpl-item";
    item.innerHTML = `
      <span style="color:${tpl.color || "#10b981"}">${BRAND_ICONS[tpl.icon] || BRAND_ICONS.code}</span>
      <span style="font-weight:600;">${esc(tpl.name)}</span>
    `;
    item.addEventListener("click", () => {
      $("#dropdown-create-menu").hidden = true;
      openTerminal(tpl);
    });
    wrap.appendChild(item);
  });
}

/* =============== Data Fetching & Adaptive UI =============== */
async function loadData() {
  try {
    const [{ templates }, { generators }, { projects }] = await Promise.all([
      api("/api/templates"),
      api("/api/generators"),
      api("/api/projects"),
    ]);

    state.templates = templates || [];
    state.generators = generators || [];
    state.projects = projects || [];

    renderRecentTemplates();
    renderAdaptiveUI();
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderAdaptiveUI() {
  const hasProjects = state.projects.length > 0;
  const hasCustomTemplates = state.templates.some((t) => t.type === "custom");

  if (!hasProjects && !hasCustomTemplates) {
    showScreen("hero");
    renderTemplateCards("#hero-template-cards");
  } else {
    showScreen("dashboard");
    renderProjects();
    renderTemplateCards("#dashboard-template-cards");
  }
}

function getConsolidatedCards() {
  const tplMap = new Map();
  const seenNames = new Set();

  tplMap.set("node", {
    key: "node",
    name: "Node.js",
    icon: "node",
    color: "#10b981",
    tagline: "Clean Node.js environment with JS & TS options.",
    chips: ["node:http", "esm", "js / ts"],
    defaultName: "node-app",
    type: "zip",
    supportsLangToggle: true,
  });
  seenNames.add("node.js");
  seenNames.add("node.js app");

  state.templates.forEach((t) => {
    const keyLower = t.key.toLowerCase();
    const nameKey = (t.name || t.key).toLowerCase().trim();
    if (keyLower.includes("node") || nameKey.includes("node.js") || nameKey.includes("node js")) return;
    if (seenNames.has(nameKey)) return;
    seenNames.add(nameKey);
    tplMap.set(t.key, { ...t, category: "template" });
  });

  state.generators.forEach((g) => {
    const idLower = g.id.toLowerCase();
    const nameKey = (g.name || g.id).toLowerCase().trim();
    if (idLower.includes("node") || nameKey.includes("node.js") || nameKey.includes("node js")) return;
    if (seenNames.has(nameKey)) return;
    seenNames.add(nameKey);
    tplMap.set(g.id, {
      key: g.id,
      name: g.name,
      icon: g.icon || "code",
      color: g.color || "#10b981",
      tagline: g.tagline,
      chips: [g.isSystem ? "CLI Generator" : "Custom Script"],
      defaultName: g.id + "-app",
      type: "generator",
      category: "generator",
      command: g.command,
      runCommand: g.runCommand || "npm run dev",
      variables: g.variables || [],
      supportsLang: g.supportsLang,
    });
  });

  const cards = Array.from(tplMap.values());
  return cards.sort((a, b) => a.name.localeCompare(b.name));
}

function renderTemplateCards(containerSel) {
  const wrap = $(containerSel);
  if (!wrap) return;
  wrap.innerHTML = "";

  const q = state.templateSearch.toLowerCase().trim();
  const cards = getConsolidatedCards().filter((item) => {
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      (item.tagline && item.tagline.toLowerCase().includes(q)) ||
      (item.key && item.key.toLowerCase().includes(q))
    );
  });

  cards.forEach((tpl, i) => {
    const card = document.createElement("button");
    card.className = "tpl-card";
    card.type = "button";
    card.style.setProperty("--tpl-color", tpl.color || "#10b981");
    card.style.animationDelay = `${i * 0.05}s`;
    card.setAttribute("role", "listitem");
    card.innerHTML = `
      <span class="tpl-icon">${BRAND_ICONS[tpl.icon] || BRAND_ICONS.code}</span>
      <span class="tpl-name">${esc(tpl.name)}</span>
      <span class="tpl-tag">${esc(tpl.tagline)}</span>
      <span class="tpl-chips">${(tpl.chips || []).map((c) => `<span class="tpl-chip">${esc(c)}</span>`).join("")}</span>
      <span class="tpl-cta">Start Scaffold ${ARROW_ICON}</span>
    `;
    card.addEventListener("click", () => openTerminal(tpl));
    wrap.appendChild(card);
  });
}

function renderProjects() {
  const grid = $("#projects-grid");
  const countEl = $("#projects-count");
  if (!grid) return;

  const q = state.projectSearch.toLowerCase().trim();
  const filter = state.projectFilter;

  const filtered = state.projects.filter((p) => {
    const matchName = !q || p.name.toLowerCase().includes(q);
    const matchFilter =
      filter === "all"
        ? true
        : filter === "custom"
        ? (p.template || "").startsWith("custom")
        : (p.template || "").includes(filter);
    return matchName && matchFilter;
  });

  countEl.textContent = state.projects.length;
  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; color: var(--text-muted); font-size: 0.9rem; padding: 1rem 0;">No matching projects found.</div>`;
    return;
  }

  filtered.forEach((p, i) => {
    const isNode = (p.template || "").includes("node");
    const iconKey = isNode ? "node" : p.template === "react" ? "react" : p.template === "vite" ? "vite" : "folder";
    const color = isNode ? "#10b981" : iconKey === "react" ? "#61dafb" : iconKey === "vite" ? "#8b93ff" : "#10b981";
    const badge = isNode ? "Node.js" : p.template || "Project";

    const running = !!p.running;
    const statusHtml = running
      ? `<div class="project-status on"><span class="status-led"></span>Running on <a class="site-link" href="http://localhost:${p.port}" target="_blank" rel="noopener">localhost:${p.port}</a></div>`
      : `<div class="project-status"><span class="status-led off"></span>Stopped</div>`;

    const card = document.createElement("div");
    card.className = "project-card";
    card.dataset.name = p.name;
    card.style.animationDelay = `${i * 0.05}s`;
    card.innerHTML = `
      <div class="project-top">
        <span class="project-icon" style="--pcolor:${color}">${BRAND_ICONS[iconKey] || BRAND_ICONS.folder}</span>
        <div class="project-id">
          <span class="project-name" dir="ltr">${esc(p.name)}</span>
          <span class="project-badges">
            <span class="tpl-badge" style="color:${color}">${esc(badge)}</span>
            ${p.lang ? `<span class="lang-pill ${p.lang}">${p.lang.toUpperCase()}</span>` : ""}
          </span>
        </div>
      </div>
      <div class="project-meta">
        <span>${p.files} files</span>
        <span>·</span>
        <span>${formatSize(p.size)}</span>
        <span>·</span>
        <span>Modified: ${formatDate(p.modifiedAt)}</span>
      </div>
      ${statusHtml}
      <div class="project-actions">
        <button class="project-run ${running ? "stopping" : ""}" type="button" data-name="${esc(p.name)}">
          ${running
            ? `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>`
            : `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`}
          <span>${running ? "Stop" : "Run"}</span>
        </button>
        <button class="project-open" type="button" data-open="${esc(p.name)}">Open Folder</button>
        <button class="project-delete" type="button" data-delete="${esc(p.name)}" aria-label="Delete project">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    `;

    card.querySelector(".project-run").addEventListener("click", () => toggleProjectRun(p.name, running));
    card.querySelector(".project-open").addEventListener("click", () => openProjectFolder(p.name));
    card.querySelector(".project-delete").addEventListener("click", () => deleteProject(p.name));

    grid.appendChild(card);
  });
}

/* =============== Search & Filter Listeners =============== */
const projectSearchInput = $("#project-search");
if (projectSearchInput) {
  projectSearchInput.addEventListener("input", (e) => {
    state.projectSearch = e.target.value;
    renderProjects();
  });
}

const projectFilterSelect = $("#project-filter");
if (projectFilterSelect) {
  projectFilterSelect.addEventListener("change", (e) => {
    state.projectFilter = e.target.value;
    renderProjects();
  });
}

const templateSearchInput = $("#template-search");
if (templateSearchInput) {
  templateSearchInput.addEventListener("input", (e) => {
    state.templateSearch = e.target.value;
    renderTemplateCards("#dashboard-template-cards");
  });
}

/* =============== Scaffold & Dynamic Variables Engine =============== */
const termView = $("#term-view");
const termContent = $("#term-content");
const termInput = $("#term-input");
const createBtn = $("#create-btn");
const termStopBtn = $("#term-stop-btn");
const nameInput = $("#project-name");
const cmdPreview = $("#cmd-preview-code");
const copyCmdBtn = $("#copy-cmd-btn");
const termStatusText = $("#term-status-text");
const termStatusDot = $(".term-status-dot");
let eventSource = null;

function updateCreationUI() {
  const tpl = getConsolidatedCards().find((c) => c.key === state.template);
  const isStaticZip = tpl && (tpl.type === "zip" || tpl.type === "custom");
  const cmdPreviewWrap = document.querySelector(".cmd-preview");
  const termStopBtn = $("#term-stop-btn");
  const termConsole = document.querySelector(".term-console");
  const termStatus = $("#term-status");
  const langPickerWrap = $("#lang-picker-wrap");

  if (cmdPreviewWrap) cmdPreviewWrap.hidden = isStaticZip;
  if (termStopBtn) termStopBtn.style.display = isStaticZip ? "none" : "";
  if (termConsole) termConsole.hidden = isStaticZip;
  if (termStatus) termStatus.hidden = isStaticZip;

  if (langPickerWrap) {
    const showPicker = tpl && (tpl.supportsLangToggle || (tpl.hasVariants && tpl.variants.length > 0));
    langPickerWrap.style.display = showPicker ? "" : "none";
  }
}

function renderDynamicVariablesForm(tpl) {
  const container = $("#dynamic-vars-form-container");
  if (!container) return;
  container.innerHTML = "";
  state.dynamicVarValues = {};

  if (!tpl || tpl.type === "zip" || tpl.type === "custom") return;

  const vars = tpl.variables || [];
  vars.forEach((v) => {
    if (v.isProjectName || v.name === "name" || v.name === "__NAME__") return;

    const group = document.createElement("div");
    group.className = "form-group";

    if (v.type === "boolean") {
      state.dynamicVarValues[v.name] = !!v.default;
      group.innerHTML = `
        <label class="checkbox-label">
          <input type="checkbox" id="dyn-var-${v.name}" ${v.default ? "checked" : ""} />
          <span>${esc(v.label || v.name)} (Flag: <code>--${v.name}</code>)</span>
        </label>
      `;
      const chk = group.querySelector("input");
      chk.addEventListener("change", (e) => {
        state.dynamicVarValues[v.name] = e.target.checked;
        renderCmdPreview();
      });
    } else if (v.type === "choice") {
      const choices = Array.isArray(v.choices) ? v.choices : String(v.choices || "").split(",").map((s) => s.trim());
      state.dynamicVarValues[v.name] = choices[0] || "";
      group.innerHTML = `
        <label for="dyn-var-${v.name}">${esc(v.label || v.name)}</label>
        <select id="dyn-var-${v.name}">
          ${choices.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
        </select>
      `;
      const sel = group.querySelector("select");
      sel.addEventListener("change", (e) => {
        state.dynamicVarValues[v.name] = e.target.value;
        renderCmdPreview();
      });
    } else {
      state.dynamicVarValues[v.name] = v.default || "";
      group.innerHTML = `
        <label for="dyn-var-${v.name}">${esc(v.label || v.name)}</label>
        <input type="text" id="dyn-var-${v.name}" value="${esc(v.default || "")}" placeholder="Enter ${esc(v.name)}" />
      `;
      const inp = group.querySelector("input");
      inp.addEventListener("input", (e) => {
        state.dynamicVarValues[v.name] = e.target.value;
        renderCmdPreview();
      });
    }

    container.appendChild(group);
  });
}

function openTerminal(tpl) {
  pushRecentTemplate(tpl.key);
  state.template = tpl.key;
  state.lang = "js";
  state.selectedVariant = tpl.hasVariants && tpl.variants.length > 0 ? tpl.variants[0] : null;
  nameInput.value = tpl.defaultName || "my-app";
  $("#term-template-name").textContent = tpl.name;
  $("#term-template-name").style.color = tpl.color || "#10b981";

  const langPickerWrap = $("#lang-picker-wrap");
  if (langPickerWrap) {
    if (tpl.hasVariants && tpl.variants.length > 0) {
      langPickerWrap.innerHTML = tpl.variants
        .map(
          (v, idx) => `
            <button class="lang-card ${idx === 0 ? "picked" : ""}" data-variant="${esc(v)}" type="button">
              <span class="lang-badge ${esc(v)}">${esc(v.toUpperCase())}</span>
              <span class="lang-info"><span class="lang-name">${esc(v)}</span></span>
            </button>
          `
        )
        .join("");

      langPickerWrap.querySelectorAll(".lang-card").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.selectedVariant = btn.dataset.variant;
          state.lang = btn.dataset.variant;
          langPickerWrap.querySelectorAll(".lang-card").forEach((b) => b.classList.toggle("picked", b === btn));
          renderCmdPreview();
        });
      });
    } else {
      langPickerWrap.innerHTML = `
        <button class="lang-card js-lang picked" data-lang="js" type="button">
          <span class="lang-badge js">JS</span>
          <span class="lang-info"><span class="lang-name">JavaScript</span></span>
        </button>
        <button class="lang-card ts-lang" data-lang="ts" type="button">
          <span class="lang-badge ts">TS</span>
          <span class="lang-info"><span class="lang-name">TypeScript</span></span>
        </button>
      `;
      langPickerWrap.querySelectorAll(".lang-card").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.lang = btn.dataset.lang;
          langPickerWrap.querySelectorAll(".lang-card").forEach((b) => b.classList.toggle("picked", b === btn));
          renderCmdPreview();
        });
      });
    }
  }

  updateCreationUI();
  renderDynamicVariablesForm(tpl);
  renderCmdPreview();
  clearTerminal();
  setStatus("Enter directory name and parameters, then click Create Project.", "idle");
  setRunning(false);
  showScreen("term");
}

function getActualTemplateKey() {
  if (state.template === "node") {
    return state.lang === "ts" ? "node-ts" : "node-js";
  }
  return state.template;
}

function buildCommand() {
  const tpl = getConsolidatedCards().find((c) => c.key === state.template);
  if (!tpl) return "";
  if (tpl.type === "zip" || tpl.type === "custom") {
    const varText = state.selectedVariant ? ` (${state.selectedVariant.toUpperCase()} variant)` : "";
    return `Static Zip Template${varText} — Extracts project files instantly`;
  }
  const flag = state.lang === "ts" ? "ts" : "js";
  const name = nameInput.value.trim() || tpl.defaultName;

  let cmd = (tpl.command || `npm create vite@latest {{name}}`)
    .replaceAll("{{name}}", name)
    .replaceAll("__NAME__", name)
    .replaceAll("{{templateFlag}}", flag)
    .replaceAll("__FLAG__", flag);

  if (tpl.variables && tpl.variables.length) {
    tpl.variables.forEach((v) => {
      if (v.isProjectName || v.name === "name" || v.name === "__NAME__") return;
      const val = state.dynamicVarValues[v.name];
      if (v.type === "boolean") {
        const flagStr = val ? `--${v.name}` : "";
        cmd = cmd.replaceAll(`--${v.name}={{${v.name}}}`, flagStr).replaceAll(`{{${v.name}}}`, flagStr);
      } else {
        cmd = cmd.replaceAll(`{{${v.name}}}`, val || "").replaceAll(`__${v.name}__`, val || "");
      }
    });
  }

  return cmd;
}

function renderCmdPreview() {
  cmdPreview.textContent = buildCommand();
}

nameInput.addEventListener("input", renderCmdPreview);

copyCmdBtn.addEventListener("click", (e) => copyText(buildCommand(), e.currentTarget));

function setRunning(run) {
  state.running = run;
  termStopBtn.disabled = !run;
  termInput.disabled = !run;
  if (run) termInput.focus();
}

function setStatus(text, kind = "idle") {
  termStatusText.textContent = text;
  termStatusDot.dataset.kind = kind;
}

function renderTerm(text) {
  termContent.textContent = text || " ";
  termView.scrollTop = termView.scrollHeight;
}

function clearTerminal() {
  renderTerm("");
}

function finishRun() {
  createBtn.disabled = false;
  nameInput.disabled = false;
  document.querySelectorAll(".builder .lang-card").forEach((b) => (b.disabled = false));
  setRunning(false);
}

createBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();

  if (!name) {
    toast("Please enter a directory name.", "error");
    nameInput.focus();
    return;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
    toast("Invalid name — letters, numbers, and hyphens only.", "error");
    return;
  }

  createBtn.disabled = true;
  nameInput.disabled = true;
  document.querySelectorAll(".builder .lang-card").forEach((b) => (b.disabled = true));
  clearTerminal();
  setStatus("Initializing project...", "run");
  setRunning(true);

  const actualKey = getActualTemplateKey();

  try {
    const res = await api("/api/scaffold/start", {
      method: "POST",
      body: JSON.stringify({
        name,
        template: actualKey,
        lang: state.lang,
        variant: state.selectedVariant,
      }),
    });

    if (res.created === "static") {
      setStatus("Project created successfully.", "ok");
      toast(`Project <code>${esc(name)}</code> initialized.`, "success");
      await loadData();
      finishRun();
      renderAdaptiveUI();
    } else {
      connectStream(res);
    }
  } catch (err) {
    setStatus("Failed: " + err.message, "error");
    toast(esc(err.message), "error");
    finishRun();
  }
});

termStopBtn.addEventListener("click", async () => {
  try { await api("/api/pty/stop", { method: "POST" }); } catch { /* empty */ }
  setStatus("Stopped by user.", "idle");
  finishRun();
});

function connectStream(res) {
  if (eventSource) eventSource.close();
  eventSource = new EventSource("/api/pty/stream");

  eventSource.addEventListener("out", (e) => {
    const d = JSON.parse(e.data);
    renderTerm(d.screen);
    if (d.running) setStatus("Generating project — output below...", "run");
  });

  eventSource.addEventListener("exit", (e) => {
    const d = JSON.parse(e.data);
    eventSource.close();
    eventSource = null;

    if (d.error) {
      setStatus("Failed with error: " + d.error, "error");
      toast("Creation failed: " + esc(d.error), "error");
    } else if (d.code === 0 || d.code === null) {
      setStatus("Creation completed successfully.", "ok");
    } else {
      setStatus(`Terminated with exit code ${d.code}`, "error");
    }

    const isSuccess = !d.error && (d.code === 0 || d.code === null);
    loadData().then(() => {
      if (isSuccess) renderAdaptiveUI();
    });
    finishRun();
  });
}

/* =============== Project Actions =============== */
async function toggleProjectRun(name, running) {
  try {
    if (running) {
      await api(`/api/projects/${encodeURIComponent(name)}/stop`, { method: "POST" });
      toast(`Stopped project <code>${esc(name)}</code>`, "info");
    } else {
      toast(`Starting dev server for <code>${esc(name)}</code>...`, "info");
      await api(`/api/projects/${encodeURIComponent(name)}/run`, { method: "POST" });
      toast(`Project <code>${esc(name)}</code> is running!`, "success");
    }
    await loadData();
  } catch (err) {
    toast(esc(err.message), "error");
  }
}

async function openProjectFolder(name) {
  try {
    await api(`/api/projects/${encodeURIComponent(name)}/open`, { method: "POST" });
    toast(`Opened project folder <code>${esc(name)}</code>`, "success");
  } catch (err) {
    toast(esc(err.message), "error");
  }
}

async function deleteProject(name) {
  if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) return;
  try {
    await api(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" });
    toast(`Project <code>${esc(name)}</code> deleted.`, "success");
    await loadData();
  } catch (err) {
    toast(esc(err.message), "error");
  }
}

/* =============== Inline Header Dropdown & Dedicated Wizard Screen =============== */
const btnCreateMain = $("#btn-create-main");
const dropdownMenu = $("#dropdown-create-menu");

if (btnCreateMain && dropdownMenu) {
  btnCreateMain.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownMenu.hidden = !dropdownMenu.hidden;
  });

  document.addEventListener("click", (e) => {
    if (!dropdownMenu.contains(e.target) && e.target !== btnCreateMain) {
      dropdownMenu.hidden = true;
    }
  });
}

$("#drop-opt-wizard")?.addEventListener("click", () => {
  dropdownMenu.hidden = true;
  showScreen("wizard");
});

$("#drop-opt-browse")?.addEventListener("click", () => {
  dropdownMenu.hidden = true;
  renderAdaptiveUI();
  const tplSec = $("#templates-section");
  if (tplSec) tplSec.scrollIntoView({ behavior: "smooth" });
});

$("#btn-wizard-back")?.addEventListener("click", () => {
  renderAdaptiveUI();
});

// Wizard Tabs: Mode 1 (Directory) vs Mode 2 (CLI Script)
const tabDir = $("#tab-btn-directory");
const tabCli = $("#tab-btn-cli");
const formDir = $("#form-wizard-directory");
const formCli = $("#form-wizard-cli");

tabDir?.addEventListener("click", () => {
  tabDir.classList.add("active");
  tabCli.classList.remove("active");
  formDir.style.display = "flex";
  formCli.style.display = "none";
});

tabCli?.addEventListener("click", () => {
  tabCli.classList.add("active");
  tabDir.classList.remove("active");
  formCli.style.display = "flex";
  formDir.style.display = "none";
});

// Dynamic path preview in Mode 1
const wizDirIdInput = $("#wiz-dir-id");
const wizDirPathPreview = $("#wiz-dir-path-preview");

wizDirIdInput?.addEventListener("input", (e) => {
  const id = e.target.value.trim() || "my-template";
  wizDirPathPreview.textContent = `.saqala/templates/${id}/`;
});

// Real-Time Command Variable Parser for Mode 2
const wizCliCmdInput = $("#wiz-cli-cmd");
const cliVarsContainer = $("#cli-vars-container");

function parseCommandVariables(cmd) {
  const regex = /\{\{([a-zA-Z0-9_]+)\}\}|__([a-zA-Z0-9_]+)__/g;
  const vars = new Set();
  let match;
  while ((match = regex.exec(cmd)) !== null) {
    const varName = match[1] || match[2];
    if (varName) vars.add(varName);
  }
  return Array.from(vars);
}

function renderWizardVariableConfigs(varNames) {
  if (!cliVarsContainer) return;
  cliVarsContainer.innerHTML = "";
  state.wizardVars = [];

  if (varNames.length === 0) return;

  const header = document.createElement("div");
  header.className = "drop-section-title";
  header.textContent = "Extracted Command Variables Configuration";
  cliVarsContainer.appendChild(header);

  varNames.forEach((name) => {
    const isProjectName = name === "name" || name === "NAME" || name === "__NAME__";
    const vObj = {
      name,
      label: isProjectName ? "Project Name" : name.charAt(0).toUpperCase() + name.slice(1),
      type: isProjectName ? "text" : "boolean",
      default: isProjectName ? "my-app" : false,
      choices: "",
      isProjectName,
    };
    state.wizardVars.push(vObj);

    const card = document.createElement("div");
    card.className = "var-config-card";
    card.innerHTML = `
      <div class="var-card-head">
        <span class="var-name-tag">{{${esc(name)}}}</span>
        <span class="var-type-badge">${isProjectName ? "Project Name" : "Variable"}</span>
      </div>
      <div class="var-card-inputs">
        <div class="form-group">
          <label>Variable Label</label>
          <input type="text" class="v-label" value="${esc(vObj.label)}" />
        </div>
        <div class="form-group">
          <label>Type</label>
          <select class="v-type" ${isProjectName ? "disabled" : ""}>
            <option value="boolean" ${vObj.type === "boolean" ? "selected" : ""}>Boolean (Checkbox Flag)</option>
            <option value="choice" ${vObj.type === "choice" ? "selected" : ""}>Choice List (Dropdown Select)</option>
            <option value="text" ${vObj.type === "text" ? "selected" : ""}>Text Input</option>
          </select>
        </div>
        <div class="form-group v-choices-wrap" style="display:none;">
          <label>Choices (Comma-separated)</label>
          <input type="text" class="v-choices" placeholder="e.g. vanilla, react, vue" />
        </div>
      </div>
    `;

    const typeSel = card.querySelector(".v-type");
    const labelInp = card.querySelector(".v-label");
    const choicesWrap = card.querySelector(".v-choices-wrap");
    const choicesInp = card.querySelector(".v-choices");

    labelInp.addEventListener("input", (e) => { vObj.label = e.target.value; });
    typeSel.addEventListener("change", (e) => {
      vObj.type = e.target.value;
      choicesWrap.style.display = vObj.type === "choice" ? "" : "none";
    });
    choicesInp.addEventListener("input", (e) => { vObj.choices = e.target.value; });

    cliVarsContainer.appendChild(card);
  });
}

if (wizCliCmdInput) {
  wizCliCmdInput.addEventListener("input", (e) => {
    const varNames = parseCommandVariables(e.target.value);
    renderWizardVariableConfigs(varNames);
  });
}

// Form Mode 1 Submission: Create Local Directory Template
if (formDir) {
  formDir.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#wiz-dir-name").value.trim();
    const id = $("#wiz-dir-id").value.trim();
    const tagline = $("#wiz-dir-desc").value.trim();

    if (!id) {
      toast("Template ID is required.", "error");
      return;
    }

    try {
      const res = await api("/api/templates/custom", {
        method: "POST",
        body: JSON.stringify({ id, name, tagline }),
      });
      toast(`Custom template created! Target Path: <code>${esc(res.template.path)}</code>`, "success", 6000);
      formDir.reset();
      await loadData();
      renderAdaptiveUI();
    } catch (err) {
      toast(esc(err.message), "error");
    }
  });
}

// Form Mode 2 Submission: Create CLI Command Script Generator with Variables & Run Command
if (formCli) {
  formCli.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#wiz-cli-name").value.trim();
    const id = $("#wiz-cli-id").value.trim();
    const command = $("#wiz-cli-cmd").value.trim();
    const runCommand = $("#wiz-cli-run-cmd").value.trim() || "npm run dev";
    const tagline = $("#wiz-cli-desc").value.trim();

    if (!id) {
      toast("Template ID is required.", "error");
      return;
    }

    try {
      await api("/api/generators", {
        method: "POST",
        body: JSON.stringify({
          id,
          templateId: id,
          name,
          command,
          runCommand,
          tagline,
          variables: state.wizardVars,
        }),
      });
      toast(`Script generator <code>${esc(name)}</code> saved!`, "success");
      formCli.reset();
      $("#cli-vars-container").innerHTML = "";
      await loadData();
      renderAdaptiveUI();
    } catch (err) {
      toast(esc(err.message), "error");
    }
  });
}

/* =============== Navigation & Back Buttons =============== */
document.querySelectorAll(".back-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    // close live log SSE if open
    if (state.logEventSource) {
      state.logEventSource.close();
      state.logEventSource = null;
    }
    renderAdaptiveUI();
  });
});

/* =============== Settings Button =============== */
const btnSettings = $("#btn-settings");
if (btnSettings) {
  btnSettings.addEventListener("click", () => openSettingsScreen());
}

/* =============== Initialization =============== */
loadData();

/* ============================================================
   PROJECT DETAIL SCREEN
   ============================================================ */
const EXT_ICON = {
  js:   { color: "#f7df1e", label: "JS" },
  ts:   { color: "#3178c6", label: "TS" },
  jsx:  { color: "#61dafb", label: "JSX" },
  tsx:  { color: "#3178c6", label: "TSX" },
  json: { color: "#a5b4c8", label: "{" },
  md:   { color: "#6b7280", label: "MD" },
  css:  { color: "#38bdf8", label: "CSS" },
  html: { color: "#f97316", label: "HTML" },
  env:  { color: "#10b981", label: "ENV" },
  svg:  { color: "#fb7185", label: "SVG" },
  png:  { color: "#a78bfa", label: "IMG" },
  jpg:  { color: "#a78bfa", label: "IMG" },
  sh:   { color: "#facc15", label: "SH" },
};

function fileExtIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const info = EXT_ICON[ext];
  if (!info) return `<svg class="tree-file-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#6b7280" stroke-width="1.2"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>`;
  return `<span class="tree-file-icon" style="font-size:0.62rem;font-weight:800;color:${info.color};letter-spacing:-0.02em;min-width:14px;text-align:center">${info.label}</span>`;
}

function renderFileTree(children, container, depth = 0) {
  container.innerHTML = "";
  for (const node of children) {
    const item = document.createElement("div");
    item.style.paddingLeft = `${depth * 14 + (depth > 0 ? 8 : 0)}px`;

    if (node.type === "dir") {
      item.className = "tree-item dir";
      item.innerHTML = `
        <svg class="tree-arrow" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 4l4 4-4 4"/>
        </svg>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="color:#f59e0b;flex-shrink:0">
          <path d="M1 4a1 1 0 0 1 1-1h4l1.5 1.5H14a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z"/>
        </svg>
        <span>${esc(node.name)}${node.skipped ? ' <em style="font-size:0.7rem;color:var(--text-muted)">(skipped)</em>' : ""}</span>
      `;
      const childWrap = document.createElement("div");
      childWrap.className = "tree-children";

      if (!node.skipped && node.children && node.children.length > 0) {
        renderFileTree(node.children, childWrap, depth + 1);
      }

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = childWrap.classList.toggle("open");
        item.classList.toggle("open", isOpen);
      });

      container.appendChild(item);
      container.appendChild(childWrap);
    } else {
      item.className = "tree-item";
      item.innerHTML = `
        <span style="width:12px;flex-shrink:0"></span>
        ${fileExtIcon(node.name)}
        <span>${esc(node.name)}</span>
        ${node.size ? `<span style="margin-left:auto;font-size:0.7rem;color:var(--text-muted);padding-right:0.5rem">${formatSize(node.size)}</span>` : ""}
      `;
      container.appendChild(item);
    }
  }

  if (children.length === 0) {
    container.innerHTML = `<div style="padding:0.75rem 1rem;font-size:0.82rem;color:var(--text-muted)">Empty folder</div>`;
  }
}

async function loadFileTree(projectName) {
  const treeEl = $("#file-tree");
  if (!treeEl) return;
  treeEl.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-size:0.82rem">Loading…</div>`;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/files`);
    const { tree } = await res.json();
    renderFileTree(tree || [], treeEl);
  } catch (err) {
    treeEl.innerHTML = `<div style="padding:1rem;color:#f87171;font-size:0.82rem">Failed to load file tree</div>`;
  }
}

/* ---- Live Log SSE ---- */
let currentLogProject = null;

function startLogStream(projectName) {
  if (state.logEventSource) state.logEventSource.close();
  const logEl = $("#project-log");
  const dotEl = $("#log-status-dot");
  const textEl = $("#log-status-text");
  if (!logEl) return;

  state.logEventSource = new EventSource(`/api/projects/${encodeURIComponent(projectName)}/log`);

  state.logEventSource.addEventListener("log", (e) => {
    const { log } = JSON.parse(e.data);
    if (log) {
      if (logEl.textContent === "No output yet. Run the project to see logs here.") logEl.textContent = "";
      logEl.textContent += log;
      logEl.scrollTop = logEl.scrollHeight;
    }
  });

  state.logEventSource.addEventListener("status", (e) => {
    const { running } = JSON.parse(e.data);
    if (dotEl) { dotEl.dataset.running = running; }
    if (textEl) textEl.textContent = running ? "Running" : "Stopped";
    const runBtn = $("#detail-run-btn");
    if (runBtn) {
      runBtn.innerHTML = running
        ? `<svg viewBox="0 0 24 24" width="13" height="13"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg><span>Stop</span>`
        : `<svg viewBox="0 0 24 24" width="13" height="13"><path d="M8 5v14l11-7z" fill="currentColor"/></svg><span>Run</span>`;
      runBtn.dataset.running = running ? "1" : "";
    }
  });

  state.logEventSource.onerror = () => {
    if (dotEl) dotEl.dataset.running = "false";
    if (textEl) textEl.textContent = "Stopped";
  };
}

/* ---- IDE Dropdown ---- */
async function loadIdeDropdown(projectName) {
  const dropdown = $("#ide-dropdown");
  if (!dropdown) return;

  const { settings } = await fetch("/api/settings").then((r) => r.json()).catch(() => ({ settings: { ides: [], defaultIde: "" } }));
  const ides = settings.ides || [];
  const defaultId = settings.defaultIde;

  dropdown.innerHTML = ides.length === 0
    ? `<div style="padding:0.75rem;font-size:0.82rem;color:var(--text-muted)">No IDEs configured.<br>Go to Settings to add one.</div>`
    : ides.map((ide) => `
      <button class="ide-drop-item${ide.id === defaultId ? " default-ide" : ""}" data-command="${esc(ide.command)}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9l3 3-3 3M13 15h3"/></svg>
        ${esc(ide.name)}
        ${ide.id === defaultId ? `<span style="font-size:0.68rem;background:var(--accent);color:#fff;border-radius:3px;padding:0.1rem 0.35rem;margin-left:auto">Default</span>` : `<span class="ide-cmd">${esc(ide.command)}</span>`}
      </button>
    `).join("");

  dropdown.querySelectorAll(".ide-drop-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      dropdown.hidden = true;
      const command = btn.dataset.command;
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/open-ide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command }),
        });
        if (!res.ok) {
          const { error } = await res.json();
          toast(error || "Failed to open IDE", "error");
        } else {
          toast(`Opening in IDE…`, "success");
        }
      } catch {
        toast("Failed to connect to server", "error");
      }
    });
  });
}

/* ---- Open Project Detail Screen ---- */
async function openProjectDetail(projectName) {
  currentLogProject = projectName;

  // Populate header
  const info = state.projects.find((p) => p.name === projectName) || { name: projectName };
  const nameEl = $("#detail-name");
  const badgeEl = $("#detail-badge");
  const langEl = $("#detail-lang");
  const iconEl = $("#detail-icon");
  if (nameEl) nameEl.textContent = info.name;
  if (badgeEl) badgeEl.textContent = info.template || "";
  if (langEl) { langEl.textContent = info.lang ? info.lang.toUpperCase() : ""; }
  if (iconEl) iconEl.innerHTML = `<span style="color:${info.color || '#10b981'};font-size:1.4rem">${BRAND_ICONS[info.icon || info.template || 'code'] || BRAND_ICONS.code}</span>`;

  // Reset log
  const logEl = $("#project-log");
  if (logEl) logEl.textContent = "No output yet. Run the project to see logs here.";
  const dotEl = $("#log-status-dot");
  if (dotEl) dotEl.dataset.running = "false";
  const textEl = $("#log-status-text");
  if (textEl) textEl.textContent = "Stopped";

  showScreen("project");

  // Load file tree + start log stream
  await loadFileTree(projectName);
  startLogStream(projectName);
  await loadIdeDropdown(projectName);

  // Refresh file tree button
  const refreshBtn = $("#detail-refresh");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.style.animation = "spin 0.5s linear";
      await loadFileTree(projectName);
      setTimeout(() => { refreshBtn.style.animation = ""; }, 600);
    };
  }

  // Run / Stop button
  const runBtn = $("#detail-run-btn");
  if (runBtn) {
    runBtn.onclick = async () => {
      const isRunning = runBtn.dataset.running === "1";
      try {
        if (isRunning) {
          await fetch(`/api/projects/${encodeURIComponent(projectName)}/stop`, { method: "POST" });
          toast("Project stopped", "info");
          if (logEl) logEl.textContent += "\n[Stopped]"
        } else {
          if (logEl) logEl.textContent = "Starting…\n";
          const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/run`, { method: "POST" });
          const data = await res.json();
          if (data.error) { toast(data.error, "error"); return; }
          startLogStream(projectName);
        }
      } catch { toast("Server error", "error"); }
    };
  }

  // IDE dropdown toggle
  const ideBtn = $("#detail-ide-btn");
  const ideDropdown = $("#ide-dropdown");
  if (ideBtn && ideDropdown) {
    ideBtn.onclick = (e) => {
      e.stopPropagation();
      ideDropdown.hidden = !ideDropdown.hidden;
      if (!ideDropdown.hidden) loadIdeDropdown(projectName);
    };
    document.addEventListener("click", () => { if (ideDropdown) ideDropdown.hidden = true; }, { once: false });
    ideDropdown.addEventListener("click", (e) => e.stopPropagation());
  }
}

/* ---- Make project cards clickable ---- */
function attachProjectCardClicks() {
  document.querySelectorAll(".project-card").forEach((card) => {
    if (card.dataset.clickAttached) return;
    card.dataset.clickAttached = "1";
    card.style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      // Don't trigger if clicking action buttons inside the card
      if (e.target.closest("button")) return;
      const name = card.dataset.name;
      if (name) openProjectDetail(name);
    });
  });
}

/* Patch renderProjects to attach clicks after render */
const _origRenderProjects = typeof renderProjects !== "undefined" ? renderProjects : null;

/* Hook into loadData to re-attach card clicks after re-render */
const _origLoadData = loadData;
window.loadData = async function patched_loadData() {
  await _origLoadData();
  setTimeout(attachProjectCardClicks, 100);
};

// Attach on boot too
addEventListener("DOMContentLoaded", () => setTimeout(attachProjectCardClicks, 300));
setTimeout(attachProjectCardClicks, 500);

/* ============================================================
   SETTINGS SCREEN
   ============================================================ */
let settingsData = { defaultIde: "", ides: [] };

async function openSettingsScreen() {
  showScreen("settings");
  await loadSettingsData();
  renderIdeList();
  renderDefaultIdeSelect();
}

async function loadSettingsData() {
  try {
    const res = await fetch("/api/settings");
    const { settings } = await res.json();
    settingsData = settings || { defaultIde: "", ides: [] };
  } catch { settingsData = { defaultIde: "", ides: [] }; }
}

async function saveSettingsData() {
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settingsData),
    });
  } catch { toast("Failed to save settings", "error"); }
}

function renderDefaultIdeSelect() {
  const sel = $("#default-ide-select");
  if (!sel) return;
  sel.innerHTML = settingsData.ides.map((ide) =>
    `<option value="${esc(ide.id)}"${ide.id === settingsData.defaultIde ? " selected" : ""}>${esc(ide.name)}</option>`
  ).join("");
  sel.onchange = async () => {
    settingsData.defaultIde = sel.value;
    await saveSettingsData();
    renderIdeList();
    toast("Default IDE updated", "success");
  };
}

function renderIdeList() {
  const listEl = $("#ide-list");
  if (!listEl) return;
  listEl.innerHTML = settingsData.ides.map((ide) => `
    <div class="ide-list-item" data-id="${esc(ide.id)}">
      <span class="ide-name">${esc(ide.name)}</span>
      <span class="ide-cmd-tag">${esc(ide.command)}</span>
      ${ide.id === settingsData.defaultIde ? `<span class="ide-default-badge">Default</span>` : `<button class="ide-set-default-btn" data-set-default="${esc(ide.id)}">Set Default</button>`}
      <button class="ide-delete-btn" data-delete-ide="${esc(ide.id)}" aria-label="Delete ${esc(ide.name)}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `).join("");

  listEl.querySelectorAll("[data-delete-ide]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.deleteIde;
      settingsData.ides = settingsData.ides.filter((i) => i.id !== id);
      if (settingsData.defaultIde === id) settingsData.defaultIde = settingsData.ides[0]?.id || "";
      await saveSettingsData();
      renderIdeList();
      renderDefaultIdeSelect();
      toast("IDE removed", "info");
    });
  });

  listEl.querySelectorAll("[data-set-default]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      settingsData.defaultIde = btn.dataset.setDefault;
      await saveSettingsData();
      renderIdeList();
      renderDefaultIdeSelect();
      toast("Default IDE set", "success");
    });
  });
}

/* Add IDE form */
const btnAddIde = $("#btn-add-ide");
if (btnAddIde) {
  btnAddIde.addEventListener("click", async () => {
    const nameInput = $("#new-ide-name");
    const cmdInput = $("#new-ide-command");
    const name = nameInput?.value.trim();
    const command = cmdInput?.value.trim();
    if (!name || !command) { toast("Enter both IDE name and command", "error"); return; }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (settingsData.ides.some((i) => i.id === id)) { toast("IDE with this name already exists", "error"); return; }
    settingsData.ides.push({ id, name, command });
    if (!settingsData.defaultIde) settingsData.defaultIde = id;
    await saveSettingsData();
    renderIdeList();
    renderDefaultIdeSelect();
    if (nameInput) nameInput.value = "";
    if (cmdInput) cmdInput.value = "";
    toast(`IDE "${esc(name)}" added`, "success");
  });
}

/* Settings back button */
const settingsBack = $("#settings-back");
if (settingsBack) {
  settingsBack.addEventListener("click", () => renderAdaptiveUI());
}

/* Spin animation for refresh */
const spinStyle = document.createElement("style");
spinStyle.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
document.head.appendChild(spinStyle);

