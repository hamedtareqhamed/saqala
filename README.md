# ⚡ Saqala (سَقالة)

> **Modern Local Project Management Dashboard, Interactive Scaffold Center & CLI Script Hub**

Saqala is a lightweight, zero-dependency local dashboard and scaffolding tool that runs natively on **Windows**, **macOS**, and **Linux**. It provides visual scaffolding for modern web projects (Node.js, TypeScript, Vite, React, Express, Fastify, custom CLI generators), isolated project workspaces, real-time command output, interactive file tree exploration, and customizable IDE launching.

---

## 🚀 Quick Start with NPX

Run Saqala anywhere in your local workspace using `npx`:

```bash
npx saqala
```

Saqala will automatically open your local web interface at `http://localhost:8080`.

---

## ✨ Core Features

- 📁 **Isolated Project Directory (`./projects/`)**: Automatically stores all created projects in a clean, dedicated `projects/` subfolder.
- 🛡 **Security & Path Traversal Hardening**: Strict project name sanitization, path scoping, and parameter validation.
- 🌳 **Interactive File Tree**: Browse project files, sizes, and file types with syntax-specific badges directly inside the dashboard.
- ⚡ **Live Log Streaming**: Real-time process stdout/stderr output streaming via Server-Sent Events (SSE).
- 🚀 **Open in IDE**: Launch projects in your favorite code editor (VS Code, Cursor, Zed, Neovim, WebStorm, or custom commands).
- 🎨 **Dynamic Multi-Stack Variants**: Auto-discovers template sub-variants (`express`, `fastify`, `react`, etc.) dynamically.
- 🛠 **Custom CLI Script Hub**: Build and customize reusable CLI script generators with dynamic form fields.
- 💎 **Dark Emerald Glassmorphism Theme**: Premium, modern visual interface built with vanilla JS and CSS.

---

## 🛠 Project Structure

```
.
├── server.js          # HTTP server, routing, process runner & SSE
├── templates.js       # Dynamic template variant inspection & unzip logic
├── generators.js      # Saved custom generator manager
├── index.html         # Single Page App interface
├── styles.css         # Glassmorphic Dark Emerald design system
├── app.js             # Client application logic & UI state
├── templates/         # System ZIP template archives (node-js, node-ts)
└── projects/          # Dedicated local project workspace
```

---

## 📄 License

[GNU General Public License v3.0 (GPL-3.0)](LICENSE)
