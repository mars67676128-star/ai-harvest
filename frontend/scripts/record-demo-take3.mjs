import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outputDir = path.resolve(repoRoot, "artifacts/video");
const outputPath = path.join(outputDir, "Sifu_DemoDay_Take3.webm");
const baseUrl = process.env.SIFU_DEMO_URL ?? "http://127.0.0.1:5173";

const QUESTION =
  "The sump pump says RUNNING but the basement water level is still rising. Does RUNNING mean it's actually draining?";
const EXPERT_RESPONSE =
  "RUNNING only confirms the pump has been commanded to run or that the motor status is active. It does not prove water is actually being discharged. Check for actual flow at the discharge outlet and monitor the water-level trend. If the pump shows RUNNING but the water level continues to rise, escalate because the pump may not be removing water effectively.";
const REUSE_QUESTION =
  "The sump pump is showing RUNNING, but the water level keeps rising. What should I do?";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function chapter(page, { kicker, title, accent, body, hold = 2500 }) {
  await page.setContent(`<!doctype html>
  <html><head><meta charset="utf-8" />
  <style>
    *{box-sizing:border-box} html,body{margin:0;width:100%;height:100%}
    body{display:grid;place-items:center;background:radial-gradient(circle at 78% 18%,rgba(61,191,177,.14),transparent 34%),linear-gradient(135deg,#0c2d31 0%,#092126 100%);color:#f7f3e9;font-family:Arial,Helvetica,sans-serif;overflow:hidden}
    .frame{width:84%;max-width:1460px;animation:in .55s cubic-bezier(.2,.8,.2,1) both}
    .kicker{margin-bottom:22px;color:#77cfc5;font-size:20px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
    h1{max-width:1280px;margin:0;font-family:Georgia,'Times New Roman',serif;font-size:86px;line-height:1.02;letter-spacing:-.035em;font-weight:700}
    h1 em{color:#76d6ca;font-style:normal}
    p{max-width:1000px;margin:30px 0 0;color:#c6d6d2;font-size:28px;line-height:1.48}
    .rule{width:82px;height:6px;margin-top:38px;border-radius:999px;background:#50c9b9;animation:rule .72s .22s both}
    .brand{position:fixed;left:8%;bottom:56px;color:rgba(247,243,233,.68);font-size:18px;letter-spacing:.13em;text-transform:uppercase}
    @keyframes in{from{opacity:0;transform:translateY(24px) scale(.992)}to{opacity:1;transform:none}}
    @keyframes rule{from{width:0;opacity:.2}to{width:82px;opacity:1}}
  </style></head><body>
    <main class="frame"><div class="kicker">${kicker}</div><h1>${title.replace(accent, `<em>${accent}</em>`)}</h1>${body ? `<p>${body}</p>` : ""}<div class="rule"></div></main>
    <div class="brand">SIFU · AI HARVEST</div>
  </body></html>`);
  await sleep(hold);
}

