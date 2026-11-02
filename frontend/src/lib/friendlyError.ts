// Plain-language versions of the backend's demo-mode error codes (shared by Live Case and Knowledge Evolution).
export function friendlyError(msg: string): string {
  if (msg.includes("MOCK_FIXTURE_ONLY"))
    return "The offline demo AI has no recorded answer for this correction (it only knows the two scripted ones, once each). Start a fresh demo database, or connect the live AI model.";
  if (msg.includes("SEMANTIC_REGRESSION"))
    return "AI draft needs review: source-grounded checks did not pass. Human correction is required before approval; the current approved Pill remains active.";
  if (msg.includes("UNRESOLVED_KNOWLEDGE"))
    return "Expert clarification required. This revision is blocked from release; the current approved Pill remains active.";
  if (msg.includes("INCOMPLETE_KNOWLEDGE"))
    return "Expert clarification required: the AI draft is missing knowledge a Pill needs. Nothing was released.";
  if (msg.includes("LLM_UNAVAILABLE"))
    return "The live AI model did not return a usable draft. No knowledge was changed.";
  if (msg.includes("STALE_PARENT"))
    return "The pill this proposal was based on is no longer the current approved version. Start again from a new assessment.";
  if (msg.includes("VERSION_EXISTS"))
    return "That version number is already taken. Reload the page and try again.";
  if (/forbidden|FORBIDDEN|requires role/i.test(msg))
    return "Your current role isn't allowed to do this — switch role at the top right.";
  return msg;
}
