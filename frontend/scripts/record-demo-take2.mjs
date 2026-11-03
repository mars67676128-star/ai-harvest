import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const BASE = process.env.SIFU_DEMO_URL || 'http://127.0.0.1:5173';
const VIDEO_DIR = process.env.SIFU_VIDEO_DIR || path.resolve('../artifacts/video');
const OUT_NAME = 'Sifu_DemoDay_Take2.webm';
const FAILURE_SHOT = path.join(VIDEO_DIR, 'take2-failure.png');
const DIAGNOSTICS = path.join(VIDEO_DIR, 'take2-diagnostics.txt');

const QUESTION_1 = "The sump pump says RUNNING but the basement water level is still rising. Does RUNNING mean it's actually draining?";
const EXPERT_REPLY = "RUNNING may only indicate the command or motor state. It does not prove the pump is actually discharging water. Check actual discharge and the water-level trend. If the pump shows RUNNING but the water level continues to rise, escalate.";
const QUESTION_2 = "My sump pump is showing RUNNING, but the water level keeps going up. What should I do?";

fs.mkdirSync(VIDEO_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = (page) => page.locator('#root');

async function addCinematicLayer(page) {
  await page.addStyleTag({ content: `
    :root { --take2-teal:#173f40; --take2-mint:#5ac5b1; --take2-cream:#f7f4ec; }
    #take2-stage { position:fixed; inset:0; pointer-events:none; z-index:2147483640; overflow:hidden; }
    #take2-title { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; opacity:0; transform:scale(.988); transition:opacity .55s ease, transform .75s cubic-bezier(.2,.8,.2,1); }
    #take2-title.on { opacity:1; transform:scale(1); }
    #take2-title-card { min-width:760px; max-width:1200px; padding:66px 78px; border-radius:34px; background:rgba(23,63,64,.97); box-shadow:0 30px 100px rgba(0,0,0,.22); color:white; font-family:Inter,system-ui,sans-serif; }
    #take2-kicker { font-size:19px; letter-spacing:.14em; text-transform:uppercase; color:#9ed9cb; font-weight:700; margin-bottom:18px; }
    #take2-head { font-size:58px; line-height:1.04; font-weight:800; letter-spacing:-.035em; margin:0 0 20px; }
    #take2-sub { font-size:26px; line-height:1.4; color:#d7ebe6; max-width:900px; }
    #take2-focus { position:absolute; border:3px solid rgba(90,197,177,.95); border-radius:22px; box-shadow:0 0 0 9999px rgba(8,25,27,.15),0 0 0 8px rgba(90,197,177,.12),0 18px 50px rgba(0,0,0,.16); opacity:0; transition:all .75s cubic-bezier(.2,.8,.2,1), opacity .3s ease; }
    #take2-focus.on { opacity:1; }
    .take2-ripple { position:fixed; width:16px; height:16px; border:3px solid #5ac5b1; border-radius:50%; transform:translate(-50%,-50%); animation:take2Ripple .8s ease-out forwards; z-index:2147483646; pointer-events:none; }
    @keyframes take2Ripple { from{opacity:1;width:16px;height:16px} to{opacity:0;width:90px;height:90px} }
    #take2-caption { position:absolute; left:50%; bottom:54px; transform:translateX(-50%) translateY(16px); padding:16px 24px; background:rgba(23,63,64,.94); color:white; border-radius:18px; font:700 21px/1.25 Inter,system-ui,sans-serif; opacity:0; transition:opacity .4s ease,transform .4s ease; box-shadow:0 14px 50px rgba(0,0,0,.18); }
    #take2-caption.on { opacity:1; transform:translateX(-50%) translateY(0); }
    body.take2-camera #root { transition:transform 1.05s cubic-bezier(.2,.8,.2,1); }
  `});
  await page.evaluate(() => {
    if (document.getElementById('take2-stage')) return;
    const stage = document.createElement('div');
    stage.id = 'take2-stage';
    stage.innerHTML = `
      <div id="take2-title"><div id="take2-title-card"><div id="take2-kicker"></div><div id="take2-head"></div><div id="take2-sub"></div></div></div>
      <div id="take2-focus"></div>
      <div id="take2-caption"></div>`;
    document.body.appendChild(stage);
  });
}

async function titleCard(page, kicker, head, sub, ms = 3200) {
  await page.evaluate(({ kicker, head, sub }) => {
    const el = document.getElementById('take2-title');
    document.getElementById('take2-kicker').textContent = kicker;
    document.getElementById('take2-head').textContent = head;
    document.getElementById('take2-sub').textContent = sub;
    el.classList.add('on');
  }, { kicker, head, sub });
  await sleep(ms);
  await page.evaluate(() => document.getElementById('take2-title')?.classList.remove('on'));
  await sleep(700);
}

async function caption(page, text, ms = 2200) {
  await page.evaluate((text) => {
    const c = document.getElementById('take2-caption');
    c.textContent = text;
    c.classList.add('on');
  }, text);
  await sleep(ms);
  await page.evaluate(() => document.getElementById('take2-caption')?.classList.remove('on'));
  await sleep(250);
}

async function focus(page, locator, pad = 18) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(({ x, y, width, height, pad }) => {
    const f = document.getElementById('take2-focus');
    Object.assign(f.style, {
      left:`${x-pad}px`, top:`${y-pad}px`, width:`${width+pad*2}px`, height:`${height+pad*2}px`
    });
    f.classList.add('on');
  }, { ...box, pad });
  await sleep(350);
}

