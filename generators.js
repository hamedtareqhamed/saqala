"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_GENERATORS = [
  {
    id: "vite",
    name: "Vite App",
    icon: "vite",
    color: "#8b93ff",
    tagline: "Ultra-fast frontend dev server for modern web projects.",
    command: "npm create vite@latest {{name}} -- --template {{templateFlag}}",
    runCommand: "npm run dev",
    supportsLang: true,
    variables: [
      { name: "name", label: "Project Name", type: "text", default: "my-vite-app", isProjectName: true },
      { name: "templateFlag", label: "Template Type", type: "choice", choices: ["vanilla", "vanilla-ts", "react", "react-ts"], default: "vanilla" }
    ],
    isSystem: true
  },
  {
    id: "react",
    name: "React App",
    icon: "react",
    color: "#61dafb",
    tagline: "Clean React application built with Vite and modern setup.",
    command: "npm create vite@latest {{name}} -- --template {{templateFlag}}",
    runCommand: "npm run dev",
    supportsLang: true,
    variables: [
      { name: "name", label: "Project Name", type: "text", default: "my-react-app", isProjectName: true },
      { name: "templateFlag", label: "React Variant", type: "choice", choices: ["react", "react-ts"], default: "react" }
    ],
    isSystem: true
  }
];

function getGeneratorsFilePath(workspaceDir) {
  return path.join(workspaceDir, ".saqala", "generators.json");
}

function loadGenerators(workspaceDir) {
  const customFile = getGeneratorsFilePath(workspaceDir);
  let customGenerators = [];
  if (fs.existsSync(customFile)) {
    try {
      customGenerators = JSON.parse(fs.readFileSync(customFile, "utf8"));
    } catch {
      customGenerators = [];
    }
  }
  return [...DEFAULT_GENERATORS, ...customGenerators];
}

function saveCustomGenerator(workspaceDir, generator) {
  const dir = path.join(workspaceDir, ".saqala");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const customFile = getGeneratorsFilePath(workspaceDir);
  let customGenerators = [];
  if (fs.existsSync(customFile)) {
    try {
      customGenerators = JSON.parse(fs.readFileSync(customFile, "utf8"));
    } catch {
      customGenerators = [];
    }
  }

  const rawId = (generator.id || generator.templateId || "gen-" + Date.now()).toLowerCase().trim();
  const id = rawId.replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || ("gen-" + Date.now());
  const newGen = {
    id,
    templateId: id,
    name: generator.name || "Custom Generator",
    icon: generator.icon || "node",
    color: generator.color || "#10b981",
    tagline: generator.tagline || "User-defined custom script generator",
    command: generator.command,
    runCommand: generator.runCommand || "npm run dev",
    variables: generator.variables || [],
    supportsLang: !!generator.supportsLang,
    isSystem: false,
    createdAt: Date.now()
  };

  const existingIndex = customGenerators.findIndex((g) => g.id === id);
  if (existingIndex >= 0) {
    customGenerators[existingIndex] = newGen;
  } else {
    customGenerators.push(newGen);
  }

  fs.writeFileSync(customFile, JSON.stringify(customGenerators, null, 2), "utf8");
  return newGen;
}

module.exports = {
  DEFAULT_GENERATORS,
  loadGenerators,
  saveCustomGenerator
};
