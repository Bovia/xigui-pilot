import { useEffect, useMemo, useState } from "react";

type Slide = { prefix: string; text: string };

export default function ProgressHintMarquee({
  stageText,
  todayText,
  wenText,
}: {
  stageText: string;
  todayText: string;
  wenText: string;
}) {
  const slides = useMemo<Slide[]>(
    () => [
      { prefix: "阶段", text: stageText || "—" },
      { prefix: "今日", text: todayText || "—" },
      { prefix: "文老师", text: wenText || "—" },
    ],
    [stageText, todayText, wenText],
  );

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [slides]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [slides.length]);

  const lineHeight = 20;

  return (
    <div
      className="progress-hint-marquee mt-2 overflow-hidden"
      style={{ height: lineHeight }}
      aria-live="polite"
    >
      <div
        className="progress-hint-track transition-transform duration-700 ease-in-out"
        style={{ transform: `translateY(-${index * lineHeight}px)` }}
      >
        {slides.map((slide) => (
          <div
            key={slide.prefix}
            className="progress-hint-line truncate text-xs leading-5 text-slate-500"
            style={{ height: lineHeight }}
            title={`${slide.prefix}：${slide.text}`}
          >
            <span className="font-medium text-slate-600">{slide.prefix}：</span>
            {slide.text}
          </div>
        ))}
      </div>
    </div>
  );
}
