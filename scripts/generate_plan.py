#!/usr/bin/env python3
"""Generate public/plan.json from local video folders + 16-week schedule."""

from __future__ import annotations

import json
import platform
import re
import subprocess
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATERIAL_ROOT = Path.home() / "Desktop/系规"
OUT = ROOT / "public/plan.json"

VIDEO_SOURCES = [
    {
        "subdir": "01：基础课视频（已完结）",
        "category": "basic",
        "mode": "filename",
    },
    {
        "subdir": "02：案例、论文专题（26.10录播课）",
        "category": "special",
        "mode": "sequential",
        "startNo": 901,
    },
]

WEEKS = [
    ("W1", "导学", "输入期", date(2026, 7, 7), date(2026, 7, 13), [1, 2]),
    ("W2", "基础", "输入期", date(2026, 7, 14), date(2026, 7, 20), list(range(3, 11))),
    ("W3", "基础", "输入期", date(2026, 7, 21), date(2026, 7, 27), list(range(11, 14))),
    ("W4", "基础", "输入期", date(2026, 7, 28), date(2026, 8, 3), list(range(14, 22))),
    ("W5", "规划", "输入期", date(2026, 8, 4), date(2026, 8, 10), list(range(22, 30))),
    ("W6", "规划", "输入期", date(2026, 8, 11), date(2026, 8, 17), list(range(30, 38))),
    ("W7", "规划", "输入期", date(2026, 8, 18), date(2026, 8, 24), list(range(38, 43))),
    ("W8", "管理", "核心期", date(2026, 8, 25), date(2026, 8, 31), list(range(43, 49))),
    ("W9", "管理", "核心期", date(2026, 9, 1), date(2026, 9, 7), list(range(49, 52))),
    ("W10", "管理", "巩固期", date(2026, 9, 8), date(2026, 9, 14), list(range(52, 70))),
    ("W11", "专项", "巩固期", date(2026, 9, 15), date(2026, 9, 21), list(range(70, 76))),
    ("W12", "专项", "巩固期", date(2026, 9, 22), date(2026, 9, 28), list(range(76, 84))),
    ("W13", "专题", "输出期", date(2026, 9, 29), date(2026, 10, 5), [903, 904, 905]),
    ("W14", "专题", "输出期", date(2026, 10, 6), date(2026, 10, 12), [901, 902]),
    ("W15", "冲刺", "冲刺期", date(2026, 10, 13), date(2026, 10, 19), []),
    ("W16", "冲刺", "冲刺期", date(2026, 10, 20), date(2026, 10, 23), []),
]

WEEK_FOCUS = {
    "W1": "考试认知+教材导读+备考规划",
    "W2": "第1章 信息系统与信息技术发展",
    "W3": "第2章 数字中国与数智化发展",
    "W4": "第3-4章 系统方法论+信息系统规划",
    "W5": "第5-6章 应用系统规划+云资源规划",
    "W6": "第7-8章 网络环境规划+数据资源规划",
    "W7": "第9-10章 信息安全规划+云原生系统规划",
    "W8": "第11-12章 IT治理+IT服务管理（上）",
    "W9": "第12章 IT服务管理（下）★核心",
    "W10": "第13-17章 人员/规范/技术/工具/项目管理",
    "W11": "第18-20章 智慧城市/园区/数字乡村",
    "W12": "第21-24章 企业转型/智能制造/消费/法规",
    "W13": "论文写作规则+IT服务论文素材准备",
    "W14": "案例专题+综合知识串讲+一模",
    "W15": "综合题刷题+二模+错题复盘",
    "W16": "考前串讲+查缺补漏+调整状态",
}


