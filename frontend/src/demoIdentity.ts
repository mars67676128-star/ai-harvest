import { setRole } from "./api";

export type DemoPersona = "employee" | "expert" | "reviewer" | "approver";

const rawPersona = new URLSearchParams(window.location.search).get("persona");

export const demoPersona: DemoPersona =
  rawPersona === "expert" || rawPersona === "reviewer" || rawPersona === "approver"
    ? rawPersona
    : "employee";

export const demoRole = demoPersona === "employee" ? "operator" : demoPersona;

setRole(demoRole);

export const demoUser =
  demoPersona === "expert"
    ? { name: "Tan Wei Ming", initials: "TW", subtitle: "Senior M&E Technician" }
    : demoPersona === "reviewer"
      ? { name: "Knowledge Reviewer", initials: "KR", subtitle: "Reviewer" }
      : demoPersona === "approver"
        ? { name: "Jennifer Lim", initials: "JL", subtitle: "Knowledge Owner" }
        : { name: "Amanda Lee", initials: "AL", subtitle: "Operations" };
