import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outputDir = path.resolve(repoRoot, "artifacts/video");
const outputPath = path.join(outputDir, "Sifu_DemoDay_Take2.webm");
const baseUrl = process.env.SIFU_DEMO_URL ?? "http://127.0.0.1:5173";

const QUESTION =
  "The sump pump says RUNNING but the basement water level is still rising. Does RUNNING mean it's actually draining?";
const EXPERT_RESPONSE =
  "RUNNING only confirms the pump has been commanded to run or that the motor status is active. It does not prove water is actually being discharged. Check for actual flow at the discharge outlet and monitor the water-level trend. If the pump shows RUNNING but the water level continues to rise, escalate because the pump may not be removing water effectively.";
const REUSE_QUESTION =
  "The sump pump is showing RUNNING, but the water level keeps rising. What should I do?";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function chapter(page, { kicker, title, accent, body, hold = 3600 }) {
  await page.setContent(`<!doctype html>
  <html><head><meta charset="utf-8" />
  <style>
    *{box-sizing:border-box} html,body{margin:0;width:100%;height:100%}
    body{display:grid;place-items:center;background:radial-gradient(circle at 78% 18%,rgba(61,191,177,.14),transparent 34%),linear-gradient(135deg,#0c2d31 0%,#092126 100%);color:#f7f3e9;font-family:Arial,Helvetica,sans-serif;overflow:hidden}
    .frame{width:84%;max-width:1460px;animation:in .7s cubic-bezier(.2,.8,.2,1) both}
    .kicker{margin-bottom:26px;color:#77cfc5;font-size:20px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
    h1{max-width:1260px;margin:0;font-family:Georgia,'Times New Roman',serif;font-size:86px;line-height:1.02;letter-spacing:-.035em;font-weight:700}
    h1 em{color:#76d6ca;font-style:normal}
    p{max-width:980px;margin:34px 0 0;color:#c6d6d2;font-size:28px;line-height:1.5}
    .rule{width:82px;height:6px;margin-top:44px;border-radius:999px;background:#50c9b9;animation:rule .9s .35s both}
    .brand{position:fixed;left:8%;bottom:62px;color:rgba(247,243,233,.7);font-size:18px;letter-spacing:.13em;text-transform:uppercase}
    @keyframes in{from{opacity:0;transform:translateY(28px) scale(.99)}to{opacity:1;transform:none}}
    @keyframes rule{from{width:0;opacity:.2}to{width:82px;opacity:1}}
  </style></head><body>
    <main class="frame"><div class="kicker">${kicker}</div><h1>${title.replace(accent, `<em>${accent}</em>`)}</h1>${body ? `<p>${body}</p>` : ""}<div class="rule"></div></main>
    <div class="brand">SIFU · AI HARVEST</div>
  </body></html>`);
  await sleep(hold);
}

async function installCinematicLayer(page) {
  await page.addStyleTag({ content: `
    #take2-stage{position:fixed;inset:0;z-index:2147483600;pointer-events:none;overflow:hidden}
    #take2-focus{position:absolute;border:3px solid rgba(80,201,185,.98);border-radius:20px;box-shadow:0 0 0 9999px rgba(8,27,29,.16),0 0 0 8px rgba(80,201,185,.12),0 20px 60px rgba(0,0,0,.16);opacity:0;transition:all .5s cubic-bezier(.2,.8,.2,1),opacity .25s ease}
    #take2-focus.on{opacity:1}
    #take2-caption{position:absolute;left:50%;bottom:48px;transform:translate(-50%,14px);padding:15px 23px;background:rgba(12,45,49,.94);color:#fff;border-radius:16px;font:700 20px/1.25 Arial,sans-serif;box-shadow:0 14px 50px rgba(0,0,0,.2);opacity:0;transition:opacity .28s ease,transform .28s ease;white-space:nowrap}
    #take2-caption.on{opacity:1;transform:translate(-50%,0)}
    .take2-ripple{position:fixed;width:16px;height:16px;border:3px solid #50c9b9;border-radius:50%;transform:translate(-50%,-50%);animation:take2Ripple .65s ease-out forwards;z-index:2147483646;pointer-events:none}
    @keyframes take2Ripple{from{opacity:1;width:16px;height:16px}to{opacity:0;width:86px;height:86px}}
    #root{transition:transform .72s cubic-bezier(.2,.8,.2,1)}
  `});
  await page.evaluate(() => {
    if (document.getElementById("take2-stage")) return;
    const stage = document.createElement("div");
    stage.id = "take2-stage";
    stage.innerHTML = `<div id="take2-focus"></div><div id="take2-caption"></div>`;
    document.body.appendChild(stage);
  });
}

