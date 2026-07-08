#!/usr/bin/env bash
set -euo pipefail

# Agent 沙箱/非交互 shell 常缺 cargo PATH，自动加载 rustup
if ! command -v cargo >/dev/null 2>&1 && [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/src-tauri/target/release/bundle/macos/系规助手.app"
DESKTOP="$HOME/Desktop/系规助手"

cd "$ROOT"
CARGO_TARGET_DIR="$ROOT/src-tauri/target" pnpm tauri build

if [[ ! -d "$APP" ]]; then
  echo "未找到：$APP" >&2
  exit 1
fi

if [[ ! -e "$DESKTOP" ]]; then
  osascript -e "tell application \"Finder\" to make alias file to POSIX file \"$APP\" at desktop"
  echo "已在桌面创建快捷方式：$DESKTOP"
else
  echo "桌面快捷方式已存在，App 已更新：$APP"
fi

echo "完成。双击桌面「系规助手」即可启动。"
