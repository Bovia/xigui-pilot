import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function Tooltip({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});

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

  const show = () => {
    updatePosition();
    setOpen(true);
  };

  const hide = () => setOpen(false);

  return (
    <>
      <div
        ref={anchorRef}
        className="relative"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {children}
      </div>
      {open &&
        createPortal(
          <div
            role="tooltip"
            style={style}
            className="pointer-events-none w-max max-w-[168px] rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-lg"
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <div className="text-[11px] font-medium leading-4 text-slate-800">{label}</div>
            {detail && (
              <div className="mt-0.5 text-[10px] leading-4 text-slate-500">{detail}</div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