async function unfocus(page) {
  await page.evaluate(() => document.getElementById('take2-focus')?.classList.remove('on'));
  await sleep(250);
}

async function ripple(page, locator) {
  const b = await locator.boundingBox();
  if (!b) return;
  await page.evaluate(({ x, y }) => {
    const r = document.createElement('div');
    r.className = 'take2-ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 900);
  }, { x:b.x+b.width/2, y:b.y+b.height/2 });
}

async function cameraTo(page, locator, scale = 1.12) {
  const b = await locator.boundingBox();
  if (!b) return;
  const vp = page.viewportSize();
  const cx = b.x + b.width/2;
  const cy = b.y + b.height/2;
  const dx = vp.width/2 - cx;
  const dy = vp.height/2 - cy;
  await page.evaluate(({ scale, dx, dy }) => {
    const root = document.querySelector('#root');
    if (!root) return;
    document.body.classList.add('take2-camera');
    root.style.transformOrigin = 'center center';
    root.style.transform = `translate(${dx/scale}px, ${dy/scale}px) scale(${scale})`;
  }, { scale, dx, dy });
  await sleep(1150);
}

async function cameraReset(page) {
  await page.evaluate(() => {
    const root = document.querySelector('#root');
    if (root) root.style.transform = 'translate(0,0) scale(1)';
  });
  await sleep(1050);
}

function candidates(page, specs) {
  const root = app(page);
  return specs.map((s) => {
    if (s.type === 'role') return root.getByRole(s.role, { name:s.name });
    if (s.type === 'text') return root.getByText(s.text, { exact:s.exact ?? false });
    if (s.type === 'placeholder') return root.getByPlaceholder(s.text);
    return root.locator(s.css);
  });
}

async function firstVisible(page, specs, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const loc of candidates(page, specs)) {
      try {
        const count = await loc.count();
        for (let i=0; i<count; i++) {
          const item = loc.nth(i);
          if (await item.isVisible()) return item;
        }
      } catch {}
    }
    await sleep(180);
  }
  return null;
}

async function animateClick(page, loc, opts = {}) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await focus(page, loc, opts.pad ?? 14);
  await cameraTo(page, loc, opts.scale ?? 1.08);
  await sleep(opts.pre ?? 500);
  await ripple(page, loc);
  await loc.click();
  await sleep(opts.post ?? 900);
  await unfocus(page);
  await cameraReset(page);
}

async function clickFirst(page, specs, opts = {}) {
  const loc = await firstVisible(page, specs, opts.timeout || 7000);
  if (!loc) {
    if (opts.optional) return null;
    throw new Error(`Could not find clickable target: ${JSON.stringify(specs)}`);
  }
  await animateClick(page, loc, opts);
  return loc;
}

