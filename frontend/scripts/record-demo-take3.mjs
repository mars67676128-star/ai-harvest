import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const BASE = process.env.SIFU_DEMO_URL || 'http://127.0.0.1:5173';
const VIDEO_DIR = process.env.SIFU_VIDEO_DIR || path.resolve('../artifacts/video');
const OUT_NAME = 'Sifu_DemoDay_Take3.webm';
const FAILURE_SHOT = path.join(VIDEO_DIR, 'take3-failure.png');
const DIAGNOSTICS = path.join(VIDEO_DIR, 'take3-diagnostics.txt');

const QUESTION_1 = "The sump pump says RUNNING but the basement water level is still rising. Does RUNNING mean it's actually draining?";
const EXPERT_REPLY = "RUNNING may only indicate the command or motor state. It does not prove the pump is actually discharging water. Check actual discharge and the water-level trend. If the pump shows RUNNING but the water level continues to rise, escalate.";
const QUESTION_2 = "My sump pump is showing RUNNING, but the water level keeps going up. What should I do?";

fs.mkdirSync(VIDEO_DIR, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = (page) => page.locator('#root');

async function addTake3Layer(page) {
  await page.addStyleTag({ content: `
    body.take3-camera #root { transition: transform .62s cubic-bezier(.22,.75,.25,1); }
    #take3-story {
      position: fixed; inset: 0; z-index: 2147483640; pointer-events: none;
      display: flex; align-items: center; opacity: 0;
      background: linear-gradient(120deg,#113a3b 0%,#123e3e 55%,#0d3133 100%);
      transition: opacity .38s ease;
    }
    #take3-story.on { opacity: 1; }
    #take3-story-copy {
      width: min(1040px, calc(100% - 160px)); margin-left: 92px; color: #fff;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
    #take3-kicker {
      margin-bottom: 18px; color: #8fd8ca; font-size: 18px; font-weight: 750;
      letter-spacing: .15em; text-transform: uppercase;
    }
    #take3-head {
      max-width: 980px; font-size: 62px; line-height: 1.03; font-weight: 760;
      letter-spacing: -.04em;
    }
    #take3-sub {
      max-width: 930px; margin-top: 24px; color: #d7ebe6; font-size: 25px;
      line-height: 1.48;
    }
    #take3-note {
      position: fixed; left: 50%; bottom: 42px; z-index: 2147483641;
      transform: translateX(-50%) translateY(10px); width: min(980px, calc(100% - 120px));
      color: #173f40; font: 700 22px/1.35 Inter,system-ui,sans-serif; text-align: center;
      text-shadow: 0 1px 0 rgba(255,255,255,.9), 0 0 16px rgba(255,255,255,.95);
      opacity: 0; transition: opacity .28s ease, transform .28s ease; pointer-events:none;
    }
    #take3-note.on { opacity: 1; transform: translateX(-50%) translateY(0); }
    .take3-ripple {
      position: fixed; z-index:2147483642; width:14px; height:14px; border:3px solid #5ac5b1;
      border-radius:50%; transform:translate(-50%,-50%); pointer-events:none;
      animation:take3Ripple .55s ease-out forwards;
    }
    @keyframes take3Ripple { to { width:62px; height:62px; opacity:0; } }
    .sifu-pet-shell {
      right: 12px !important; bottom: 10px !important; transform: scale(.80) !important;
      transform-origin: bottom right !important;
    }
    .sifu-pet-thought { display:none !important; }
  `});

  await page.evaluate(() => {
    if (document.getElementById('take3-story')) return;
    const story = document.createElement('div');
    story.id = 'take3-story';
    story.innerHTML = '<div id="take3-story-copy"><div id="take3-kicker"></div><div id="take3-head"></div><div id="take3-sub"></div></div>';
    const note = document.createElement('div');
    note.id = 'take3-note';
    document.body.appendChild(story);
    document.body.appendChild(note);
  });
}

async function story(page, kicker, head, sub, hold = 3000) {
  await page.evaluate(({ kicker, head, sub }) => {
    document.getElementById('take3-kicker').textContent = kicker;
    document.getElementById('take3-head').textContent = head;
    document.getElementById('take3-sub').textContent = sub;
    document.getElementById('take3-story').classList.add('on');
  }, { kicker, head, sub });
  await sleep(hold);
  await page.evaluate(() => document.getElementById('take3-story')?.classList.remove('on'));
  await sleep(500);
}

async function note(page, text, hold = 2600) {
  await page.evaluate((text) => {
    const el = document.getElementById('take3-note');
    el.textContent = text;
    el.classList.add('on');
  }, text);
  await sleep(hold);
  await page.evaluate(() => document.getElementById('take3-note')?.classList.remove('on'));
  await sleep(250);
}

async function zoomTo(page, locator, scale = 1.13) {
  const box = await locator.boundingBox();
  if (!box) return;
  const vp = page.viewportSize();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = vp.width / 2 - cx;
  const dy = vp.height / 2 - cy;
  await page.evaluate(({ scale, dx, dy }) => {
    const app = document.querySelector('#root');
    if (!app) return;
    document.body.classList.add('take3-camera');
    app.style.transformOrigin = 'center center';
    app.style.transform = `translate(${dx/scale}px, ${dy/scale}px) scale(${scale})`;
  }, { scale, dx, dy });
  await sleep(700);
}

async function resetZoom(page) {
  await page.evaluate(() => {
    const app = document.querySelector('#root');
    if (app) app.style.transform = 'translate(0,0) scale(1)';
  });
  await sleep(650);
}

async function ripple(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(({ x, y }) => {
    const el = document.createElement('div');
    el.className = 'take3-ripple';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 650);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

function locators(page, specs) {
  const app = root(page);
  return specs.map((s) => {
    if (s.type === 'role') return app.getByRole(s.role, { name: s.name });
    if (s.type === 'text') return app.getByText(s.text, { exact: s.exact ?? false });
    if (s.type === 'placeholder') return app.getByPlaceholder(s.text);
    return app.locator(s.css);
  });
}

async function firstVisible(page, specs, timeout = 6500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const locator of locators(page, specs)) {
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const item = locator.nth(i);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    await sleep(150);
  }
  return null;
}

async function clickFirst(page, specs, { optional = false, hold = 700 } = {}) {
  const target = await firstVisible(page, specs);
  if (!target) {
    if (optional) return null;
    throw new Error(`Could not find target: ${JSON.stringify(specs)}`);
  }
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await ripple(page, target);
  await sleep(180);
  await target.click();
  await sleep(hold);
  return target;
}

async function openPersona(page, persona) {
  const u = new URL(BASE);
  u.searchParams.set('persona', persona);
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await sleep(900);
  await addTake3Layer(page);
}

async function openOperator(page) {
  await openPersona(page, 'operator');
  await clickFirst(page, [
    { type:'role', role:'button', name:/^ask sifu$/i },
    { type:'text', text:/^Ask Sifu$/i, exact:true },
  ], { optional:true, hold:500 });
}

async function findComposer(page) {
  return await firstVisible(page, [
    { type:'placeholder', text:'Ask Sifu about your work...' },
    { type:'css', css:'textarea[aria-label="Ask Sifu"]' },
    { type:'css', css:'textarea' },
  ], 9000);
}

async function typeHuman(locator, text, delay = 48) {
  await locator.click();
  await locator.fill('');
  for (const ch of text) {
    await locator.type(ch, { delay });
    if (/[,.?!]/.test(ch)) await sleep(80);
  }
}

async function submitComposer(page, composer) {
  const send = await firstVisible(page, [
    { type:'role', role:'button', name:/^send$/i },
    { type:'css', css:'button[type="submit"]' },
  ], 2000);
  if (send) {
    await ripple(page, send);
    await sleep(180);
    await send.click();
  } else {
    await composer.press('Enter');
  }
}

async function waitForRootText(page, pattern, timeout = 18000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const text = await root(page).innerText().catch(() => '');
    if (pattern.test(text)) return text;
    await sleep(250);
  }
  return null;
}

async function dumpDiagnostics(page, reason) {
  const data = await page.evaluate(() => ({
    url: location.href,
    text: (document.querySelector('#root')?.innerText || '').slice(0, 6000),
    buttons: [...document.querySelectorAll('#root button,#root a')]
      .filter((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length))
      .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim())
      .filter(Boolean),
  }));
  fs.writeFileSync(DIAGNOSTICS, `Reason: ${reason}\n\n${JSON.stringify(data, null, 2)}`, 'utf8');
}

