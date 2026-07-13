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

# 菜单栏 App 不退出会继续跑旧二进制，重建后必须先杀掉
pkill -x xigui-pilot 2>/dev/null || true
sleep 0.3

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

echo "完成。请先确认菜单栏旧进程已退出，再双击桌面「系规助手」启动。"
