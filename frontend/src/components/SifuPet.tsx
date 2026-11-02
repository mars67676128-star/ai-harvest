import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

type PetState = "idle" | "attentive" | "thinking" | "searching" | "routing" | "learning" | "proud" | "alert";

type Offset = { x: number; y: number };

const STORAGE_KEY = "sifu-pet-offset";

const COPY: Record<PetState, { label: string; thought: string }> = {
  idle: { label: "Ready", thought: "Ask me when something at work feels unclear." },
  attentive: { label: "Listening", thought: "I’m listening. Tell me what happened." },
  thinking: { label: "Thinking", thought: "I’m separating what we know from what we still need." },
  searching: { label: "Searching", thought: "I don’t want to guess. I’m looking for validated knowledge or the right expert." },
  routing: { label: "Routing", thought: "I found someone whose experience may help." },
  learning: { label: "Learning", thought: "There may be a reusable teaching here." },
  proud: { label: "Validated", thought: "This teaching can now help the next person." },
  alert: { label: "Needs attention", thought: "There’s a review or clarification waiting for a human decision." },
};

function loadOffset(): Offset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw) as Partial<Offset>;
    return {
      x: typeof parsed.x === "number" ? parsed.x : 0,
      y: typeof parsed.y === "number" ? parsed.y : 0,
    };
  } catch {
    return { x: 0, y: 0 };
  }
}

function inferState(): PetState {
  if (document.querySelector(".validation-celebration")) return "proud";
  if (document.querySelector(".guidance-decision-escalate")) return "alert";
  if (document.querySelector(".insight-event, .candidate-backdrop, .confirmed-event")) return "learning";
  if (document.querySelector(".review-page .margin-comment")) return "alert";
  if (document.querySelector(".sifu-message .mood-searching")) return "searching";
  if (document.querySelector(".system-line")) return "routing";
  if (document.querySelector(".sifu-message .mood-thinking")) return "thinking";
  if (document.querySelector(".knowledge-provenance .provenance-item")) return "proud";
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && active.getAttribute("aria-label") === "Ask Sifu") return "attentive";
  return "idle";
}

export default function SifuPet() {
  const [state, setState] = useState<PetState>("idle");
  const [offset, setOffset] = useState<Offset>(loadOffset);
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const update = () => setState(inferState());
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);

    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  const copy = COPY[state];
  const style = useMemo(() => ({ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }), [offset]);

  const focusAskSifu = () => {
    const visibleComposer = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Ask Sifu"]'))
      .find((node) => node.offsetParent !== null);
    if (visibleComposer) {
      visibleComposer.focus();
      return;
    }

    const askButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim().includes("Ask Sifu"));
    askButton?.click();
    window.setTimeout(() => {
      const composer = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Ask Sifu"]'))
        .find((node) => node.offsetParent !== null);
      composer?.focus();
    }, 80);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
    moved.current = false;
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragOrigin.current) return;
    const dx = event.clientX - dragOrigin.current.pointerX;
    const dy = event.clientY - dragOrigin.current.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 5) moved.current = true;

    const next = {
      x: Math.min(8, Math.max(-(window.innerWidth - 120), dragOrigin.current.offsetX + dx)),
      y: Math.min(8, Math.max(-(window.innerHeight - 150), dragOrigin.current.offsetY + dy)),
    };
    setOffset(next);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragOrigin.current = null;
    setDragging(false);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(offset));
    } catch {
      // Position persistence is optional.
    }
    if (!moved.current) focusAskSifu();
  };

  return (
    <aside className={`sifu-pet-shell pet-${state} ${dragging ? "is-dragging" : ""}`} style={style} aria-live="polite">
      <div className="sifu-pet-thought" role="status">
        <strong>{copy.label}</strong>
        <span>{copy.thought}</span>
      </div>
      <button
        type="button"
        className="sifu-pet"
        aria-label={`Sifu pet — ${copy.label}. Click to ask Sifu; drag to move.`}
        title="Click to ask Sifu · drag to move"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragOrigin.current = null;
          setDragging(false);
        }}
      >
        <svg className="sifu-pet-art" viewBox="0 0 150 150" role="img" aria-hidden="true">
          <g className="pet-tail">
            <path d="M116 108c22 4 28 22 13 29-10 5-20-2-17-10 2-5 9-6 13-2" />
            <path d="M118 117c6 0 11 3 14 7" />
          </g>
          <g className="pet-body">
            <path className="pet-robe" d="M46 96c5-14 18-22 30-22s25 8 30 22l9 37H37Z" />
            <path className="pet-sash" d="M52 98c17 10 34 10 51 0" />
            <path className="pet-arm left" d="M50 100c-12 8-16 18-17 27" />
            <path className="pet-arm right" d="M102 100c10 8 13 18 14 27" />
          </g>
          <g className="pet-head">
            <path className="pet-ear left" d="M47 45 32 24l28 8Z" />
            <path className="pet-ear right" d="m103 45 15-21-28 8Z" />
            <circle className="pet-face" cx="75" cy="61" r="35" />
            <path className="pet-mask" d="M44 56c8-12 18-16 31-11 13-5 23-1 31 11-7 8-17 12-31 12S51 64 44 56Z" />
            <path className="pet-brow left" d="M55 51c5-4 10-5 15-2" />
            <path className="pet-brow right" d="M80 49c5-3 10-2 15 2" />
            <ellipse className="pet-eye left" cx="62" cy="57" rx="3.5" ry="5" />
            <ellipse className="pet-eye right" cx="88" cy="57" rx="3.5" ry="5" />
            <circle className="pet-nose" cx="75" cy="68" r="4" />
            <path className="pet-beard" d="M58 72c6 5 11 7 17 7s11-2 17-7c-1 17-7 27-17 34-10-7-16-17-17-34Z" />
          </g>
          <g className="pet-scroll">
            <path d="M31 91h24v10H31a5 5 0 0 1 0-10Z" />
            <path d="M55 91h18v10H55" />
            <circle cx="31" cy="96" r="5" />
          </g>
          <g className="pet-orbit">
            <circle cx="119" cy="62" r="3" />
            <circle cx="125" cy="76" r="2" />
            <path d="m113 48 3 5 5 3-5 3-3 5-3-5-5-3 5-3Z" />
          </g>
          <g className="pet-seal">
            <circle cx="118" cy="89" r="10" />
            <path d="m113 89 4 4 7-8" />
          </g>
        </svg>
        <span className="sifu-pet-state-dot" />
      </button>
    </aside>
  );
}
