#!/usr/bin/env node
import { spawn } from "child_process";
import { watch } from "chokidar";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const WATCH_PATHS = [
  "src/**/*",
  "src-tauri/src/**/*",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "index.html",
  "vite.config.ts",
  "package.json",
];

const IGNORED = [
  "**/node_modules/**",
  "**/target/**",
  "**/dist/**",
  "**/.git/**",
  "**/scripts/__pycache__/**",
];

let buildTimer = null;
let building = false;
let pending = false;

function log(...args) {
  console.log(`[watch:app]`, ...args);
}

function runBuild() {
  if (building) {
    pending = true;
    return;
  }

  building = true;
  pending = false;
  log(`检测到改动，开始打包 · ${new Date().toLocaleTimeString()}`);

  const child = spawn("pnpm", ["package:app"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });

  child.on("close", (code) => {
    building = false;
    if (code !== 0) {
      log(`打包失败，退出码 ${code}`);
    } else {
      log(`打包完成 · ${new Date().toLocaleTimeString()}`);
    }

    if (pending) {
      log("打包期间又有改动，继续下一轮");
      setTimeout(runBuild, 500);
    }
  });
}

function triggerBuild() {
  if (buildTimer) clearTimeout(buildTimer);
  buildTimer = setTimeout(() => {
    buildTimer = null;
    runBuild();
  }, 2000);
}

const watcher = watch(WATCH_PATHS, {
  cwd: ROOT,
  ignored: IGNORED,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
});

watcher.on("all", (event, filePath) => {
  log(`${event}: ${filePath}`);
  triggerBuild();
});

watcher.on("ready", () => {
  log("开始监听，改动后 2 秒自动执行 pnpm package:app");
});

watcher.on("error", (error) => {
  log("监听出错", error);
});

process.on("SIGINT", () => {
  log("停止监听");
  watcher.close().then(() => process.exit(0));
});
