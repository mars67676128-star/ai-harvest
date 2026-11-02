// Status lines shown while the AI works. They name the steps the prompt asks the
// model to do; they are progress labels, not the model's actual reasoning.
import { useEffect, useState } from "react";

export const STEP_MS = 650;

export function AiSteps({ steps, label }: { steps: string[]; label: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), STEP_MS);
    return () => window.clearInterval(t);
  }, [steps.length]);
  return (
    <div className="ai-steps" role="status" aria-label={label}>
      <ol>
        {steps.slice(0, i + 1).map((s, n) => (
          <li key={s} className={n < i ? "done" : "now"}>
            <span className="ai-step-mark" aria-hidden="true">{n < i ? "✓" : ""}</span>
            {s}{n === i ? "…" : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Minimum time to show every step once, so the list never cuts off mid-way. */
export const minStepsTime = (steps: string[]) => steps.length * STEP_MS + 400;

export const EXTRACT_STEPS = [
  "Reading the interview",
  "Finding where it applies",
  "Picking out the readings it needs",
  "Writing the rules",
  "Checking what's never allowed",
  "Listing open questions",
];

export const REVISE_STEPS = [
  "Reading the feedback",
  "Comparing with the approved version",
  "Drafting the new rule",
  "Adding a test situation for it",
  "Keeping existing tests and limits",
];