async function findTanRequestWithRetry(page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await firstVisible(page, [
      { type:'css', css:'button.timeline-row.high' },
      { type:'text', text:/RUNNING|sump pump|water level/i },
    ], 3500);
    if (row) return row;
    if (attempt < 3) {
      await page.reload({ waitUntil:'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout:5000 }).catch(() => {});
      await sleep(900);
      await addTake3Layer(page);
    }
  }
  return null;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
  });

  const page = await context.newPage();
  const video = page.video();

  // Keep the real Sifu thinking state visible long enough for the audience to read it.
  await page.route('**/api/v1/sifu/**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST' && (/\/conversations(?:\/|$)/.test(url) || /\/messages(?:\/|$)/.test(url) || /\/ask(?:\?|$)/.test(url))) {
      await sleep(1700);
    }
    await route.continue();
  });

  try {
    await openOperator(page);

    await story(
      page,
      'THE PROBLEM',
      "Knowledge isn’t the problem. Losing access to expertise is.",
      'Sifu captures judgement that never made it into the knowledge base — then keeps people in control of what becomes organisational truth.',
      3800,
    );

    const q1 = await findComposer(page);
    if (!q1) throw new Error('Operator composer not found.');

    // One clean zoom for Amanda's question.
    await zoomTo(page, q1, 1.12);
    await typeHuman(q1, QUESTION_1, 48);
    await sleep(900);
    await submitComposer(page, q1);
    await sleep(450);
    await resetZoom(page);

    // Stay on the native frontend while Sifu thinks and answers.
    await waitForRootText(page, /Checking approved organisational knowledge/i, 5000);
    await sleep(1700);
    const answerSeen = await waitForRootText(page, /Knowledge gap|qualified M&E|Tan Wei Ming|does not prove/i, 20000);
    if (!answerSeen) throw new Error('Sifu answer did not appear after Amanda question.');
    await sleep(3000);

    // Routing is required. Do not advance to Tan unless the request was actually created.
    await clickFirst(page, [
      { type:'role', role:'button', name:/Ask Tan/i },
      { type:'text', text:/Ask Tan/i },
    ], { hold:1000 });

    const routeConfirmed = await waitForRootText(
      page,
      /Expert request sent to Tan Wei Ming|awaiting a human response|kept your question.*Tan Wei Ming/i,
      7000,
    );
    if (!routeConfirmed) {
      throw new Error('Tan routing click did not produce an expertise-request confirmation.');
    }
    await sleep(1400);

    await story(
      page,
      'WHEN SIFU DOESN’T KNOW',
      'It finds the person who does.',
      'The knowledge gap becomes a routed expertise request — not a hallucinated answer.',
      3000,
    );

    await openPersona(page, 'expert');
    const requestRow = await findTanRequestWithRetry(page);
    if (!requestRow) {
      throw new Error(
        'Tan request was created but is not visible to the local expert persona. In demo mode, Tan must use SIFU_EXPERT_DIRECTORY id "expert" so it matches the demo-expert authenticated actor. Restart the backend with the Take 3 demo environment and rerun.',
      );
    }
    await requestRow.click();
    await sleep(1200);

    const expertBox = await firstVisible(page, [
      { type:'placeholder', text:'Share what you would do and why…' },
      { type:'css', css:'.expert-response-composer textarea' },
    ], 7000);
    if (!expertBox) throw new Error('Expert response box not found.');

    // One clean zoom for Tan's teaching, then leave it alone.
    await zoomTo(page, expertBox, 1.10);
    await typeHuman(expertBox, EXPERT_REPLY, 36);
    await sleep(900);
    const expertSend = await firstVisible(page, [
      { type:'role', role:'button', name:/Send expert response/i },
      { type:'css', css:'.expert-response-composer button[type="submit"]' },
    ], 2500);
    if (!expertSend) throw new Error('Expert send button not found.');
    await ripple(page, expertSend);
    await expertSend.click();
    await sleep(700);
    await resetZoom(page);

    await waitForRootText(page, /Sifu noticed something reusable|Review what I understood/i, 16000);
    await sleep(2600);
    await clickFirst(page, [
      { type:'role', role:'button', name:/Review what I understood/i },
      { type:'text', text:/Review what I understood/i },
    ], { hold:1200 });
    await sleep(1800);
    await clickFirst(page, [
      { type:'role', role:'button', name:/Looks right/i },
      { type:'text', text:/Looks right/i },
    ], { hold:1200 });

    await story(
      page,
      'GOVERNANCE',
      'AI proposes. Humans validate.',
      'Tan confirms the meaning. Jennifer decides whether the organisation may reuse it.',
      3200,
    );

    await openPersona(page, 'approver');
    const reviewRow = await firstVisible(page, [
      { type:'css', css:'button.timeline-row.high' },
      { type:'text', text:/RUNNING status does not confirm|drainage|sump/i },
    ], 10000);
    if (!reviewRow) throw new Error('Knowledge Owner review not found.');
    await reviewRow.click();
    await sleep(2200);
    await clickFirst(page, [
      { type:'role', role:'button', name:/Validate teaching/i },
      { type:'text', text:/Validate teaching/i },
    ], { hold:1600 });
    await waitForRootText(page, /Teaching validated/i, 8000);
    await sleep(3000);

    await story(
      page,
      'THE PAYOFF',
      'The next shift does not start from zero.',
      'Sifu can now answer from validated organisational knowledge and preserve its provenance.',
      3200,
    );

    await openOperator(page);
    const q2 = await findComposer(page);
    if (!q2) throw new Error('Operator composer not found for reuse question.');
    await zoomTo(page, q2, 1.11);
    await typeHuman(q2, QUESTION_2, 46);
    await sleep(800);
    await submitComposer(page, q2);
    await sleep(450);
    await resetZoom(page);
    await waitForRootText(page, /Validated coverage|validated organisational knowledge|RUNNING/i, 20000);
    await sleep(3500);

    await story(
      page,
      'BEYOND Q&A',
      'The lesson can guide a live operating situation.',
      'Cases let Sifu apply validated organisational knowledge to verified readings. Here: the pump says RUNNING, water is rising 3 mm/min, critical equipment is not exposed, and the alternate entrance is still unverified.',
      4700,
    );

    // Open the real operational case from the timeline.
    const caseRow = root(page).locator('button.timeline-row').filter({ hasText:'Pump RUNNING while water rises' }).first();
    if (await caseRow.isVisible().catch(() => false)) {
      await caseRow.click();
      await page.waitForURL(/case=harbour-exchange/i, { timeout:8000 });
      await page.waitForLoadState('domcontentloaded');
      await sleep(1000);
      await addTake3Layer(page);
    } else {
      const u = new URL(BASE);
      u.searchParams.set('case', 'harbour-exchange');
      await page.goto(u.toString(), { waitUntil:'domcontentloaded' });
      await sleep(1000);
      await addTake3Layer(page);
    }

    await sleep(2800);
    await note(page, 'First, Sifu reads the verified operating state — not just the pump status.', 3000);

    const apply = await firstVisible(page, [
      { type:'role', role:'button', name:/Apply Validated Knowledge/i },
      { type:'text', text:/Apply Validated Knowledge/i, exact:true },
    ], 7000);
    if (!apply) throw new Error('Apply Validated Knowledge button not found.');
    await ripple(page, apply);
    await apply.click();

    await note(page, 'Then it applies only validated organisational knowledge to those readings.', 3000);
    await waitForRootText(page, /ESCALATE|REVIEW WITH HUMAN OVERSIGHT/i, 20000);
    await sleep(1800);

    const decision = await firstVisible(page, [
      { type:'text', text:/^ESCALATE$/i, exact:true },
      { type:'text', text:/REVIEW WITH HUMAN OVERSIGHT/i },
    ], 6000);
    if (decision) await zoomTo(page, decision, 1.11);
    await note(page, 'RUNNING does not prove effective drainage. RUNNING + rising water triggers escalation, while the operator remains in control.', 4200);
    await sleep(2200);

    await story(
      page,
      'SIFU',
      'Ask once. Teach forever.',
      'Shared Intelligence From Us — expert judgement captured, validated and reused without turning the AI into the authority.',
      4200,
    );
  } catch (error) {
    console.error('\nTAKE 3 FAILED:', error?.stack || error);
    await dumpDiagnostics(page, error?.message || String(error)).catch(() => {});
    await page.screenshot({ path: FAILURE_SHOT, fullPage: false }).catch(() => {});
    throw error;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const temp = await video.path();
  const final = path.join(VIDEO_DIR, OUT_NAME);
  fs.copyFileSync(temp, final);
  console.log(`\nTake 3 recorded successfully:\n${final}`);
}

run().catch(() => process.exit(1));
