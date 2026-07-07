#!/usr/bin/env python3
"""Generate sidecar .srt next to a local mp4 using faster-whisper."""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path


def ensure_ffmpeg() -> None:
    try:
        import static_ffmpeg  # type: ignore

        static_ffmpeg.add_paths()
    except ImportError as exc:
        raise SystemExit(
            "缺少 static-ffmpeg，请先运行：python3 -m pip install static-ffmpeg faster-whisper"
        ) from exc


def extract_audio(video: Path, wav: Path, max_seconds: int | None) -> None:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(video),
    ]
    if max_seconds:
        cmd.extend(["-t", str(max_seconds)])
    cmd.extend(["-vn", "-ac", "1", "-ar", "16000", str(wav)])
    subprocess.run(cmd, check=True)


def format_ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(segments, out: Path) -> int:
    lines: list[str] = []
    for idx, seg in enumerate(segments, start=1):
        text = seg.text.strip()
        if not text:
            continue
        lines.append(str(idx))
        lines.append(f"{format_ts(seg.start)} --> {format_ts(seg.end)}")
        lines.append(text)
        lines.append("")
    out.write_text("\n".join(lines), encoding="utf-8")
    return len([1 for _ in segments])


def main() -> None:
    parser = argparse.ArgumentParser(description="为 mp4 生成同名 .srt 字幕")
    parser.add_argument("video", type=Path, help="视频文件路径")
    parser.add_argument(
        "--minutes",
        type=int,
        default=0,
        help="仅转写前 N 分钟（0=全片，预览可设 10）",
    )
    parser.add_argument(
        "--model",
        default="base",
        help="Whisper 模型：tiny/base/small/medium（默认 base）",
    )
    args = parser.parse_args()

    video = args.video.expanduser().resolve()
    if not video.is_file():
        raise SystemExit(f"视频不存在：{video}")

    out = video.with_suffix(".srt")
    max_seconds = args.minutes * 60 if args.minutes > 0 else None

    ensure_ffmpeg()

    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "缺少 faster-whisper，请先运行：python3 -m pip install faster-whisper static-ffmpeg"
        ) from exc

    print(f"视频：{video.name}")
    print(f"模型：{args.model}，范围：{'全片' if not max_seconds else f'前 {args.minutes} 分钟'}")
    print("提取音频…")

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        extract_audio(video, wav, max_seconds)

        print("转写中（首次会下载模型，请稍候）…")
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, _info = model.transcribe(
            str(wav),
            language="zh",
            vad_filter=True,
            beam_size=5,
        )
        segment_list = list(segments)
        count = write_srt(segment_list, out)

    print(f"完成：{out}")
    print(f"共 {count} 条字幕。用 pnpm dev:app 播放第 1 节即可预览悬浮字幕。")


if __name__ == "__main__":
    main()
