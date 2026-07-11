import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(size: number, props: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    ...props,
  };
}

export function HistoryIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function GearIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} strokeWidth={1.7}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a2 2 0 1 1-4 0v-.09a1.6 1.6 0 0 0-1-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3a2 2 0 1 1 0-4h.09a1.6 1.6 0 0 0 1.47-1 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32h0a1.6 1.6 0 0 0 .97-1.47V3a2 2 0 1 1 4 0v.09a1.6 1.6 0 0 0 .97 1.47h0a1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77v0a1.6 1.6 0 0 0 1.47.97H21a2 2 0 1 1 0 4h-.09a1.6 1.6 0 0 0-1.47.97Z" />
    </svg>
  );
}

export function PlusIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function StopIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  );
}

export function SendIcon({ size = 18, caret = "currentColor", plus = "currentColor", ...props }: IconProps & { caret?: string; plus?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden {...props}>
      <path d="M96 140 L248 256 L96 372" fill="none" stroke={caret} strokeWidth={64} strokeLinecap="square" />
      <rect x="330" y="228" width="150" height="56" fill={plus} />
      <rect x="377" y="181" width="56" height="150" fill={plus} />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} strokeWidth={2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} strokeWidth={2}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CopyIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

export function BookmarkIcon({ size = 16, filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(size, props)} fill={filled ? "currentColor" : "none"}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function RefreshIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function SearchIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function PencilIcon({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function TrashIcon({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

export function CloseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} strokeWidth={2}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function DiscordIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M20 5.3A17.6 17.6 0 0 0 15.6 4l-.3.6c1.7.4 2.6 1 3.5 1.7-1.5-.7-3-1.2-4.8-1.2-1.8 0-3.3.5-4.8 1.2.9-.7 2-1.3 3.5-1.7L12.4 4a17.6 17.6 0 0 0-4.4 1.3C5.7 8.6 5 11.9 5.3 15.1c1.6 1.2 3.1 1.9 4.6 2.4l.6-1a9 9 0 0 1-1.5-.7c.1-.1.3-.2.4-.3 2.9 1.3 6.1 1.3 8.9 0 .1.1.3.2.4.3-.5.3-1 .5-1.5.7l.6 1c1.5-.5 3-1.2 4.6-2.4.4-3.7-.6-7-2.9-9.8ZM9.7 13.6c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8c.9 0 1.6.8 1.6 1.8s-.7 1.8-1.6 1.8Zm4.6 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8c.9 0 1.6.8 1.6 1.8s-.7 1.8-1.6 1.8Z" />
    </svg>
  );
}

export function ScrollDownIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} strokeWidth={2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Bottom-nav tab icons — simple, consistent line style at ~22px. */
export function NavIcon({ tab, size = 22, ...props }: IconProps & { tab: "feed" | "splits" | "chat" | "props" | "profile" }) {
  const common = base(size, props);
  switch (tab) {
    case "feed":
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      );
    case "splits":
      return (
        <svg {...common}>
          <path d="M4 20V10M12 20V4M20 20v-7" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          <path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.5 9 9 0 0 1-3.2-.6L3 21l1.4-4.1A8.3 8.3 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z" />
        </svg>
      );
    case "props":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
      );
    case "profile":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.6" />
          <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
        </svg>
      );
  }
}

export function TeamLogo({
  src,
  alt,
  size = 32,
  className,
}: {
  src: string;
  alt: string;
  size?: number;
  className?: string;
}) {
  const initials = alt
    .replace(/(logo|flag)/gi, "")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        borderRadius: "50%",
        overflow: "hidden",
        background: "var(--surface-2)",
        fontSize: size * 0.34,
        fontWeight: 700,
        color: "var(--text-2)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
        onError={(e) => {
          const img = e.currentTarget;
          img.style.display = "none";
          const parent = img.parentElement;
          if (parent) parent.textContent = initials;
        }}
      />
    </span>
  );
}
