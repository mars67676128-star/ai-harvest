import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outputDir = path.resolve(repoRoot, "artifacts/video");
const outputPath = path.join(outputDir, "Sifu_DemoDay.webm");
const baseUrl = process.env.SIFU_DEMO_URL ?? "http://127.0.0.1:5173";

const QUESTION =
  "The sump pump says RUNNING but the basement water level is still rising. Does RUNNING mean it's actually draining?";

const EXPERT_RESPONSE =
  "RUNNING only confirms the pump has been commanded to run or that the motor status is active. It does not prove water is actually being discharged. Check for actual flow at the discharge outlet and monitor the water-level trend. If the pump shows RUNNING but the water level continues to rise, escalate because the pump may not be removing water effectively.";

const REUSE_QUESTION =
  "The sump pump is showing RUNNING, but the water level keeps rising. What should I do?";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function chapter(page, { kicker, title, accent, body, hold = 4200 }) {
  await page.setContent(`<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 100%; height: 100%; }
        body {
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at 78% 18%, rgba(61, 191, 177, .13), transparent 34%),
            linear-gradient(135deg, #0c2d31 0%, #092126 100%);
          color: #f7f3e9;
          font-family: Arial, Helvetica, sans-serif;
        }
        .frame { width: 84%; max-width: 1460px; }
        .kicker {
          margin-bottom: 28px;
          color: #77cfc5;
          font-size: 20px;
          font-weight: 700;
          letter-spacing: .16em;
          text-transform: uppercase;
        }
        h1 {
          max-width: 1260px;
          margin: 0;
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 86px;
          line-height: 1.02;
          letter-spacing: -.035em;
          font-weight: 700;
        }
        h1 em { color: #76d6ca; font-style: normal; }
        p {
          max-width: 980px;
          margin: 34px 0 0;
          color: #c6d6d2;
          font-size: 28px;
          line-height: 1.5;
        }
        .rule {
          width: 82px;
          height: 6px;
          margin-top: 46px;
          border-radius: 999px;
          background: #50c9b9;
        }
        .brand {
          position: fixed;
          left: 8%;
          bottom: 62px;
          color: rgba(247,243,233,.7);
          font-size: 18px;
          letter-spacing: .13em;
          text-transform: uppercase;
        }
      </style>
    </head>
    <body>
      <main class="frame">
        <div class="kicker">${kicker}</div>
        <h1>${title.replace(accent, `<em>${accent}</em>`)}</h1>
        ${body ? `<p>${body}</p>` : ""}
        <div class="rule"></div>
      </main>
      <div class="brand">SIFU · AI HARVEST</div>
    </body>
  </html>`);
  await sleep(hold);
}

async function showWaitOverlay(page, { kicker, title, body }) {
  await page.evaluate(({ kicker, title, body }) => {
    document.getElementById("sifu-video-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "sifu-video-overlay";
    overlay.innerHTML = `
      <div style="max-width:1100px">
        <div style="color:#77cfc5;font:700 16px/1.2 Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;margin-bottom:22px">${kicker}</div>
        <div style="color:#f7f3e9;font:700 64px/1.02 Georgia,'Times New Roman',serif;letter-spacing:-.035em">${title}</div>
        ${body ? `<div style="color:#c6d6d2;font:400 22px/1.5 Arial,sans-serif;margin-top:25px;max-width:900px">${body}</div>` : ""}
      </div>`;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "99999",
      display: "grid",
      placeItems: "center",
      padding: "9vw",
      background: "radial-gradient(circle at 78% 18%, rgba(61,191,177,.13), transparent 34%), linear-gradient(135deg,#0c2d31 0%,#092126 100%)",
      opacity: "0",
      transition: "opacity 280ms ease",
      pointerEvents: "none",
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = "1"; });
  }, { kicker, title, body });
  await sleep(500);
}

async function hideWaitOverlay(page) {
  await page.evaluate(() => {
    const overlay = document.getElementById("sifu-video-overlay");
    if (!overlay) return;
    overlay.style.opacity = "0";
    window.setTimeout(() => overlay.remove(), 300);
  });
  await sleep(420);
}

