#!/usr/bin/env python3
"""批量为资料目录下的 mp4 生成 sidecar .srt（M1 过夜任务）。"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from generate_subtitle import (  # noqa: E402
    ensure_ffmpeg,
    srt_covers_video,
    transcribe_video,
)


def log(msg: str, log_file: Path | None) -> None:
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    if log_file:
        with log_file.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def collect_videos(root: Path, folders: list[str]) -> list[Path]:
    videos: list[Path] = []
    for name in folders:
        folder = root / name
        if not folder.is_dir():
            continue
        videos.extend(sorted(folder.glob("*.mp4")))
    return videos


def main() -> None:
    parser = argparse.ArgumentParser(description="批量生成视频字幕（过夜队列）")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.home() / "Desktop" / "系规",
        help="资料根目录（默认 ~/Desktop/系规）",
    )
    parser.add_argument(
        "--model",
        default="base",
        help="Whisper 模型（M1 建议 base）",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="已有完整 .srt 也重新生成",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="最多处理 N 个（0=全部）",
    )
    parser.add_argument(
        "--log",
        type=Path,
        default=None,
        help="日志文件路径",
    )
    args = parser.parse_args()

    root = args.root.expanduser().resolve()
    log_path = args.log or (root / "subtitle-batch.log")

    folders = [
        "01：基础课视频（已完结）",
        "02：案例、论文专题（26.10录播课）",
        "03：直播课（陆续更新上传）",
    ]

    videos = collect_videos(root, folders)
    if args.limit > 0:
        videos = videos[: args.limit]

    if not videos:
        raise SystemExit(f"未在 {root} 找到 mp4")

    pending: list[Path] = []
    for video in videos:
        if args.force or not srt_covers_video(video):
            pending.append(video)

    log_path.write_text("", encoding="utf-8")
    log(f"资料目录：{root}", log_path)
    log(f"共 {len(videos)} 个 mp4，待生成 {len(pending)} 个，模型 {args.model}", log_path)

    if not pending:
        log("全部已有完整字幕，无需处理。", log_path)
        return

    ensure_ffmpeg()
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "请先安装：python3 -m pip install faster-whisper static-ffmpeg"
        ) from exc

    log("加载 Whisper 模型（仅一次）…", log_path)
    model = WhisperModel(args.model, device="cpu", compute_type="int8")

    done = 0
    failed: list[str] = []
    t0 = time.time()

    for i, video in enumerate(pending, start=1):
        log(f"[{i}/{len(pending)}] 开始：{video.name}", log_path)
        started = time.time()
        try:
            count = transcribe_video(video, model, max_seconds=None)
            elapsed = time.time() - started
            done += 1
            log(f"  ✓ 完成（{count} 条，{elapsed / 60:.1f} 分钟）", log_path)
        except Exception as e:
            failed.append(video.name)
            log(f"  ✗ 失败：{e}", log_path)

    total_min = (time.time() - t0) / 60
    log(f"结束：成功 {done}，失败 {len(failed)}，总耗时 {total_min:.1f} 分钟", log_path)
    if failed:
        log("失败列表：" + ", ".join(failed), log_path)


if __name__ == "__main__":
    main()
