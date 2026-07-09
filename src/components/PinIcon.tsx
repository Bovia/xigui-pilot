export default function PinIcon({
  pinned,
  className = "h-[18px] w-[18px]",
}: {
  pinned: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 17v5" />
      <path d="M5 10h14" />
      <path d="M12 10V3" />
      <path d="M9 3h6l-1 7" />
      {!pinned && <path d="m4 4 16 16" />}
    </svg>
  );
}
