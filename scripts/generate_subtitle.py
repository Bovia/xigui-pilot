#!/usr/bin/env python3
"""Generate sidecar .srt next to a local mp4 using faster-whisper."""

from __future__ import annotations

import argparse
import re
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


def transcribe_video(
    video: Path,
    model: object,
    max_seconds: int | None = None,
) -> int:
    out = video.with_suffix(".srt")
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        extract_audio(video, wav, max_seconds)
        segments, _info = model.transcribe(  # type: ignore[union-attr]
            str(wav),
            language="zh",
            vad_filter=True,
            beam_size=5,
        )
        segment_list = list(segments)
        return write_srt(segment_list, out)


def parse_timestamp(raw: str) -> float:
    normalized = raw.strip().replace(",", ".")
    parts = normalized.split(":")
    if len(parts) == 3:
        h, m, s = parts
        return float(h) * 3600 + float(m) * 60 + float(s)
    if len(parts) == 2:
        m, s = parts
        return float(m) * 60 + float(s)
    return float(normalized) or 0.0


def parse_timestamp_line(line: str) -> dict[str, float] | None:
    match = re.match(
        r"(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}|\d{1,2}:\d{2}(?::\d{2})?)\s*-->\s*"
        r"(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}|\d{1,2}:\d{2}(?::\d{2})?)",
        line.strip(),
    )
    if not match:
        return None
    return {
        "start": parse_timestamp(match.group(1)),
        "end": parse_timestamp(match.group(2)),
    }


def srt_last_end_seconds(srt_path: Path) -> float | None:
    if not srt_path.is_file():
        return None
    last_end = 0.0
    for line in srt_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        times = parse_timestamp_line(line)
        if times:
            last_end = max(last_end, times["end"])
    return last_end if last_end > 0 else None


def video_duration_seconds(video: Path) -> float | None:
    ensure_ffmpeg()
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(video),
            ],
            text=True,
        ).strip()
        return float(out)
    except (subprocess.CalledProcessError, ValueError):
        return None


def srt_covers_video(video: Path, min_ratio: float = 0.85) -> bool:
    srt = video.with_suffix(".srt")
    if not srt.is_file():
        return False
    duration = video_duration_seconds(video)
    last_end = srt_last_end_seconds(srt)
    if duration is None or last_end is None:
        return srt.stat().st_size > 50_000
    return last_end >= duration * min_ratio


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
    print("转写中（首次会下载模型，请稍候）…")
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    count = transcribe_video(video, model, max_seconds)

    print(f"完成：{out}")
    print(f"共 {count} 条字幕。用 pnpm dev:app 播放第 1 节即可预览悬浮字幕。")


if __name__ == "__main__":
    main()
