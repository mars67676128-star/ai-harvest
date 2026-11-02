import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "record-demo-take3.mjs");
const runtimePath = path.join(__dirname, ".record-demo-take3-polished.runtime.mjs");

let source = await fs.readFile(sourcePath, "utf8");

function replaceOnce(from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Take 3 Polished patch failed: ${label} pattern not found.`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`Take 3 Polished patch failed: ${label} pattern is ambiguous.`);
  }
  source = source.replace(from, to);
}

replaceOnce(
  'const outputPath = path.join(outputDir, "Sifu_DemoDay_Take3.webm");',
  'const outputPath = path.join(outputDir, "Sifu_DemoDay_Take3_Polished.webm");',
  "output filename",
);

replaceOnce(
  '    .sifu-pet-shell{pointer-events:none !important}',
  '    .sifu-pet-shell{pointer-events:none !important;transition:opacity .22s ease,transform .22s ease}\n    body.take3-critical .sifu-pet-shell{opacity:0 !important;visibility:hidden !important}',
  "mascot protection CSS",
);

replaceOnce(
  'async function focus(page, locator, pad = 16, impact = false) {',
  `async function setCriticalScene(page, active) {
  await page.evaluate((active) => document.body.classList.toggle("take3-critical", active), active);
  await sleep(active ? 180 : 220);
}

async function focusRenderedText(page, locator, pad = 16, impact = false) {
  await locator.scrollIntoViewIfNeeded();
  const rect = await locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (!r.width || !r.height) {
      const fallback = el.getBoundingClientRect();
      return { x: fallback.x, y: fallback.y, width: fallback.width, height: fallback.height };
    }
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!rect || rect.width < 4 || rect.height < 4) {
    throw new Error("Cannot emphasize text because its rendered bounds are empty.");
  }
  await page.evaluate(({ rect, pad, impact }) => {
    const f = document.getElementById("take3-focus");
    if (!f) return;
    Object.assign(f.style, {
      left: String(rect.x - pad) + "px",
      top: String(rect.y - pad) + "px",
      width: String(rect.width + pad * 2) + "px",
      height: String(rect.height + pad * 2) + "px",
    });
    f.classList.toggle("impact", impact);
    f.classList.add("on");
  }, { rect, pad, impact });
  await sleep(280);
}