async function openAskSifu(page) {
  const ask = await firstVisible(page, [
    {type:'role', role:'link', name:/^ask sifu$/i},
    {type:'role', role:'button', name:/^ask sifu$/i},
    {type:'text', text:/^Ask Sifu$/i, exact:true}
  ], 2500);
  if (ask) {
    await ask.click().catch(() => {});
    await sleep(1200);
  }
}

async function composer(page) {
  await openAskSifu(page);
  const specs = [
    {type:'placeholder', text:'Ask Sifu about your work...'},
    {type:'placeholder', text:'Ask Sifu about your work…'},
    {type:'css', css:'textarea[placeholder*="Ask" i]'},
    {type:'css', css:'input[placeholder*="Ask" i]'},
    {type:'css', css:'[role="textbox"][contenteditable="true"]'},
    {type:'css', css:'[contenteditable="true"]'},
    {type:'css', css:'textarea'},
    {type:'css', css:'input[type="text"]'},
    {type:'css', css:'[role="textbox"]'}
  ];
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    let best = null;
    let bestArea = 0;
    for (const loc of candidates(page, specs)) {
      const count = await loc.count().catch(() => 0);
      for (let i=0; i<count; i++) {
        const item = loc.nth(i);
        try {
          if (!await item.isVisible()) continue;
          const box = await item.boundingBox();
          if (!box || box.width < 280 || box.height < 28) continue;
          const area = box.width * box.height;
          if (area > bestArea) { best = item; bestArea = area; }
        } catch {}
      }
    }
    if (best) return best;
    await sleep(250);
  }
  return null;
}

async function typeHuman(page, loc, text, delay = 58) {
  await loc.click();
  await loc.fill('').catch(async () => {
    await loc.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await loc.press('Backspace').catch(() => {});
  });
  for (const ch of text) {
    await loc.type(ch, { delay });
    if (/[,.?!]/.test(ch)) await sleep(90);
  }
}

async function submitComposer(page, loc) {
  const send = await firstVisible(page, [
    {type:'role', role:'button', name:/send|submit|ask/i},
    {type:'css', css:'button[type="submit"]'},
    {type:'css', css:'button[aria-label*="send" i]'},
    {type:'css', css:'button[title*="send" i]'}
  ], 2200);
  if (send) {
    await ripple(page, send);
    await sleep(300);
    await send.click();
  } else {
    await loc.press('Enter');
  }
}

async function openPersona(page, persona) {
  const u = new URL(BASE);
  u.searchParams.set('persona', persona);
  await page.goto(u.toString(), { waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForLoadState('networkidle', { timeout:5000 }).catch(() => {});
  await sleep(1500);
  await addCinematicLayer(page);
}

async function waitForAnyText(page, regexes, timeout = 18000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const text = await app(page).innerText().catch(() => '');
    if (regexes.some((r) => r.test(text))) return text;
    await sleep(400);
  }
  return null;
}

async function dumpDiagnostics(page, reason) {
  const info = await page.evaluate(() => {
    const editable = [...document.querySelectorAll('#root textarea,#root input,#root [contenteditable="true"],#root [role="textbox"]')].map((el) => ({
      tag:el.tagName,
      type:el.getAttribute('type'),
      placeholder:el.getAttribute('placeholder'),
      ariaLabel:el.getAttribute('aria-label'),
      role:el.getAttribute('role'),
      visible:!!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      text:(el.innerText || el.value || '').slice(0,160)
    }));
    const nav = [...document.querySelectorAll('#root a,#root button')]
      .filter((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length))
      .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim())
      .filter(Boolean)
      .slice(0,80);
    return { title:document.title, url:location.href, editable, nav, body:(document.querySelector('#root')?.innerText || '').slice(0,4000) };
  });
  fs.writeFileSync(DIAGNOSTICS, [`Reason: ${reason}`, '', JSON.stringify(info, null, 2)].join('\n'), 'utf8');
  console.error(`\nDiagnostics written to: ${DIAGNOSTICS}`);
  console.error(`Current page: ${info.url}`);
  console.error(`Visible controls: ${info.nav.slice(0,20).join(' | ')}`);
  console.error(`Editable elements found: ${info.editable.length}`);
}

