import type { ReactNode } from "react";

/**
 * The icon set. Every icon is a 24 by 24 outline drawn with the current text colour, so it follows the
 * colour of the button or link around it. Pass size to scale it. Icons are decorative: the button or
 * link that holds one must carry its own text or aria-label.
 */
type IconProps = { size?: number; className?: string };

function Outline({
  size = 16,
  className,
  strokeWidth = 1.8,
  children,
}: IconProps & { strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/* Navigation and records */

export function HomeIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Outline>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v6h6" />
      <path d="M9 13h6M9 17h4" />
    </Outline>
  );
}

export function EDocumentIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </Outline>
  );
}

export function CustomerIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 19v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
    </Outline>
  );
}

export function SupplierIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M3 8h11v7H3z" />
      <path d="M14 11h4l3 3v1h-7" />
      <circle cx="7" cy="17.5" r="1.5" />
      <circle cx="17" cy="17.5" r="1.5" />
    </Outline>
  );
}

export function AdminIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </Outline>
  );
}

/* Admin tiles */

export function HashIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M5 9h14M5 15h14M9 4l-2 16M17 4l-2 16" />
    </Outline>
  );
}

export function DepartmentIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M4 20V7l8-3 8 3v13" />
      <path d="M9 20v-6h6v6" />
    </Outline>
  );
}

export function CostCentreIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
    </Outline>
  );
}

export function VatIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M19 5 5 19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </Outline>
  );
}

export function CurrencyIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5v9" />
      <path d="M9.5 9.2c.4-.8 1.3-1.2 2.5-1.2 1.6 0 2.6.8 2.6 2s-1 1.9-2.6 1.9-2.6.8-2.6 2 1 2 2.6 2c1.2 0 2.1-.4 2.5-1.2" />
    </Outline>
  );
}

export function ProductIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
      <path d="M3.3 8 12 13l8.7-5" />
      <path d="M12 13v8" />
    </Outline>
  );
}

export function OrganisationIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M4 20V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v14" />
      <path d="M14 10h5a1 1 0 0 1 1 1v9" />
      <path d="M8 9h2M8 13h2M8 17h2M17 14h1M17 17h1" />
    </Outline>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v6l4 2" />
    </Outline>
  );
}

export function PeopleIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 4.13a3 3 0 0 1 0 5.75" />
    </Outline>
  );
}

/* Interface */

export function MenuIcon({ size = 18, ...props }: IconProps) {
  return (
    <Outline size={size} strokeWidth={2} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Outline>
  );
}

export function CloseIcon({ size = 16, ...props }: IconProps) {
  return (
    <Outline size={size} strokeWidth={2.2} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Outline>
  );
}

export function ChevronDownIcon({ size = 16, ...props }: IconProps) {
  return (
    <Outline size={size} strokeWidth={2.4} {...props}>
      <path d="m6 9 6 6 6-6" />
    </Outline>
  );
}

export function CheckIcon({ size = 16, ...props }: IconProps) {
  return (
    <Outline size={size} strokeWidth={2.5} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Outline>
  );
}

/** First, previous, next and last page arrows for the grid pager. */
export function PageIcon({ name, size = 16 }: { name: "first" | "previous" | "next" | "last"; size?: number }) {
  const bar = name === "first" || name === "last";
  const left = name === "first" || name === "previous";
  return (
    <Outline size={size} strokeWidth={2.4}>
      {bar ? <path d={name === "first" ? "M6 5v14" : "M18 5v14"} /> : null}
      <path d={left ? "M16 6l-6 6 6 6" : "M8 6l6 6-6 6"} />
    </Outline>
  );
}

/** The two small triangles on a sortable column header. The active direction is drawn darker. */
export function SortIcon({ direction }: { direction: "asc" | "desc" | null }) {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden>
      <path d="M5 1 9 5.5H1L5 1Z" opacity={direction === "desc" ? 0.3 : 1} />
      <path d="M5 13 1 8.5h8L5 13Z" opacity={direction === "asc" ? 0.3 : 1} />
    </svg>
  );
}

/** Ask Qula. This one keeps its own colours, and its size comes from the button that holds it. */
export function SparkleIcon() {
  return (
    <svg viewBox="1.6 0.8 21.2 19.6" aria-hidden="true">
      <path fill="#f4f8ff" d="M11.1 1.8 13.4 8.1 19.8 10.2 13.4 12.3 11.1 18.6 8.8 12.3 2.4 10.2 8.8 8.1Z" />
      <path fill="#d5c6ff" d="M17.6 2.2 19 5.2 22 6.4 19 7.6 17.6 10.6 16.2 7.6 13.2 6.4 16.2 5.2Z" />
      <path fill="#9ecbff" d="M6.2 13.4 7.2 15.6 9.5 16.5 7.2 17.4 6.2 19.6 5.2 17.4 2.9 16.5 5.2 15.6Z" />
    </svg>
  );
}
