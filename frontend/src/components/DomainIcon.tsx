import type { Domain } from "../types";

// One icon + tint per knowledge domain, so a pill is recognisable at a glance.
const DOMAIN_STYLE: Record<string, { bg: string; fg: string }> = {
  "Asset Operations": { bg: "#e3f1f0", fg: "#0d7377" },
  "Tenant Experience": { bg: "#fdecea", fg: "#c4473d" },
  "Energy Optimisation": { bg: "#fdf4e3", fg: "#b8650a" },
  Leasing: { bg: "#eaf2fb", fg: "#2b6cb0" },
  "Technical Services": { bg: "#eef2f1", fg: "#4b5b59" },
  Sustainability: { bg: "#ecf7ee", fg: "#2f9e44" },
};

function Glyph({ domain }: { domain: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (domain) {
    case "Asset Operations": // water drop over a gauge — drainage / equipment
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%">
          <path {...p} d="M12 3.5c-2.6 3.3-5 6.2-5 8.9a5 5 0 0 0 10 0c0-2.7-2.4-5.6-5-8.9Z" />
          <path {...p} d="M9.5 13.5a2.6 2.6 0 0 0 2.5 2" />
          <path {...p} d="M5 20.5h14" />
        </svg>
      );
    case "Tenant Experience": // people + route
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%">
          <circle {...p} cx="9" cy="8" r="3" />
          <path {...p} d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
          <path {...p} d="M16 5.5a2.8 2.8 0 0 1 0 5.2M17.5 14.3c1.7.6 2.8 2.2 3 4.7" />
        </svg>
      );
    case "Energy Optimisation":
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%">
          <path {...p} d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12L13 3Z" />
        </svg>
      );
    case "Sustainability":
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%">
          <path {...p} d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z" />
          <path {...p} d="M5 19l7-7" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%">
          <rect {...p} x="4" y="4" width="16" height="16" rx="4" />
          <path {...p} d="M9 12h6M12 9v6" />
        </svg>
      );
  }
}

export function DomainIcon({ domain, size = 36 }: { domain: Domain | string; size?: number }) {
  const s = DOMAIN_STYLE[domain] ?? DOMAIN_STYLE["Technical Services"];
  return (
    <span
      className="domain-icon"
      style={{ width: size, height: size, background: s.bg, color: s.fg, padding: Math.round(size * 0.2) }}
      aria-hidden="true"
    >
      <Glyph domain={domain} />
    </span>
  );
}
