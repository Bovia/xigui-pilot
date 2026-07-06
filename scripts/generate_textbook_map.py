#!/usr/bin/env python3
"""Generate public/textbook.json: lessonNo -> PDF page from official textbook bookmarks."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "public/plan.json"
OUT = ROOT / "public/textbook.json"
PDF = (
    Path.home()
    / "Desktop/系规/03：官方教材/【带书签可搜索】系统规划与管理师（第2版）.pdf"
)

TEXTBOOK_SUBDIR = "03：官方教材"
TEXTBOOK_FILENAME = "【带书签可搜索】系统规划与管理师（第2版）.pdf"


def build_section_pages(reader) -> dict[str, int]:
    section_pages: dict[str, int] = {}

    def walk(items):
        for item in items:
            if isinstance(item, list):
                walk(item)
                continue
            title = item.title.strip()
            page = reader.get_destination_page_number(item) + 1
            normalized = title.replace(" ", "")
            m = re.match(r"^(\d+\.\d+(?:\.\d+)?)", normalized)
            if m:
                key = m.group(1)
                if key not in section_pages or page < section_pages[key]:
                    section_pages[key] = page
            cm = re.search(r"第(\d+)章", title)
            if cm:
                chapter_key = f"ch{cm.group(1)}"
                if chapter_key not in section_pages or page < section_pages[chapter_key]:
                    section_pages[chapter_key] = page

    walk(reader.outline)
    return section_pages


def page_for_title(title: str, section_pages: dict[str, int]) -> int | None:
    m = re.match(r"^(\d+\.\d+)", title.replace(" ", ""))
    if not m:
        return None
    parts = m.group(1).split(".")
    for i in range(len(parts), 0, -1):
        candidate = ".".join(parts[:i])
        if candidate in section_pages:
            return section_pages[candidate]
    return section_pages.get(f"ch{parts[0]}")


def main() -> None:
    from pypdf import PdfReader

    if not PDF.exists():
        raise SystemExit(f"PDF not found: {PDF}")
    if not PLAN.exists():
        raise SystemExit(f"plan.json not found: {PLAN}")

    plan = json.loads(PLAN.read_text())
    reader = PdfReader(str(PDF))
    section_pages = build_section_pages(reader)

    lessons: dict[str, dict[str, int]] = {}
    for no_str, lesson in plan["lessons"].items():
        page = page_for_title(lesson["title"], section_pages)
        if page:
            lessons[no_str] = {"page": page}

    out = {
        "textbookSubdir": TEXTBOOK_SUBDIR,
        "textbookFilename": TEXTBOOK_FILENAME,
        "lessons": lessons,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {OUT} ({len(lessons)}/{len(plan['lessons'])} lessons mapped)")


if __name__ == "__main__":
    main()
