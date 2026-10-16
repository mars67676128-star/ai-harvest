import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY_BY_KEY, persona } from "../lib/glossary";

/**
 * A word with a dotted underline; hover or keyboard focus shows its plain-language definition.
 * The popover is portalled to <body> with position: fixed, so cards with overflow/transform never clip or shift it.
 */
export function Term({ k, children, tag = false }: { k: string; children?: ReactNode; tag?: boolean }) {
  const g = GLOSSARY_BY_KEY[k];
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  if (!g) return <>{children}</>;

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const W = 300;
    const left = Math.max(12, Math.min(r.left, window.innerWidth - W - 12));
    const above = r.bottom + 190 > window.innerHeight;
    setPos({ left, top: above ? r.top - 8 : r.bottom + 8, above });
  };
  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      className={`term ${tag ? "term-tag" : ""}`}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => { e.stopPropagation(); if (pos) { hide(); } else { show(); } }}
      aria-label={`${g.term}: ${g.plain}`}
    >
      {children ?? g.term}
      {pos && createPortal(
        <span
          className="term-pop"
          role="tooltip"
          style={{ left: pos.left, top: pos.top, transform: pos.above ? "translateY(-100%)" : undefined }}
        >
          <span className="term-pop-t">{g.term}</span>
          <span className="term-pop-b">{g.plain}</span>
          {g.example && <span className="term-pop-e">e.g. {g.example}</span>}
        </span>,
        document.body
      )}
    </span>
  );
}

/** Small round avatar with initials for a demo persona. */
export function Avatar({ actor, size = 28 }: { actor: string; size?: number }) {
  const p = persona(actor);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: p.tone, fontSize: Math.round(size * 0.38) }}
      title={`${p.name}${p.title ? " · " + p.title : ""}`}
    >
      {p.initials}
    </span>
  );
}