async function installCinematicLayer(page) {
  await page.addStyleTag({ content: `
    #take3-stage{position:fixed;inset:0;z-index:2147483600;pointer-events:none;overflow:hidden}
    #take3-focus{position:absolute;border:3px solid rgba(80,201,185,.98);border-radius:20px;box-shadow:0 0 0 9999px rgba(8,27,29,.13),0 0 0 8px rgba(80,201,185,.1),0 20px 60px rgba(0,0,0,.16);opacity:0;transition:all .38s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
    #take3-focus.on{opacity:1}
    #take3-focus.impact{border-color:#df6c63;box-shadow:0 0 0 9999px rgba(8,27,29,.24),0 0 0 10px rgba(223,108,99,.15),0 24px 74px rgba(0,0,0,.25)}
    #take3-caption{position:absolute;left:50%;bottom:42px;transform:translate(-50%,12px);padding:14px 22px;background:rgba(12,45,49,.94);color:#fff;border-radius:15px;font:700 20px/1.25 Arial,sans-serif;box-shadow:0 14px 50px rgba(0,0,0,.2);opacity:0;transition:opacity .22s ease,transform .22s ease;white-space:nowrap}
    #take3-caption.on{opacity:1;transform:translate(-50%,0)}
    #take3-bridge{position:absolute;inset:0;display:grid;place-items:center;background:rgba(9,33,38,.93);opacity:0;transition:opacity .28s ease}
    #take3-bridge.on{opacity:1}
    #take3-bridge-card{width:min(1180px,82vw);transform:translateY(18px);transition:transform .35s cubic-bezier(.2,.8,.2,1);font-family:Arial,Helvetica,sans-serif;color:#f7f3e9}
    #take3-bridge.on #take3-bridge-card{transform:none}
    #take3-bridge-kicker{font-size:18px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#77cfc5;margin-bottom:20px}
    #take3-bridge-title{font-family:Georgia,'Times New Roman',serif;font-size:66px;line-height:1.04;font-weight:700;max-width:1050px}
    #take3-bridge-body{font-size:25px;line-height:1.46;color:#c6d6d2;margin-top:24px;max-width:900px}
    #take3-dots{display:flex;gap:10px;margin-top:32px}.take3-dot{width:10px;height:10px;border-radius:50%;background:#50c9b9;animation:take3Dot 1.1s infinite ease-in-out}.take3-dot:nth-child(2){animation-delay:.14s}.take3-dot:nth-child(3){animation-delay:.28s}
    .take3-ripple{position:fixed;width:16px;height:16px;border:3px solid #50c9b9;border-radius:50%;transform:translate(-50%,-50%);animation:take3Ripple .55s ease-out forwards;z-index:2147483646;pointer-events:none}
    #take3-flash{position:absolute;inset:0;background:rgba(192,67,57,.18);opacity:0}
    #take3-flash.on{animation:take3Flash .58s ease-out}
    @keyframes take3Ripple{from{opacity:1;width:16px;height:16px}to{opacity:0;width:76px;height:76px}}
    @keyframes take3Dot{0%,80%,100%{opacity:.28;transform:scale(.8)}40%{opacity:1;transform:scale(1.16)}}
    @keyframes take3Flash{0%{opacity:0}18%{opacity:1}100%{opacity:0}}
    #root{transition:transform .5s cubic-bezier(.2,.8,.2,1)}
    .sifu-pet-shell{pointer-events:none !important}
  `});
  await page.evaluate(() => {
    if (document.getElementById("take3-stage")) return;
    const stage = document.createElement("div");
    stage.id = "take3-stage";
    stage.innerHTML = `
      <div id="take3-focus"></div>
      <div id="take3-caption"></div>
      <div id="take3-bridge"><div id="take3-bridge-card"><div id="take3-bridge-kicker"></div><div id="take3-bridge-title"></div><div id="take3-bridge-body"></div><div id="take3-dots"><span class="take3-dot"></span><span class="take3-dot"></span><span class="take3-dot"></span></div></div></div>
      <div id="take3-flash"></div>`;
    document.body.appendChild(stage);
  });
}

async function caption(page, text, hold = 1050) {
  await page.evaluate((text) => {
    const c = document.getElementById("take3-caption");
    if (!c) return;
    c.textContent = text;
    c.classList.add("on");
  }, text);
  await sleep(hold);
  await page.evaluate(() => document.getElementById("take3-caption")?.classList.remove("on"));
}

async function bridge(page, { kicker, title, body }) {
  await page.evaluate(({ kicker, title, body }) => {
    const b = document.getElementById("take3-bridge");
    if (!b) return;
    document.getElementById("take3-bridge-kicker").textContent = kicker;
    document.getElementById("take3-bridge-title").textContent = title;
    document.getElementById("take3-bridge-body").textContent = body;
    b.classList.add("on");
  }, { kicker, title, body });
  await sleep(320);
}

async function unbridge(page) {
  await page.evaluate(() => document.getElementById("take3-bridge")?.classList.remove("on"));
  await sleep(260);
}

