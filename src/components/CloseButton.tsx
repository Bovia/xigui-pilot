export default function CloseButton({
  onClick,
  className = "",
  size = "md",
}: {
  onClick: () => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-7 w-7 text-base" : "h-8 w-8 text-lg";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="关闭"
      title="关闭"
      className={`study-plan-tool-btn inline-flex shrink-0 items-center justify-center rounded-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600 ${box} ${className}`}
    >
      ×
    </button>
  );
}
