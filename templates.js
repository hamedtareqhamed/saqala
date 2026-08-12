"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

function getCustomTemplatesDir(workspaceDir) {
  return path.join(workspaceDir, ".saqala", "templates");
}

function inspectTemplateVariants(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const validEntries = entries.filter((e) => !e.name.startsWith(".") && e.name !== "template.json");
    const subdirs = validEntries.filter((e) => e.isDirectory());

    if (subdirs.length > 0 && subdirs.length === validEntries.length) {
      return {
        hasVariants: true,
        variants: subdirs.map((s) => s.name),
      };
    }
  } catch { /* empty */ }

  return {
    hasVariants: false,
    variants: [],
  };
}

function listCustomTemplates(workspaceDir) {
  const dir = getCustomTemplatesDir(workspaceDir);
  if (!fs.existsSync(dir)) return [];
  const list = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const tplDir = path.join(dir, entry.name);
      const metaPath = path.join(tplDir, "template.json");
      let meta = {};
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        } catch { /* empty */ }
      }

      const variantInfo = inspectTemplateVariants(tplDir);

      list.push({
        key: "custom-" + entry.name,
        id: entry.name,
        name: meta.name || entry.name,
        icon: meta.icon || (variantInfo.hasVariants ? "node" : "folder"),
        color: meta.color || "#10b981",
        tagline: meta.tagline || (variantInfo.hasVariants ? `Dynamic template with ${variantInfo.variants.join(", ")} variants` : "Custom user template"),
        chips: meta.chips || (variantInfo.hasVariants ? variantInfo.variants : ["custom"]),
        defaultName: entry.name + "-app",
        type: "custom",
        path: tplDir,
        hasVariants: variantInfo.hasVariants,
        variants: variantInfo.variants,
      });
    }
  }
  return list;
}

function createCustomTemplate(workspaceDir, { id, name, tagline, color, icon }) {
  const cleanId = String(id || name || "custom-" + Date.now())
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  const targetDir = path.join(getCustomTemplatesDir(workspaceDir), cleanId);

  if (fs.existsSync(targetDir)) {
    throw Object.assign(new Error("Template with this ID already exists"), { code: "EXISTS" });
  }

  // Create template folder structure with default js and ts subfolders
  const jsDir = path.join(targetDir, "js");
  const tsDir = path.join(targetDir, "ts");
  fs.mkdirSync(jsDir, { recursive: true });
  fs.mkdirSync(tsDir, { recursive: true });

  const meta = {
    id: cleanId,
    name: name || cleanId,
    tagline: tagline || "Custom template created via Saqala GUI",
    color: color || "#10b981",
    icon: icon || "folder",
    createdAt: Date.now()
  };
  fs.writeFileSync(path.join(targetDir, "template.json"), JSON.stringify(meta, null, 2), "utf8");

  // Sample files in js variant
  fs.writeFileSync(
    path.join(jsDir, "index.js"),
    "// Custom JS Template Main File\nconsole.log('Hello from __NAME__ (JavaScript)!');\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(jsDir, "README.md"),
    "# __NAME__\n\nJavaScript project created from " + (name || cleanId) + ".\n",
    "utf8"
  );

  // Sample files in ts variant
  fs.writeFileSync(
    path.join(tsDir, "index.ts"),
    "// Custom TS Template Main File\nconst appName: string = '__NAME__';\nconsole.log(`Hello from ${appName} (TypeScript)!`);\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(tsDir, "README.md"),
    "# __NAME__\n\nTypeScript project created from " + (name || cleanId) + ".\n",
    "utf8"
  );

  const variantInfo = inspectTemplateVariants(targetDir);

  return {
    key: "custom-" + cleanId,
    id: cleanId,
    ...meta,
    path: targetDir,
    hasVariants: variantInfo.hasVariants,
    variants: variantInfo.variants,
  };
}

function extractZipTemplate(zipFilePath, targetDir, name, callback) {
  fs.mkdirSync(targetDir, { recursive: true });
  execFile("unzip", ["-o", zipFilePath, "-d", targetDir], (err) => {
    if (err) return callback(err);
    replacePlaceholdersInDir(targetDir, name);
    callback(null);
  });
}

function copyCustomTemplateFiles(srcDir, targetDir, name, selectedVariant) {
  fs.mkdirSync(targetDir, { recursive: true });
  
  const vInfo = inspectTemplateVariants(srcDir);
  let effectiveSrc = srcDir;
  
  if (vInfo.hasVariants) {
    const isSafeVariant = selectedVariant &&
      typeof selectedVariant === "string" &&
      !selectedVariant.includes("..") &&
      !selectedVariant.includes("/") &&
      !selectedVariant.includes("\\");
    const chosen = (isSafeVariant && fs.existsSync(path.join(srcDir, selectedVariant)))
      ? selectedVariant
      : vInfo.variants[0];
    effectiveSrc = path.join(srcDir, chosen);
  }

  copyFolderRecursive(effectiveSrc, targetDir);

  const targetMeta = path.join(targetDir, "template.json");
  if (fs.existsSync(targetMeta)) fs.unlinkSync(targetMeta);
  replacePlaceholdersInDir(targetDir, name);
}

function copyFolderRecursive(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyFolderRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function replacePlaceholdersInDir(dir, projectName) {
  const textExtensions = new Set([
    ".js", ".ts", ".jsx", ".tsx", ".json", ".md", ".txt", ".html", ".css", ".env", ".gitignore", ".yml", ".yaml"
  ]);

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (textExtensions.has(ext) || entry.name === ".gitignore" || entry.name === ".env") {
          try {
            let content = fs.readFileSync(fullPath, "utf8");
            content = content.replaceAll("__NAME__", projectName).replaceAll("{{name}}", projectName);
            fs.writeFileSync(fullPath, content, "utf8");
          } catch { /* binary or unreadable */ }
        }
      }
    }
  }

  walk(dir);
}

module.exports = {
  getCustomTemplatesDir,
  listCustomTemplates,
  createCustomTemplate,
  extractZipTemplate,
  copyCustomTemplateFiles,
  inspectTemplateVariants,
};
