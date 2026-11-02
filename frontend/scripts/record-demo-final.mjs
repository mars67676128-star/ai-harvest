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

// Zoom-only visual language: never render the geometry-based focus rectangle.
replaceRequired(
  /#take3-focus\{position:absolute;/,
  "#take3-focus{display:none!important;position:absolute;",
  "disable focus box",
);

// Keep the mascot, but dock it in a small safe position for the whole recording.
// The thought bubble is disabled because its 230px width was the main text obstruction.
replaceRequired(
  /\.sifu-pet-shell\{pointer-events:none !important\}/,
  ".sifu-pet-shell{pointer-events:none!important;right:12px!important;left:auto!important;top:96px!important;bottom:auto!important;transform:scale(.58)!important;transform-origin:top right!important;opacity:.9!important;z-index:70!important;gap:0!important}\n    .sifu-pet-thought{display:none!important}",
  "dock mascot safely",
);

// Teaching-validated scene: zoom only after the new heading is stable.
replaceRequired(
  /    const validatedHeading = page\.getByRole\("heading", \{ name: "Teaching validated" \}\);\n    await validatedHeading\.waitFor\(\{ timeout: 30_000 \}\);\n    await cameraTo\(page, validatedHeading, 1\.22\);\n    await focus\(page, validatedHeading, 22\);\n    await caption\(page, "Validated\. Attributable\. Reusable\.", 900\);\n    await unfocus\(page\);\n    await cameraReset\(page\);/,
  `    const validatedHeading = page.getByRole("heading", { name: "Teaching validated" });
    await validatedHeading.waitFor({ state: "visible", timeout: 30_000 });
    await sleep(650);
    await cameraTo(page, validatedHeading, 1.16, 700);
    await caption(page, "Validated. Attributable. Reusable.", 1500);
    await sleep(500);
    await cameraReset(page, 600);`,
  "Teaching validated zoom",
);

// Reuse scene: wait for the actual provenance component, not model wording.
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
    await waitWithBridge(
      page,
      provenanceWait,
      {
        kicker: "THE MEMORY COMPOUNDS",
        title: "The next shift does not start from zero.",
        body: "Sifu can now answer from validated organisational knowledge and preserve its provenance.",
      },
    );
    await sleep(700);
    await cameraTo(page, provenance, 1.16, 700);
    await caption(page, "Validated organisational knowledge — with provenance.", 1600);
    await sleep(650);
    await cameraReset(page, 600);

    await chapter(page, {
      kicker: "Beyond Q&A",`,
  "validated reuse state",
);

// Slightly slower than Take 3, but still much tighter than Take 2.
source = source
  .replaceAll("hold: 2300", "hold: 2800")
  .replaceAll("hold: 2500", "hold: 3000")
  .replace('delay: 26,\n      captionText: "Amanda asks the real operational question."', 'delay: 30,\n      captionText: "Amanda asks the real operational question."')
  .replace('delay: 23,\n      captionText: "Amanda asks the same problem a different way."', 'delay: 28,\n      captionText: "Amanda asks the same problem a different way."')
  .replace('    delay: 13,\n    captionText: "Tan teaches naturally. Sifu structures the lesson."', '    delay: 17,\n    captionText: "Tan teaches naturally. Sifu structures the lesson."')
  .replace('await caption(page, "Sifu found the right human expert.", 850);', 'await caption(page, "Sifu found the right human expert.", 1200);')
  .replace('await caption(page, "Natural teaching becomes a reviewable candidate.", 900);', 'await caption(page, "Natural teaching becomes a reviewable candidate.", 1250);')
  .replace('await caption(page, "ESCALATE — human review required.", 1550);', 'await caption(page, "ESCALATE — human review required.", 1900);')
  .replace('await caption(page, "Expert: Tan Wei Ming · Validated by: Jennifer Lim", 1100);', 'await caption(page, "Expert: Tan Wei Ming · Validated by: Jennifer Lim", 1500);')
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
