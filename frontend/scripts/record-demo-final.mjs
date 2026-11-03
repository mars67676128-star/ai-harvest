import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "record-demo-take3.mjs");
const runtimePath = path.join(__dirname, ".record-demo-final.runtime.mjs");

let source = (await fs.readFile(sourcePath, "utf8")).replace(/\r\n/g, "\n");

function replaceRequired(pattern, replacement, label) {
  const before = source;
  source = source.replace(pattern, replacement);
  if (source === before) {
    throw new Error(`Final recorder patch failed: ${label}. Base Take 3 source changed.`);
  }
}

replaceRequired(
  /const outputPath = path\.join\(outputDir, "Sifu_DemoDay_Take3\.webm"\);/,
  'const outputPath = path.join(outputDir, "Sifu_DemoDay_Final.webm");',
  "output filename",
);

// Keep yesterday's visual grammar: zoom-only emphasis, no geometry/focus boxes.
replaceRequired(
  /#take3-focus\{position:absolute;/,
  "#take3-focus{display:none!important;position:absolute;",
  "disable focus box",
);

// Keep the mascot present, but outside the active reading/response area.
replaceRequired(
  /\.sifu-pet-shell\{pointer-events:none !important\}/,
  ".sifu-pet-shell{pointer-events:none!important;right:12px!important;left:auto!important;top:96px!important;bottom:auto!important;transform:scale(.56)!important;transform-origin:top right!important;opacity:.9!important;z-index:70!important;gap:0!important}\n    .sifu-pet-thought{display:none!important}",
  "dock mascot safely",
);

// One zoom only while typing. The old helper zoomed 1.18 -> 1.23 -> 1.27 into the same box.
replaceRequired(
  /async function progressiveType\(page, composer, text, \{ delay = 26, captionText \} = \{\}\) \{[\s\S]*?\n\}\n\nasync function typeAndSend/,
  `async function progressiveType(page, composer, text, { delay = 26, captionText } = {}) {
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.scrollIntoViewIfNeeded();
  const anchorBox = await composer.boundingBox();
  await cameraToBox(page, anchorBox, 1.17, 620);
  if (captionText) await caption(page, captionText, 1150);
  await composer.evaluate((el) => el.focus());
  await composer.fill("");
  await composer.type(text, { delay });
}

async function typeAndSend`,
  "single-zoom typing",
);

// Stay on the real Sifu frontend while the first answer is being generated.
replaceRequired(
  /async function waitForExpertRoute\(page\) \{[\s\S]*?\n\}\n\nasync function waitWithBridge/,
  `async function waitForExpertRoute(page) {
  const askTan = page.getByRole("button", { name: /Ask Tan/i });
  const liveError = page.getByText(/I couldn’t produce a live AI answer/i);
  const wait = Promise.race([
    askTan.waitFor({ state: "visible", timeout: 75_000 }).then(() => ({ ok: true })),
    liveError.waitFor({ state: "visible", timeout: 75_000 }).then(async () => {
      const text = await page.locator(".sifu-message").last().innerText().catch(() => "Live Sifu request failed.");
      throw new Error(\`Live Sifu request failed before expert routing: \${text}\`);
    }),
  ]);
  await caption(page, "Sifu checks validated organisational knowledge first.", 1400);
  await wait;
  await sleep(900);
  return askTan;
}

async function waitWithBridge`,
  "native Sifu thinking state",
);

// Any remaining asynchronous waits also stay on the product UI; chapter cards are only between beats.
replaceRequired(
  /async function waitWithBridge\(page, waitPromise, card\) \{[\s\S]*?\n\}/,
  `async function waitWithBridge(page, waitPromise, card) {
  void card;
  await waitPromise;
  await sleep(700);
}`,
  "remove response bridge cards",
);

// Teaching-validated scene: one clean punch-in after the state is stable.
replaceRequired(
  /    const validatedHeading = page\.getByRole\("heading", \{ name: "Teaching validated" \}\);\n    await validatedHeading\.waitFor\(\{ timeout: 30_000 \}\);\n    await cameraTo\(page, validatedHeading, 1\.22\);\n    await focus\(page, validatedHeading, 22\);\n    await caption\(page, "Validated\. Attributable\. Reusable\.", 900\);\n    await unfocus\(page\);\n    await cameraReset\(page\);/,
  `    const validatedHeading = page.getByRole("heading", { name: "Teaching validated" });
    await validatedHeading.waitFor({ state: "visible", timeout: 30_000 });
    await sleep(700);
    await cameraTo(page, validatedHeading, 1.15, 700);
    await caption(page, "Validated. Attributable. Reusable.", 1600);
    await sleep(500);
    await cameraReset(page, 650);`,
  "Teaching validated zoom",
);