async function run() {
  const browser = await chromium.launch({ headless:true });
  const context = await browser.newContext({
    viewport:{ width:1920, height:1080 },
    screen:{ width:1920, height:1080 },
    deviceScaleFactor:1,
    recordVideo:{ dir:VIDEO_DIR, size:{ width:1920, height:1080 } }
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    await openPersona(page, 'operator');
    await titleCard(page, 'SIFU · SHARED INTELLIGENCE', 'Expert know-how, on every shift.', 'A governed path from question → expert → reusable intelligence.', 3400);

    const q = await composer(page);
    if (!q) {
      await dumpDiagnostics(page, 'Ask Sifu composer not found after opening Ask Sifu and scanning all textbox-like controls.');
      throw new Error(`Ask Sifu composer not found. See ${DIAGNOSTICS}`);
    }
    await focus(page, q, 22);
    await cameraTo(page, q, 1.12);
    await caption(page, 'Amanda asks Sifu instead of searching documents or messaging around.', 2200);
    await typeHuman(page, q, QUESTION_1, 58);
    await sleep(1100);
    await submitComposer(page, q);
    await sleep(1200);
    await unfocus(page);
    await cameraReset(page);

    await caption(page, 'Sifu checks validated organisational knowledge first.', 2300);
    const firstAnswer = await waitForAnyText(page, [/Tan Wei Ming/i,/expert/i,/knowledge gap/i,/request/i], 18000);
    if (!firstAnswer) await caption(page, 'Knowledge gap detected — route to the right expert.', 2200);

    await clickFirst(page, [
      {type:'role', role:'button', name:/ask tan|request expertise|ask expert|find expert/i},
      {type:'text', text:/Ask Tan|Request expertise|Find an expert/i}
    ], { optional:true, scale:1.10, post:1100 });

    await titleCard(page, 'WHEN KNOWLEDGE RUNS OUT', 'Sifu finds the person who knows.', 'The employee stays in flow. The gap becomes a governed expertise request.', 3200);

    await openPersona(page, 'expert');
    await clickFirst(page, [
      {type:'text', text:/Expertise requests/i},
      {type:'role', role:'button', name:/Expertise requests/i},
      {type:'role', role:'link', name:/Expertise requests/i}
    ], { optional:true, scale:1.08 });
    await caption(page, 'Tan sees Amanda’s request with its timestamp and context.', 2200);
    await clickFirst(page, [{type:'text', text:/sump pump|water level|RUNNING/i}], { optional:true, scale:1.08 });

    const expertBox = await firstVisible(page, [
      {type:'placeholder', text:'Reply to this request...'},
      {type:'placeholder', text:'Share your expertise...'},
      {type:'placeholder', text:'Explain what you know...'},
      {type:'css', css:'textarea'},
      {type:'css', css:'[contenteditable="true"]'}
    ], 6500);
    if (expertBox) {
      await focus(page, expertBox, 20);
      await cameraTo(page, expertBox, 1.10);
      await caption(page, 'The expert teaches naturally. Sifu handles the structuring.', 2100);
      await typeHuman(page, expertBox, EXPERT_REPLY, 34);
      await sleep(950);
      await submitComposer(page, expertBox);
      await sleep(1500);
      await unfocus(page);
      await cameraReset(page);
    }

    await clickFirst(page, [
      {type:'role', role:'button', name:/review what i understood|create candidate|propose teaching|submit teaching/i},
      {type:'text', text:/Review what I understood|Create candidate|Submit teaching/i}
    ], { optional:true, scale:1.10 });

    await titleCard(page, 'GOVERNANCE', 'AI proposes. Humans validate.', 'Candidate knowledge is reviewable, versioned, attributable and never silently promoted.', 3400);

    await openPersona(page, 'approver');
    await clickFirst(page, [
      {type:'text', text:/Reviews/i},
      {type:'role', role:'button', name:/Reviews/i},
      {type:'role', role:'link', name:/Reviews/i}
    ], { optional:true, scale:1.08 });
    await clickFirst(page, [{type:'text', text:/sump pump|water level|RUNNING/i}], { optional:true, scale:1.08 });
    await caption(page, 'Jennifer verifies meaning, guardrails and provenance.', 2400);
    await clickFirst(page, [
      {type:'role', role:'button', name:/validate teaching|approve|publish/i},
      {type:'text', text:/Validate teaching|Approve|Publish/i}
    ], { optional:true, scale:1.11, post:1400 });

    await titleCard(page, 'REUSABLE INTELLIGENCE', 'Teach it once. Reuse it everywhere.', 'Now the next operator can get the same governed answer without finding Tan again.', 3200);

    await openPersona(page, 'operator');
    const q2 = await composer(page);
    if (q2) {
      await focus(page, q2, 22);
      await cameraTo(page, q2, 1.11);
      await typeHuman(page, q2, QUESTION_2, 54);
      await sleep(1000);
      await submitComposer(page, q2);
      await sleep(1700);
      await unfocus(page);
      await cameraReset(page);
      await waitForAnyText(page, [/validated organisational knowledge/i,/RUNNING/i,/escalate/i], 15000);
      await caption(page, 'The answer now comes from approved organisational knowledge.', 2500);
    }

    await titleCard(page, 'OPERATIONAL PAYOFF', 'Knowledge becomes a decision.', 'Harbour Exchange · pump RUNNING · water rising 3 mm/min · critical equipment not exposed.', 3400);

    // Use the actual demo timeline row. main.tsx routes this to ?case=harbour-exchange.
    const caseRow = app(page).locator('button.timeline-row').filter({ hasText:'Pump RUNNING while water rises' }).first();
    if (await caseRow.isVisible().catch(() => false)) {
      await focus(page, caseRow, 16);
      await cameraTo(page, caseRow, 1.06);
      await sleep(600);
      await ripple(page, caseRow);
      await caseRow.click();
      await page.waitForURL(/case=harbour-exchange/i, { timeout:8000 });
      await page.waitForLoadState('domcontentloaded');
      await sleep(1200);
      await addCinematicLayer(page);
    } else {
      const u = new URL(BASE);
      u.searchParams.set('case', 'harbour-exchange');
      await page.goto(u.toString(), { waitUntil:'domcontentloaded' });
      await sleep(1200);
      await addCinematicLayer(page);
    }

    await clickFirst(page, [
      {type:'role', role:'button', name:/apply validated knowledge/i},
      {type:'text', text:/Apply Validated Knowledge/i, exact:true}
    ], { scale:1.10, post:1700 });

    const esc = await firstVisible(page, [{type:'text', text:/^ESCALATE$/i, exact:true}], 12000);
    if (esc) {
      await focus(page, esc, 26);
      await cameraTo(page, esc, 1.14);
      await caption(page, 'Deterministic rule trace → ESCALATE. Human remains in control.', 3000);
      await sleep(1200);
    }

    await titleCard(page, 'SIFU', 'Tan taught it once. Every shift knows.', 'Shared intelligence from us. Ask once. Teach forever.', 4200);
    await cameraReset(page);
    await unfocus(page);
    await sleep(600);
  } catch (err) {
    console.error('\nTAKE 2 FAILED:', err?.stack || err);
    await dumpDiagnostics(page, err?.message || String(err)).catch(() => {});
    await page.screenshot({ path:FAILURE_SHOT, fullPage:false }).catch(() => {});
    throw err;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const temp = await video.path();
  const final = path.join(VIDEO_DIR, OUT_NAME);
  fs.copyFileSync(temp, final);
  console.log(`\nTake 2 recorded successfully:\n${final}`);
  console.log('Tip: convert the final WebM to H.264 MP4 before embedding in PowerPoint.');
}

run().catch(() => process.exit(1));