async function caption(page, text, hold = 1500) {
  await page.evaluate((text) => {
    const c = document.getElementById("take2-caption");
    if (!c) return;
    c.textContent = text;
    c.classList.add("on");
  }, text);
  await sleep(hold);
  await page.evaluate(() => document.getElementById("take2-caption")?.classList.remove("on"));
}

async function focus(page, locator, pad = 16) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(({ box, pad }) => {
    const f = document.getElementById("take2-focus");
    if (!f) return;
    Object.assign(f.style, {
      left: `${box.x - pad}px`, top: `${box.y - pad}px`, width: `${box.width + pad * 2}px`, height: `${box.height + pad * 2}px`,
    });
    f.classList.add("on");
  }, { box, pad });
}

async function unfocus(page) {
  await page.evaluate(() => document.getElementById("take2-focus")?.classList.remove("on"));
}

async function cameraTo(page, locator, scale = 1.16) {
  const box = await locator.boundingBox();
  if (!box) return;
  const vp = page.viewportSize();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = vp.width / 2 - cx;
  const dy = vp.height / 2 - cy;
  await page.evaluate(({ scale, dx, dy }) => {
    const root = document.querySelector("#root");
    if (!root) return;
    root.style.transformOrigin = "center center";
    root.style.transform = `translate(${dx / scale}px, ${dy / scale}px) scale(${scale})`;
  }, { scale, dx, dy });
  await sleep(800);
}

async function cameraReset(page) {
  await page.evaluate(() => {
    const root = document.querySelector("#root");
    if (root) root.style.transform = "translate(0,0) scale(1)";
  });
  await sleep(650);
}

