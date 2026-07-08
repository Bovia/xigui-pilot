import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lessonChapterNo } from "../lib/lessonChapter";

export default function BookTooltip({
  lessonTitle,
  textbookPage,
  onTextbook,
  onTricolorNotes,
}: {
  lessonTitle: string;
  textbookPage?: number;
  onTextbook: () => void;
  onTricolorNotes: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const chapter = lessonChapterNo(lessonTitle);
  const isIntroLesson = /^0/.test(lessonTitle.replace(/\s/g, ""));

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    const placeBelow = rect.top < 72;

    if (placeBelow) {
      setStyle({
        position: "fixed",
        top: rect.bottom + gap,
        left: rect.right,
        transform: "translateX(-100%)",
        zIndex: 9999,
      });
    } else {
      setStyle({
        position: "fixed",
        top: rect.top - gap,
        left: rect.right,
        transform: "translate(-100%, -100%)",
        zIndex: 9999,
      });
    }
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const toggle = () => {
    if (!open) updatePosition();
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  return (
    <>
      <div ref={anchorRef} className="relative">
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`woven-btn-tag flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-medium hover:bg-amber-100 ${
            open
              ? "border-amber-300 bg-amber-100 text-amber-800"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          书
        </button>
      </div>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={style}
            className="book-tooltip w-max min-w-[148px] max-w-[168px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onTextbook();
              }}
              className="w-full px-2.5 py-2 text-left hover:bg-slate-50"
            >
              <div className="text-[11px] font-medium leading-4 text-slate-800">官方教材</div>
              {textbookPage ? (
                <div className="mt-0.5 text-[10px] leading-4 text-slate-500">
                  打开第 {textbookPage} 页
                </div>
              ) : (
                <div className="mt-0.5 text-[10px] leading-4 text-slate-500">打开教材</div>
              )}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={chapter === null}
              onClick={() => {
                if (chapter === null) return;
                close();
                onTricolorNotes();
              }}
              className="w-full border-t border-slate-100 px-2.5 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <div className="text-[11px] font-medium leading-4 text-slate-800">三色笔记</div>
              {chapter !== null ? (
                <div className="mt-0.5 text-[10px] leading-4 text-slate-500">
                  打开第 {chapter} 章
                </div>
              ) : (
                <div className="mt-0.5 text-[10px] leading-4 text-slate-400">
                  {isIntroLesson ? "导学课暂无章节笔记" : "暂无对应章节"}
                </div>
              )}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
