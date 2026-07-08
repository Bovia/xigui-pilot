#!/usr/bin/env bash
# 下班一键：防睡眠 + 批量生成字幕（M1 过夜）
set -euo pipefail

ROOT="${1:-$HOME/Desktop/系规}"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/subtitle-batch.log"
MODEL="${SUBTITLE_MODEL:-base}"

echo "=============================================="
echo "  系规助手 · 过夜字幕任务"
echo "  资料目录: $ROOT"
echo "  模型: $MODEL"
echo "  日志: $LOG"
echo "=============================================="
echo ""
echo "请确认：Mac 已插电，系统设置里「接电源时防止睡眠」已开启。"
echo "可以锁屏，但不要合盖休眠（或接电+允许合盖运行）。"
echo ""
echo "3 秒后开始…"
sleep 3

cd "$PROJECT"

# -d 防磁盘睡眠 -i 防 idle 睡眠 -m 防系统睡眠（接电源时）
exec caffeinate -dims python3 scripts/batch_generate_subtitles.py \
  --root "$ROOT" \
  --model "$MODEL" \
  --log "$LOG"