// Reuse scene: show Sifu thinking/responding in the actual frontend, then one provenance zoom.
replaceRequired(
  /    const validated = page\.getByText\(\/Validated organisational knowledge\/i\)\.first\(\);[\s\S]*?    await cameraReset\(page\);\n\n    await chapter\(page, \{\n      kicker: "Beyond Q&A",/,
  `    const provenance = page.locator(".knowledge-provenance").last();
    const provenanceError = page.getByText(/I couldn’t produce a live AI answer/i);
    const provenanceWait = Promise.race([
      provenance.waitFor({ state: "visible", timeout: 75_000 }),
      provenanceError.waitFor({ state: "visible", timeout: 75_000 }).then(async () => {
        const text = await page.locator(".sifu-message").last().innerText().catch(() => "Live Sifu request failed.");
        throw new Error("Validated reuse answer failed: " + text);
      }),
    ]);
    await caption(page, "Sifu checks the newly validated organisational memory.", 1400);
    await provenanceWait;
    await sleep(1000);
    await cameraTo(page, provenance, 1.14, 700);
    await caption(page, "Validated organisational knowledge — with provenance.", 1800);
    await sleep(700);
    await cameraReset(page, 650);

    await chapter(page, {
      kicker: "Beyond Q&A",`,
  "validated reuse state",
);

// Cases: slow down and explain the product meaning before, during and after applying knowledge.
replaceRequired(
  /    await openApp\(page, baseUrl\);\n    const cases = page\.getByRole\("button", \{ name: "Cases" \}\);[\s\S]*?    await cameraReset\(page\);\n\n    await chapter\(page, \{\n      kicker: "Sifu",/,
  `    await openApp(page, baseUrl);
    const cases = page.getByRole("button", { name: "Cases" });
    await cases.click();
    await sleep(850);

    const caseRow = page.getByRole("button", { name: /Pump RUNNING while water rises/i });
    await caseRow.waitFor({ state: "visible", timeout: 30_000 });
    await ripple(page, caseRow);
    await caseRow.click();

    const caseTitle = page.locator(".case-title").filter({ hasText: "Harbour Exchange" }).first();
    await caseTitle.waitFor({ state: "visible", timeout: 30_000 });
    await sleep(1300);

    const readings = page.locator(".tile-grid").first();
    await readings.scrollIntoViewIfNeeded();
    await cameraTo(page, readings, 1.08, 700);
    await caption(page, "Cases connect validated knowledge to verified operating readings.", 2600);
    await caption(page, "Here: pump RUNNING, but water is rising 3 mm/min. The alternate entrance is still unverified.", 3300);
    await sleep(900);
    await cameraReset(page, 650);

    const apply = page.getByRole("button", { name: "Apply Validated Knowledge" });
    await apply.waitFor({ state: "visible", timeout: 30_000 });
    await ripple(page, apply);
    await apply.click();
    await caption(page, "Sifu now applies only validated organisational knowledge to those readings.", 2800);

    const escalate = page.getByText("ESCALATE", { exact: true });
    await escalate.waitFor({ state: "visible", timeout: 75_000 });
    await sleep(1400);

    const decisionPanel = page.locator(".guidance-decision").first();
    await decisionPanel.scrollIntoViewIfNeeded();
    await cameraTo(page, decisionPanel, 1.12, 750);
    await caption(page, "RUNNING is a status signal — it does not prove effective drainage.", 2800);
    await caption(page, "RUNNING + rising water crosses the validated escalation boundary.", 3200);
    await caption(page, "ESCALATE — with the human operator still in control.", 2600);
    await sleep(1200);
    await cameraReset(page, 700);

    const provenanceCard = page.locator(".pill-provenance").first();
    await provenanceCard.scrollIntoViewIfNeeded();
    await page.getByText("Tan Wei Ming", { exact: true }).last().waitFor({ timeout: 30_000 });
    await page.getByText("Jennifer Lim", { exact: true }).last().waitFor({ timeout: 30_000 });
    await caption(page, "The decision is traceable: taught by Tan Wei Ming, validated by Jennifer Lim.", 3000);
    await sleep(900);

    await chapter(page, {
      kicker: "Sifu",`,
  "slower explanatory Cases section",
);

// Slower, calmer pacing around the existing pass — without Take 2's extra visual layers.
source = source
  .replaceAll("hold: 2300", "hold: 3100")
  .replaceAll("hold: 2500", "hold: 3200")
  .replace('delay: 26,\n      captionText: "Amanda asks the real operational question."', 'delay: 38,\n      captionText: "Amanda asks the real operational question."')
  .replace('delay: 23,\n      captionText: "Amanda asks the same problem a different way."', 'delay: 36,\n      captionText: "Amanda asks the same problem a different way."')
  .replace('    delay: 13,\n    captionText: "Tan teaches naturally. Sifu structures the lesson."', '    delay: 22,\n    captionText: "Tan teaches naturally. Sifu structures the lesson."')
  .replace('await caption(page, "Sifu found the right human expert.", 850);', 'await caption(page, "Sifu found the right human expert.", 1400);')
  .replace('await caption(page, "Natural teaching becomes a reviewable candidate.", 900);', 'await caption(page, "Natural teaching becomes a reviewable candidate.", 1500);')
  .replace('hold: 3800,', 'hold: 4300,');

source = source.replaceAll('take3-failure.png', 'final-recording-failure.png');
source = source.replaceAll('Take 3 recording failed:', 'Final recording failed:');
source = source.replaceAll('Saved Take 3 recording to', 'Saved final recording to');

await fs.writeFile(runtimePath, source, "utf8");
try {
  execFileSync(process.execPath, ["--check", runtimePath], { stdio: "inherit" });
  if (process.env.TAKE3_FINAL_PATCH_CHECK_ONLY === "1") {
    console.log("Final recorder patch patterns and generated runtime syntax: OK");
  } else {
    await import(pathToFileURL(runtimePath).href + "?v=" + Date.now());
  }
} finally {
  await fs.rm(runtimePath, { force: true });
}