async function ripple(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(({ x, y }) => {
    const r = document.createElement("div");
    r.className = "take2-ripple";
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 800);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

async function focusClick(page, locator, { scale = 1.12, hold = 650 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  await focus(page, locator, 14);
  await cameraTo(page, locator, scale);
  await sleep(350);
  await ripple(page, locator);
  await locator.click();
  await sleep(hold);
  await unfocus(page);
  await cameraReset(page);
}

async function openApp(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await installCinematicLayer(page);
}

async function typeAndSend(page, text, { delay = 34, captionText } = {}) {
  const composer = page.locator("textarea").last();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await focus(page, composer, 20);
  await cameraTo(page, composer, 1.18);
  if (captionText) await caption(page, captionText, 1400);
  await composer.click();
  await composer.fill("");
  await composer.type(text, { delay });
  await sleep(650);
  await composer.press("Enter");
  await sleep(650);
  await unfocus(page);
  await cameraReset(page);
}

async function typeExpertResponse(page, text) {
  const composer = page.locator('textarea[placeholder*="Share what you would do"]');
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await focus(page, composer, 20);
  await cameraTo(page, composer, 1.16);
  await caption(page, "The expert teaches naturally. Sifu handles the structuring.", 1500);
  await composer.click();
  await composer.fill("");
  await composer.type(text, { delay: 20 });
  await sleep(650);
  const send = page.getByRole("button", { name: "Send expert response" });
  await ripple(page, send);
  await send.click();
  await sleep(900);
  await unfocus(page);
  await cameraReset(page);
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

async function petMoment(page, hold = 1300) {
  const pet = page.locator(".sifu-pet-shell");
  if (await pet.count()) {
    try {
      await pet.hover();
      await sleep(hold);
      await page.mouse.move(960, 120);
      await sleep(250);
    } catch {}
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: outputDir, size: { width: 1920, height: 1080 } },
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
      hold: 4300,
    });

    await chapter(page, {
      kicker: "The problem",
      title: "Knowledge isn’t the problem. Losing access to expertise is.",
      accent: "expertise",
      body: "Sifu captures judgement that never made it into the knowledge base — then keeps people in control of what becomes organisational truth.",
      hold: 4300,
    });

    await openApp(page, baseUrl);
    await page.getByRole("heading", { name: /What can I help you with/i }).waitFor();
    await sleep(1200);
    await typeAndSend(page, QUESTION, {
      delay: 34,
      captionText: "Amanda asks Sifu instead of searching documents or messaging around.",
    });

    await caption(page, "Sifu checks validated organisational knowledge first.", 1700);
    const askTan = await waitForExpertRoute(page);
    await focus(page, askTan, 14);
    await cameraTo(page, askTan, 1.15);
    await sleep(1300);
    await ripple(page, askTan);
    await askTan.click();
    await page.getByText(/Expert request sent to Tan Wei Ming/i).waitFor({ timeout: 30_000 });
    await sleep(900);
    await unfocus(page);
    await cameraReset(page);
    await petMoment(page);

    await chapter(page, {
      kicker: "When Sifu doesn’t know",
      title: "It finds the person who does.",
      accent: "person",
      body: "The gap stays explicit. No invented policy, no invented expert, no silent promotion to organisational knowledge.",
      hold: 3400,
    });

    await openApp(page, `${baseUrl}/?persona=expert`);
    await page.getByRole("heading", { name: "Expertise requests" }).waitFor();
    const requestRow = page.locator("button.timeline-row.high").first();
    await requestRow.waitFor({ state: "visible", timeout: 30_000 });
    await caption(page, "Tan receives the expertise request with its context and timestamp.", 1400);
    await focusClick(page, requestRow, { scale: 1.1 });

    await typeExpertResponse(page, EXPERT_RESPONSE);
    await page.getByText("Sifu noticed something reusable").waitFor({ timeout: 150_000 });
    await sleep(1400);
    await petMoment(page);

    const reviewUnderstanding = page.getByRole("button", { name: /Review what I understood/i });
    await focusClick(page, reviewUnderstanding, { scale: 1.14 });
    await page.getByText("Candidate Knowledge Pill", { exact: false }).waitFor({ timeout: 150_000 });
    await caption(page, "Sifu converts natural expert teaching into a reviewable candidate.", 1700);
    await sleep(900);

    const looksRight = page.getByRole("button", { name: /Looks right/i });
    await focusClick(page, looksRight, { scale: 1.12 });
    await page.getByText(/waiting for Jennifer Lim/i).waitFor({ timeout: 30_000 });
    await sleep(1400);

    await chapter(page, {
      kicker: "Governance",
      title: "The AI never has the final say.",
      accent: "never",
      body: "AI drafts. The source expert confirms meaning. The Knowledge Owner decides whether the organisation may reuse it.",
      hold: 3900,
    });

    await openApp(page, `${baseUrl}/?persona=approver`);
    await page.getByRole("heading", { name: "Reviews" }).waitFor();
    const reviewRow = page.locator("button.timeline-row.high").first();
    await reviewRow.waitFor({ state: "visible", timeout: 30_000 });
    await focusClick(page, reviewRow, { scale: 1.1 });
    const validate = page.getByRole("button", { name: /Validate teaching/i });
    await validate.waitFor();
    await caption(page, "Jennifer verifies the meaning, guardrails and provenance.", 1600);
    await focusClick(page, validate, { scale: 1.15 });
    await page.getByRole("heading", { name: "Teaching validated" }).waitFor({ timeout: 30_000 });
    await petMoment(page);

    await chapter(page, {
      kicker: "Reusable intelligence",
      title: "Tan taught it once. Every shift knows.",
      accent: "Every shift knows.",
      body: "The teaching is now validated, attributable and reusable — without turning one expert conversation into unchecked policy.",
      hold: 3900,
    });

    await openApp(page, baseUrl);
    await page.getByRole("heading", { name: /What can I help you with/i }).waitFor();
    await typeAndSend(page, REUSE_QUESTION, {
      delay: 32,
      captionText: "Now Amanda asks the same operational question in a different way.",
    });
    await page.getByText(/Validated organisational knowledge/i).first().waitFor({ timeout: 150_000 });
    const validated = page.getByText(/Validated organisational knowledge/i).first();
    await focus(page, validated, 20);
    await cameraTo(page, validated, 1.12);
    await caption(page, "The next shift gets validated knowledge — with provenance, not a one-off answer.", 2100);
    await unfocus(page);
    await cameraReset(page);
    await petMoment(page);

    await chapter(page, {
      kicker: "Beyond Q&A",
      title: "The same knowledge can guide a live operating situation.",
      accent: "live operating situation",
      body: "Sifu carries the source, validation status and knowledge boundary into the case — not just the answer text.",
      hold: 3600,
    });

    await openApp(page, baseUrl);
    const cases = page.getByRole("button", { name: "Cases" });
    await focusClick(page, cases, { scale: 1.09 });
    const caseRow = page.getByRole("button", { name: /Pump RUNNING while water rises/i });
    await caseRow.waitFor({ state: "visible", timeout: 30_000 });
    await focusClick(page, caseRow, { scale: 1.12 });

    const apply = page.getByRole("button", { name: "Apply Validated Knowledge" });
    await apply.waitFor({ timeout: 30_000 });
    await caption(page, "Harbour Exchange: pump RUNNING, water still rising.", 1500);
    await focusClick(page, apply, { scale: 1.16 });
    const escalate = page.getByText("ESCALATE", { exact: true });
    await escalate.waitFor({ timeout: 150_000 });
    await focus(page, escalate, 28);
    await cameraTo(page, escalate, 1.22);
    await caption(page, "Validated organisational knowledge becomes a bounded operational decision.", 2200);
    await unfocus(page);
    await cameraReset(page);

    const provenanceCard = page.locator(".pill-provenance").first();
    await provenanceCard.scrollIntoViewIfNeeded();
    await page.getByText("Tan Wei Ming", { exact: true }).last().waitFor({ timeout: 30_000 });
    await page.getByText("Jennifer Lim", { exact: true }).last().waitFor({ timeout: 30_000 });
    await focus(page, provenanceCard, 18);
    await cameraTo(page, provenanceCard, 1.13);
    await caption(page, "Expert: Tan Wei Ming · Validated by: Jennifer Lim", 2100);
    await unfocus(page);
    await cameraReset(page);

    await chapter(page, {
      kicker: "Sifu",
      title: "Expert know-how, on every shift.",
      accent: "on every shift.",
      body: "Capture what was never written down. Validate it with people. Reuse it with provenance and clear boundaries.",
      hold: 5600,
    });
  } catch (error) {
    failure = error;
    console.error("Take 2 recording failed:", error);
    try {
      await page.screenshot({ path: path.join(outputDir, "take2-failure.png"), fullPage: true });
    } catch {}
    try {
      await chapter(page, {
        kicker: "Recording stopped",
        title: "A Take 2 step failed before completion.",
        accent: "failed",
        body: String(error?.message ?? error),
        hold: 3000,
      });
    } catch {}
  } finally {
    await context.close();
    if (video) await video.saveAs(outputPath);
    await browser.close();
  }

  console.log(`Saved Take 2 recording to ${outputPath}`);
  if (failure) process.exitCode = 1;
}

await main();