async function petMoment(page, hold = 1800) {
  const pet = page.locator(".sifu-pet-shell");
  if (await pet.count()) {
    try {
      await pet.hover();
      await sleep(hold);
      await page.mouse.move(960, 130);
      await sleep(350);
    } catch {
      // Mascot is a visual enhancement only; never fail the demo because of it.
    }
  }
}

async function fillAndSend(page, text) {
  const composer = page.locator("textarea").last();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill(text);
  await sleep(900);
  await composer.press("Enter");
}

async function waitForExpertRoute(page) {
  const askTan = page.getByRole("button", { name: /Ask Tan/i });
  const liveError = page.getByText(/I couldn’t produce a live AI answer/i);

  await Promise.race([
    askTan.waitFor({ state: "visible", timeout: 150_000 }),
    liveError.waitFor({ state: "visible", timeout: 150_000 }).then(async () => {
      const text = await page.locator(".sifu-message").last().innerText().catch(() => "Live Sifu request failed.");
      throw new Error(`Live Sifu request failed before expert routing: ${text}`);
    }),
  ]);

  return askTan;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    slowMo: 180,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: outputDir,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();
  const video = page.video();
  let failure;

  try {
    await chapter(page, {
      kicker: "Keppel Real Estate Track · AI HARVEST",
      title: "Sifu — Expert know-how, on every shift.",
      accent: "Sifu",
      body: "Ask once. Teach forever.",
      hold: 5200,
    });

    await chapter(page, {
      kicker: "The problem",
      title: "Knowledge isn’t the problem. Losing access to expertise is.",
      accent: "expertise",
      body: "Sifu captures the judgement that never made it into the knowledge base — then keeps people in control of what becomes organisational truth.",
      hold: 5200,
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /What can I help you with/i }).waitFor();
    await sleep(2200);

    await fillAndSend(page, QUESTION);
    const askTan = await waitForExpertRoute(page);
    await sleep(2800);
    await petMoment(page, 1700);

    await askTan.scrollIntoViewIfNeeded();
    await sleep(900);
    await askTan.click();
    await page.getByText(/Expert request sent to Tan Wei Ming/i).waitFor({ timeout: 30_000 });
    await sleep(1500);
    await petMoment(page, 1700);

    await chapter(page, {
      kicker: "When Sifu doesn’t know",
      title: "It finds the person who does.",
      accent: "person",
      body: "The gap stays explicit. No invented policy, no invented expert, no silent promotion to organisational knowledge.",
      hold: 4300,
    });

    await page.goto(`${baseUrl}/?persona=expert`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Expertise requests" }).waitFor();
    const requestRow = page.locator("button.timeline-row.high").first();
    await requestRow.waitFor({ state: "visible", timeout: 30_000 });
    await sleep(1400);
    await requestRow.click();

    const expertComposer = page.locator('textarea[placeholder*="Share what you would do"]');
    await expertComposer.waitFor({ state: "visible", timeout: 30_000 });
    await expertComposer.fill(EXPERT_RESPONSE);
    await sleep(1500);
    await page.getByRole("button", { name: "Send expert response" }).click();
    await page.getByText("Sifu noticed something reusable").waitFor({ timeout: 150_000 });
    await sleep(2200);
    await petMoment(page, 1700);

    await page.getByRole("button", { name: /Review what I understood/i }).click();
    await page.getByText("Candidate Knowledge Pill", { exact: false }).waitFor({ timeout: 150_000 });
    await sleep(4000);

    await page.getByRole("button", { name: /Looks right/i }).click();
    await page.getByText(/waiting for Jennifer Lim/i).waitFor({ timeout: 30_000 });
    await sleep(2800);

    await chapter(page, {
      kicker: "Governance",
      title: "The AI never has the final say.",
      accent: "never",
      body: "AI drafts. The source expert confirms meaning. The Knowledge Owner decides whether the organisation may reuse it.",
      hold: 5000,
    });

    await page.goto(`${baseUrl}/?persona=approver`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Reviews" }).waitFor();
    const reviewRow = page.locator("button.timeline-row.high").first();
    await reviewRow.waitFor({ state: "visible", timeout: 30_000 });
    await sleep(1400);
    await reviewRow.click();
    await page.getByRole("button", { name: /Validate teaching/i }).waitFor();
    await sleep(3500);
    await page.getByRole("button", { name: /Validate teaching/i }).click();
    await page.getByRole("heading", { name: "Teaching validated" }).waitFor({ timeout: 30_000 });
    await sleep(2000);
    await petMoment(page, 1800);

    await chapter(page, {
      kicker: "Reusable intelligence",
      title: "Tan taught it once. Every shift knows.",
      accent: "Every shift knows.",
      body: "The teaching is now validated, attributable and reusable — without turning one expert conversation into unchecked policy.",
      hold: 5000,
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /What can I help you with/i }).waitFor();
    await fillAndSend(page, REUSE_QUESTION);
    await sleep(1200);
    await showWaitOverlay(page, {
      kicker: "The organisation remembers",
      title: "The next shift does not have to rediscover Tan’s judgement.",
      body: "Sifu is checking the now-validated teaching and its provenance against the new question.",
    });
    await page.getByText(/Validated organisational knowledge/i).first().waitFor({ timeout: 150_000 });
    await hideWaitOverlay(page);
    await sleep(3600);
    await petMoment(page, 1700);

    await chapter(page, {
      kicker: "Beyond Q&A",
      title: "The same knowledge can guide a live operating situation.",
      accent: "live operating situation",
      body: "Sifu carries the source, validation status and knowledge boundary into the case — not just the answer text.",
      hold: 4500,
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Cases" }).click();
    const caseRow = page.getByRole("button", { name: /Pump RUNNING while water rises/i });
    await caseRow.waitFor({ state: "visible", timeout: 30_000 });
    await sleep(1600);
    await caseRow.click();

    await page.getByRole("button", { name: "Apply Validated Knowledge" }).waitFor({ timeout: 30_000 });
    await sleep(2200);
    await page.getByRole("button", { name: "Apply Validated Knowledge" }).click();
    await sleep(1000);
    await showWaitOverlay(page, {
      kicker: "Case guidance",
      title: "Applying validated organisational knowledge to Harbour Exchange.",
      body: "The answer must stay inside what Tan taught, Jennifer validated and the current readings support.",
    });
    await page.getByText("ESCALATE", { exact: true }).waitFor({ timeout: 150_000 });
    await hideWaitOverlay(page);
    await sleep(3000);
    await petMoment(page, 1600);

    const provenanceCard = page.locator(".pill-provenance").first();
    await provenanceCard.scrollIntoViewIfNeeded();
    await page.getByText("Tan Wei Ming", { exact: true }).last().waitFor({ timeout: 30_000 });
    await page.getByText("Jennifer Lim", { exact: true }).last().waitFor({ timeout: 30_000 });
    await sleep(6200);

    await chapter(page, {
      kicker: "Sifu",
      title: "Expert know-how, on every shift.",
      accent: "on every shift.",
      body: "Capture what was never written down. Validate it with people. Reuse it with provenance and clear boundaries.",
      hold: 7000,
    });
  } catch (error) {
    failure = error;
    console.error("Demo recording failed:", error);
    try {
      await chapter(page, {
        kicker: "Recording stopped",
        title: "A demo step failed before completion.",
        accent: "failed",
        body: String(error?.message ?? error),
        hold: 3000,
      });
    } catch {
      // Preserve the partial recording even if the error card cannot render.
    }
  } finally {
    await context.close();
    if (video) await video.saveAs(outputPath);
    await browser.close();
  }

  console.log(`Saved demo recording to ${outputPath}`);
  if (failure) process.exitCode = 1;
}

await main();