async function focus(page, locator, pad = 16, impact = false) {`,
  "rendered-text focus helper",
);

replaceOnce(
`async function focusClick(page, locator, { scale = 1.14, hold = 430, impact = false } = {}) {
  await locator.scrollIntoViewIfNeeded();
  await cameraTo(page, locator, scale);
  await focus(page, locator, impact ? 22 : 14, impact);
  await ripple(page, locator);
  if (impact) await impactFlash(page);
  await locator.click();
  await sleep(hold);
  await unfocus(page);
  await cameraReset(page);
}`,
`async function focusClick(page, locator, { scale = 1.14, hold = 560, impact = false } = {}) {
  await locator.scrollIntoViewIfNeeded();
  await cameraTo(page, locator, scale, 650);
  await focus(page, locator, impact ? 22 : 14, impact);
  await ripple(page, locator);
  if (impact) await impactFlash(page);
  await locator.click();
  // Clear the highlight almost immediately after the click. Some controls disappear
  // synchronously, and leaving the old box behind produces an empty-space highlight.
  await sleep(120);
  await unfocus(page);
  await sleep(Math.max(0, hold - 120));
  await cameraReset(page, 520);
}`,
  "stale click highlight",
);

replaceOnce(
`async function progressiveType(page, composer, text, { delay = 26, captionText } = {}) {
  await composer.waitFor({ state: "visible", timeout: 30_000 });`,
`async function progressiveType(page, composer, text, { delay = 30, captionText } = {}) {
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await setCriticalScene(page, true);`,
  "hide mascot during typing",
);

replaceOnce(
`async function typeAndSend(page, text, { delay = 26, captionText } = {}) {
  const composer = page.locator("textarea").last();
  await progressiveType(page, composer, text, { delay, captionText });
  await sleep(350);
  await composer.press("Enter");
  await sleep(420);
  await unfocus(page);
  await cameraReset(page);
}`,
`async function typeAndSend(page, text, { delay = 30, captionText } = {}) {
  const composer = page.locator("textarea").last();
  await progressiveType(page, composer, text, { delay, captionText });
  await sleep(500);
  await composer.press("Enter");
  await sleep(540);
  await unfocus(page);
  await cameraReset(page, 520);
  await setCriticalScene(page, false);
}`,
  "operator typing pacing",
);

replaceOnce(
`async function typeExpertResponse(page, text) {
  const composer = page.locator('textarea[placeholder*="Share what you would do"]');
  await progressiveType(page, composer, text, {
    delay: 13,
    captionText: "Tan teaches naturally. Sifu structures the lesson.",
  });
  await sleep(280);
  const send = page.getByRole("button", { name: "Send expert response" });
  await ripple(page, send);
  await send.click();
  await sleep(420);
  await unfocus(page);
  await cameraReset(page);
}`,
`async function typeExpertResponse(page, text) {
  const composer = page.locator('textarea[placeholder*="Share what you would do"]');
  await progressiveType(page, composer, text, {
    delay: 17,
    captionText: "Tan teaches naturally. Sifu structures the lesson.",
  });
  await sleep(500);
  const send = page.getByRole("button", { name: "Send expert response" });
  await ripple(page, send);
  await send.click();
  await sleep(540);
  await unfocus(page);
  await cameraReset(page, 520);
  await setCriticalScene(page, false);
}`,
  "expert response pacing and mascot protection",
);

replaceOnce(
`    const validatedHeading = page.getByRole("heading", { name: "Teaching validated" });
    await validatedHeading.waitFor({ timeout: 30_000 });
    await cameraTo(page, validatedHeading, 1.22);
    await focus(page, validatedHeading, 22);
    await caption(page, "Validated. Attributable. Reusable.", 900);
    await unfocus(page);
    await cameraReset(page);`,
`    const validatedHeading = page.getByRole("heading", { name: "Teaching validated" });
    await validatedHeading.waitFor({ timeout: 30_000 });
    await sleep(520);
    await setCriticalScene(page, true);
    // Use the actual text range after the new screen has rendered. No root-level camera
    // transform here, so the emphasis cannot drift away from the words.
    await focusRenderedText(page, validatedHeading, 18);
    await caption(page, "Validated. Attributable. Reusable.", 1500);
    await sleep(520);
    await unfocus(page);
    await setCriticalScene(page, false);`,
  "Teaching validated emphasis",
);

replaceOnce(
`    const validated = page.getByText(/Validated organisational knowledge/i).first();
    await waitWithBridge(
      page,
      validated.waitFor({ timeout: 150_000 }),
      {
        kicker: "THE MEMORY COMPOUNDS",
        title: "The next shift does not start from zero.",
        body: "Sifu can now answer from validated organisational knowledge and preserve its provenance.",
      },
    );
    await cameraTo(page, validated, 1.2);
    await focus(page, validated, 22);
    await caption(page, "Validated organisational knowledge — with provenance.", 1050);
    await unfocus(page);
    await cameraReset(page);`,
`    // Scope the wait to the completed Sifu message. The old generic text locator could
    // match too early while the agent was still thinking and highlight an empty region.
    const validatedMessage = page.locator(".sifu-message").filter({ hasText: /Validated organisational knowledge/i }).last();
    await waitWithBridge(
      page,
      validatedMessage.waitFor({ state: "visible", timeout: 150_000 }),
      {
        kicker: "THE MEMORY COMPOUNDS",
        title: "The next shift does not start from zero.",
        body: "Sifu can now answer from validated organisational knowledge and preserve its provenance.",
      },
    );
    await sleep(700);
    const validatedLabel = validatedMessage.getByText(/Validated organisational knowledge/i).first();
    await validatedLabel.waitFor({ state: "visible", timeout: 30_000 });
    await setCriticalScene(page, true);
    await focusRenderedText(page, validatedLabel, 18);
    await caption(page, "Validated organisational knowledge — with provenance.", 1600);
    await sleep(600);
    await unfocus(page);
    await setCriticalScene(page, false);`,
  "validated knowledge wait and emphasis",
);

// Let the important moments breathe a little more without returning to Take 2's pace.
source = source
  .replaceAll("hold: 2300", "hold: 2800")
  .replaceAll("hold: 2500", "hold: 3000")
  .replace('delay: 26,\n      captionText: "Amanda asks the real operational question."', 'delay: 30,\n      captionText: "Amanda asks the real operational question."')
  .replace('delay: 23,\n      captionText: "Amanda asks the same problem a different way."', 'delay: 28,\n      captionText: "Amanda asks the same problem a different way."')
  .replace('await caption(page, "Sifu found the right human expert.", 850);', 'await caption(page, "Sifu found the right human expert.", 1200);')
  .replace('await caption(page, "Natural teaching becomes a reviewable candidate.", 900);', 'await caption(page, "Natural teaching becomes a reviewable candidate.", 1250);')
  .replace('await caption(page, "ESCALATE — human review required.", 1550);', 'await caption(page, "ESCALATE — human review required.", 1850);')
  .replace('await caption(page, "Expert: Tan Wei Ming · Validated by: Jennifer Lim", 1100);', 'await caption(page, "Expert: Tan Wei Ming · Validated by: Jennifer Lim", 1450);')
  .replace('hold: 3800,', 'hold: 4200,');

source = source.replaceAll('take3-failure.png', 'take3-polished-failure.png');
source = source.replaceAll('Take 3 recording failed:', 'Take 3 Polished recording failed:');
source = source.replaceAll('Saved Take 3 recording to', 'Saved Take 3 Polished recording to');

await fs.writeFile(runtimePath, source, "utf8");
try {
  await import(pathToFileURL(runtimePath).href + "?v=" + Date.now());
} finally {
  await fs.rm(runtimePath, { force: true });
}