async function focus(page, locator, pad = 16, impact = false) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(({ box, pad, impact }) => {
    const f = document.getElementById("take3-focus");
    if (!f) return;
    Object.assign(f.style, {
      left: `${box.x - pad}px`, top: `${box.y - pad}px`, width: `${box.width + pad * 2}px`, height: `${box.height + pad * 2}px`,
    });
    f.classList.toggle("impact", impact);
    f.classList.add("on");
  }, { box, pad, impact });
}

async function unfocus(page) {
  await page.evaluate(() => {
    const f = document.getElementById("take3-focus");
    f?.classList.remove("on", "impact");
  });
}

async function cameraToBox(page, box, scale = 1.16, settle = 560) {
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
  await sleep(settle);
}

async function cameraTo(page, locator, scale = 1.16, settle = 560) {
  const box = await locator.boundingBox();
  return cameraToBox(page, box, scale, settle);
}

async function cameraReset(page, settle = 400) {
  await page.evaluate(() => {
    const root = document.querySelector("#root");
    if (root) root.style.transform = "translate(0,0) scale(1)";
  });
  await sleep(settle);
}

async function ripple(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(({ x, y }) => {
    const r = document.createElement("div");
    r.className = "take3-ripple";
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 650);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

async function impactFlash(page) {
  await page.evaluate(() => {
    const el = document.getElementById("take3-flash");
    if (!el) return;
    el.classList.remove("on");
    void el.offsetWidth;
    el.classList.add("on");
  });
  await sleep(300);
}

async function focusClick(page, locator, { scale = 1.14, hold = 430, impact = false } = {}) {
  await locator.scrollIntoViewIfNeeded();
  await cameraTo(page, locator, scale);
  await focus(page, locator, impact ? 22 : 14, impact);
  await ripple(page, locator);
  if (impact) await impactFlash(page);
  await locator.click();
  await sleep(hold);
  await unfocus(page);
  await cameraReset(page);
}

async function openApp(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await installCinematicLayer(page);
}

async function progressiveType(page, composer, text, { delay = 26, captionText } = {}) {
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.scrollIntoViewIfNeeded();
  const anchorBox = await composer.boundingBox();
  await cameraToBox(page, anchorBox, 1.18);
  await focus(page, composer, 20);
  if (captionText) await caption(page, captionText, 950);
  await composer.evaluate((el) => el.focus());
  await composer.fill("");
  const a = Math.floor(text.length * 0.38);
  const b = Math.floor(text.length * 0.74);
  await composer.type(text.slice(0, a), { delay });
  await cameraToBox(page, anchorBox, 1.23, 420);
  await focus(page, composer, 20);
  await composer.type(text.slice(a, b), { delay: Math.max(16, delay - 4) });
  await cameraToBox(page, anchorBox, 1.27, 420);
  await focus(page, composer, 20);
  await composer.type(text.slice(b), { delay: Math.max(14, delay - 7) });
}

async function typeAndSend(page, text, { delay = 26, captionText } = {}) {
  const composer = page.locator("textarea").last();
  await progressiveType(page, composer, text, { delay, captionText });
  await sleep(350);
  await composer.press("Enter");
  await sleep(420);
  await unfocus(page);
  await cameraReset(page);
}

async function typeExpertResponse(page, text) {
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
}

async function waitForExpertRoute(page) {
  const askTan = page.getByRole("button", { name: /Ask Tan/i });
  const liveError = page.getByText(/I couldn’t produce a live AI answer/i);
  const wait = Promise.race([
    askTan.waitFor({ state: "visible", timeout: 150_000 }).then(() => ({ ok: true })),
    liveError.waitFor({ state: "visible", timeout: 150_000 }).then(async () => {
      const text = await page.locator(".sifu-message").last().innerText().catch(() => "Live Sifu request failed.");
      throw new Error(`Live Sifu request failed before expert routing: ${text}`);
    }),
  ]);
  await bridge(page, {
    kicker: "SIFU IS CHECKING",
    title: "Validated knowledge first. Human expertise when needed.",
    body: "No invented policy. No invented expert. The gap stays explicit until there is a grounded next step.",
  });
  await wait;
  await unbridge(page);
  return askTan;
}

async function waitWithBridge(page, waitPromise, card) {
  await bridge(page, card);
  await waitPromise;
  await unbridge(page);
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
      hold: 3000,
    });

    await chapter(page, {
      kicker: "The problem",
      title: "Knowledge isn’t the problem. Losing access to expertise is.",
      accent: "expertise",
      body: "Sifu captures judgement that never made it into the knowledge base — then keeps people in control of what becomes organisational truth.",
      hold: 3100,
    });

    await openApp(page, baseUrl);
    await page.getByRole("heading", { name: /What can I help you with/i }).waitFor();
    await sleep(700);
    await typeAndSend(page, QUESTION, {
      delay: 26,
      captionText: "Amanda asks the real operational question.",
    });

    const askTan = await waitForExpertRoute(page);
    await cameraTo(page, askTan, 1.23);
    await focus(page, askTan, 18);
    await caption(page, "Sifu found the right human expert.", 850);
    await ripple(page, askTan);
    await askTan.click();
    await page.getByText(/Expert request sent to Tan Wei Ming/i).waitFor({ timeout: 30_000 });
    await sleep(500);
    await unfocus(page);
    await cameraReset(page);

    await chapter(page, {
      kicker: "When Sifu doesn’t know",
      title: "It finds the person who does.",
      accent: "person",
      body: "The knowledge gap becomes a routed expertise request — not a hallucinated answer.",
      hold: 2300,
    });

    await openApp(page, `${baseUrl}/?persona=expert`);
    await page.getByRole("heading", { name: "Expertise requests" }).waitFor();
    const requestRow = page.locator("button.timeline-row.high").first();
    await requestRow.waitFor({ state: "visible", timeout: 30_000 });
    await focusClick(page, requestRow, { scale: 1.16, hold: 300 });

    await typeExpertResponse(page, EXPERT_RESPONSE);
    await waitWithBridge(
      page,
      page.getByText("Sifu noticed something reusable").waitFor({ timeout: 150_000 }),
      {
        kicker: "FROM TACIT TO REUSABLE",
        title: "Sifu listens for the judgement hidden inside the answer.",
        body: "The expert still owns the meaning. Sifu only proposes a structured candidate for review.",
      },
    );
    await sleep(450);

    const reviewUnderstanding = page.getByRole("button", { name: /Review what I understood/i });
    await focusClick(page, reviewUnderstanding, { scale: 1.18, hold: 300 });
    const candidateTitle = page.getByText("Candidate Knowledge Pill", { exact: false });
    await candidateTitle.waitFor({ timeout: 150_000 });
    await cameraTo(page, candidateTitle, 1.17);
    await focus(page, candidateTitle, 18);
    await caption(page, "Natural teaching becomes a reviewable candidate.", 900);
    await unfocus(page);
    await cameraReset(page);

    const looksRight = page.getByRole("button", { name: /Looks right/i });
    await focusClick(page, looksRight, { scale: 1.18, hold: 300 });
    await page.getByText(/waiting for Jennifer Lim/i).waitFor({ timeout: 30_000 });
    await sleep(550);

    await chapter(page, {
      kicker: "Governance",
      title: "AI proposes. Humans validate.",
      accent: "Humans validate.",
      body: "Tan confirms the teaching. Jennifer decides whether the organisation may reuse it.",
      hold: 2500,
    });

    await openApp(page, `${baseUrl}/?persona=approver`);
    await page.getByRole("heading", { name: "Reviews" }).waitFor();
    const reviewRow = page.locator("button.timeline-row.high").first();
    await reviewRow.waitFor({ state: "visible", timeout: 30_000 });
    await focusClick(page, reviewRow, { scale: 1.15, hold: 280 });
    const validate = page.getByRole("button", { name: /Validate teaching/i });
    await validate.waitFor();
    await focusClick(page, validate, { scale: 1.22, hold: 350 });
    const validatedHeading = page.getByRole("heading", { name: "Teaching validated" });
    await validatedHeading.waitFor({ timeout: 30_000 });
    await cameraTo(page, validatedHeading, 1.22);
    await focus(page, validatedHeading, 22);
    await caption(page, "Validated. Attributable. Reusable.", 900);
    await unfocus(page);
    await cameraReset(page);

    await chapter(page, {
      kicker: "Reusable intelligence",
      title: "Tan taught it once. Every shift knows.",
      accent: "Every shift knows.",
      body: "The next employee can reuse the validated lesson without starting from zero.",
      hold: 2500,
    });

    await openApp(page, baseUrl);
    await page.getByRole("heading", { name: /What can I help you with/i }).waitFor();
    await typeAndSend(page, REUSE_QUESTION, {
      delay: 23,
      captionText: "Amanda asks the same problem a different way.",
    });
    const validated = page.getByText(/Validated organisational knowledge/i).first();
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
    await cameraReset(page);

    await chapter(page, {
      kicker: "Beyond Q&A",
      title: "The lesson can guide a live operating situation.",
      accent: "live operating situation",
      body: "The same validated teaching can be applied inside an operational case with clear decision boundaries.",
      hold: 2300,
    });

    await openApp(page, baseUrl);
    const cases = page.getByRole("button", { name: "Cases" });
    await focusClick(page, cases, { scale: 1.12, hold: 260 });
    const caseRow = page.getByRole("button", { name: /Pump RUNNING while water rises/i });
    await caseRow.waitFor({ state: "visible", timeout: 30_000 });
    await focusClick(page, caseRow, { scale: 1.18, hold: 280 });

    const caseHeading = page.getByRole("heading", { name: /Harbour Exchange/i });
    if (await caseHeading.count()) {
      await cameraTo(page, caseHeading, 1.12);
      await focus(page, caseHeading, 16);
      await caption(page, "Pump RUNNING. Water still rising.", 850);
      await unfocus(page);
      await cameraReset(page);
    }

    const apply = page.getByRole("button", { name: "Apply Validated Knowledge" });
    await apply.waitFor({ timeout: 30_000 });
    await focusClick(page, apply, { scale: 1.2, hold: 300 });
    const escalate = page.getByText("ESCALATE", { exact: true });
    await waitWithBridge(
      page,
      escalate.waitFor({ timeout: 150_000 }),
      {
        kicker: "DETERMINISTIC PAYOFF",
        title: "The validated heuristic is now inside the operating decision.",
        body: "The model does not invent the outcome. The governed case logic applies the approved knowledge boundary.",
      },
    );
    await cameraTo(page, escalate, 1.34, 650);
    await focus(page, escalate, 34, true);
    await impactFlash(page);
    await caption(page, "ESCALATE — human review required.", 1550);
    await sleep(500);

    const provenanceCard = page.locator(".pill-provenance").first();
    await provenanceCard.scrollIntoViewIfNeeded();
    await page.getByText("Tan Wei Ming", { exact: true }).last().waitFor({ timeout: 30_000 });
    await page.getByText("Jennifer Lim", { exact: true }).last().waitFor({ timeout: 30_000 });
    await unfocus(page);
    await cameraReset(page, 320);
    await cameraTo(page, provenanceCard, 1.18);
    await focus(page, provenanceCard, 18);
    await caption(page, "Expert: Tan Wei Ming · Validated by: Jennifer Lim", 1100);
    await unfocus(page);
    await cameraReset(page);

    await chapter(page, {
      kicker: "Sifu",
      title: "Ask once. Teach forever.",
      accent: "Teach forever.",
      body: "Expert know-how, validated by people and reusable on every shift.",
      hold: 3800,
    });
  } catch (error) {
    failure = error;
    console.error("Take 3 recording failed:", error);
    try {
      await page.screenshot({ path: path.join(outputDir, "take3-failure.png"), fullPage: true });
    } catch {}
    try {
      await chapter(page, {
        kicker: "Recording stopped",
        title: "A Take 3 step failed before completion.",
        accent: "failed",
        body: String(error?.message ?? error),
        hold: 2200,
      });
    } catch {}
  } finally {
    await context.close();
    if (video) await video.saveAs(outputPath);
    await browser.close();
  }

  console.log(`Saved Take 3 recording to ${outputPath}`);
  if (failure) process.exitCode = 1;
}

await main();