def probe_duration(path: Path) -> int:
    if not path.is_file():
        return 0
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
                str(path),
            ],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        return max(0, int(float(out)))
    except (OSError, subprocess.CalledProcessError, ValueError):
        pass
    if platform.system() == "Darwin":
        try:
            out = subprocess.check_output(
                ["mdls", "-name", "kMDItemDurationSeconds", "-raw", str(path)],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            if out and out != "(null)":
                return max(0, int(float(out)))
        except (OSError, subprocess.CalledProcessError, ValueError):
            pass
    return 0


def lesson_meta(path: Path, no: int, category: str, video_subdir: str) -> dict:
    incomplete = path.name.endswith(".baiduyun.p.downloading")
    ext = path.suffix.lower()
    title = re.sub(r"^\[\d+\]--?", "", path.name)
    title = re.sub(r"\.(mp4|mkv)(\.baiduyun\.p\.downloading)?$", "", title, flags=re.I)
    title = title.strip()
    duration_sec = 0
    if not incomplete and path.is_file():
        duration_sec = probe_duration(path)
    return {
        "no": no,
        "title": title,
        "filename": path.name,
        "ext": ext,
        "category": category,
        "videoSubdir": video_subdir,
        "playable": not incomplete and ext in {".mp4", ".mkv"},
        "builtinPlayable": not incomplete and ext == ".mp4",
        "missing": incomplete,
        "durationSec": duration_sec,
    }


def scan_source(source: dict, material_root: Path) -> dict[int, dict]:
    video_dir = material_root / source["subdir"]
    lessons: dict[int, dict] = {}
    if not video_dir.exists():
        return lessons

    paths = sorted(
        p
        for p in video_dir.iterdir()
        if p.is_file() and not p.name.startswith(".")
    )

    if source["mode"] == "filename":
        for path in paths:
            m = re.match(r"\[(\d+)\]", path.name)
            if not m:
                continue
            no = int(m.group(1))
            lessons[no] = lesson_meta(path, no, source["category"], source["subdir"])
        return lessons

    next_no = int(source["startNo"])
    for path in paths:
        if not re.match(r"\[\d+\]", path.name):
            continue
        lessons[next_no] = lesson_meta(path, next_no, source["category"], source["subdir"])
        next_no += 1
    return lessons


def scan_all_videos(material_root: Path) -> dict[int, dict]:
    lessons: dict[int, dict] = {}
    for source in VIDEO_SOURCES:
        for no, meta in scan_source(source, material_root).items():
            if no in lessons:
                raise SystemExit(
                    f"Duplicate lesson number {no}: "
                    f"{lessons[no]['videoSubdir']} vs {meta['videoSubdir']}"
                )
            lessons[no] = meta
    return lessons


def week_dates(start: date, end: date) -> list[date]:
    days: list[date] = []
    cur = start
    while cur <= end:
        days.append(cur)
        cur += timedelta(days=1)
    return days


def distribute(lesson_nos: list[int], days: list[date]) -> dict[str, list[int]]:
    if not lesson_nos:
        return {}
    buckets: dict[str, list[int]] = {d.isoformat(): [] for d in days}
    day_keys = list(buckets.keys())
    for i, no in enumerate(lesson_nos):
        buckets[day_keys[i % len(day_keys)]].append(no)
    return buckets


def main() -> None:
    lessons = scan_all_videos(MATERIAL_ROOT)
    weeks_out = []

    for wid, stage, phase, start, end, lesson_nos in WEEKS:
        days = week_dates(start, end)
        schedule = distribute(lesson_nos, days)
        tasks = []
        for day in days:
            for no in schedule.get(day.isoformat(), []):
                meta = lessons.get(no, {"no": no, "title": f"第{no}节", "missing": True})
                tasks.append(
                    {
                        "id": f"{wid.lower()}-{no:02d}",
                        "type": "video",
                        "lessonNo": no,
                        "title": meta.get("title", f"第{no}节"),
                        "scheduledDate": day.isoformat(),
                        "missing": meta.get("missing", no not in lessons),
                    }
                )
        weeks_out.append(
            {
                "id": wid,
                "stage": stage,
                "phase": phase,
                "focus": WEEK_FOCUS[wid],
                "start": start.isoformat(),
                "end": end.isoformat(),
                "tasks": tasks,
            }
        )

    plan = {
        "version": 2,
        "examDate": "2026-10-24",
        "startDate": "2026-07-07",
        "videoSubdir": VIDEO_SOURCES[0]["subdir"],
        "videoSources": VIDEO_SOURCES,
        "lessons": {str(k): v for k, v in sorted(lessons.items())},
        "weeks": weeks_out,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    basic = sum(1 for m in lessons.values() if m.get("category") == "basic")
    special = sum(1 for m in lessons.values() if m.get("category") == "special")
    missing = [no for no, m in lessons.items() if m.get("missing")]
    print(
        f"Wrote {OUT} ({len(lessons)} lessons: {basic} basic + {special} special, "
        f"{len(missing)} incomplete downloads)"
    )


if __name__ == "__main__":
    main()
