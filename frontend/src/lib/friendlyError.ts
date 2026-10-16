// Plain-language versions of the backend's demo-mode error codes (shared by Live Case and Knowledge Evolution).
export function friendlyError(msg: string): string {
  if (msg.includes("MOCK_FIXTURE_ONLY"))
    return "The offline demo AI only has recorded answers for the demo's backflow correction, and this database has already used them. Start a fresh demo database to run the learning loop again — with a live AI model connected, any correction would work.";
  if (msg.includes("STALE_PARENT"))
    return "The pill this proposal was based on is no longer the current approved version. Start again from a new assessment.";
  if (msg.includes("VERSION_EXISTS"))
    return "That version number is already taken. Reload the page and try again.";
  if (/forbidden|FORBIDDEN|requires role/i.test(msg))
    return "Your current role isn't allowed to do this — switch role at the top right.";
  return msg;
}
