import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const BASE = process.env.SIFU_DEMO_URL || 'http://127.0.0.1:5173';
const VIDEO_DIR = process.env.SIFU_VIDEO_DIR || path.resolve('../artifacts/video');
const OUT_NAME = 'Sifu_DemoDay_Take2.webm';
const FAILURE_SHOT = path.join(VIDEO_DIR, 'take2-failure.png');

const QUESTION_1 = "The sump pump says RUNNING but the basement water level is still rising. Does RUNNING mean it's actually draining?";
const EXPERT_REPLY = "RUNNING may only indicate the command or motor state. It does not prove the pump is actually discharging water. Check actual discharge and the water-level trend. If the pump shows RUNNING but the water level continues to rise, escalate.";
const QUESTION_2 = "My sump pump is showing RUNNING, but the water level keeps going up. What should I do?";

fs.mkdirSync(VIDEO_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function addCinematicLayer(page) {
  await page.addStyleTag({ content: `
    :root { --take2-teal:#173f40; --take2-mint:#5ac5b1; --take2-cream:#f7f4ec; }
    #take2-stage { position:fixed; inset:0; pointer-events:none; z-index:2147483640; overflow:hidden; }
    #take2-vignette { position:absolute; inset:0; opacity:0; background:radial-gradient(circle at center, transparent 35%, rgba(10,31,32,.24) 100%); transition:opacity .45s ease; }
    #take2-title { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; opacity:0; transform:scale(.985); transition:opacity .45s ease, transform .55s cubic-bezier(.2,.8,.2,1); }
    #take2-title.on { opacity:1; transform:scale(1); }
    #take2-title-card { min-width:760px; max-width:1200px; padding:66px 78px; border-radius:34px; background:rgba(23,63,64,.96); box-shadow:0 30px 100px rgba(0,0,0,.22); color:white; font-family:Inter,system-ui,sans-serif; text-align:left; }
    #take2-kicker { font-size:19px; letter-spacing:.14em; text-transform:uppercase; color:#9ed9cb; font-weight:700; margin-bottom:18px; }
    #take2-head { font-size:58px; line-height:1.04; font-weight:800; letter-spacing:-.035em; margin:0 0 20px; }
    #take2-sub { font-size:26px; line-height:1.4; color:#d7ebe6; max-width:900px; }
    #take2-focus { position:absolute; border:3px solid rgba(90,197,177,.95); border-radius:22px; box-shadow:0 0 0 9999px rgba(8,25,27,.17),0 0 0 8px rgba(90,197,177,.12),0 18px 50px rgba(0,0,0,.16); opacity:0; transition:all .55s cubic-bezier(.2,.8,.2,1), opacity .25s ease; }
    #take2-focus.on { opacity:1; }
    .take2-ripple { position:fixed; width:16px; height:16px; border:3px solid #5ac5b1; border-radius:50%; transform:translate(-50%,-50%); animation:take2Ripple .65s ease-out forwards; z-index:2147483646; pointer-events:none; }
    @keyframes take2Ripple { from{opacity:1;width:16px;height:16px} to{opacity:0;width:86px;height:86px} }
    #take2-caption { position:absolute; left:50%; bottom:54px; transform:translateX(-50%) translateY(16px); padding:16px 24px; background:rgba(23,63,64,.94); color:white; border-radius:18px; font:700 21px/1.25 Inter,system-ui,sans-serif; opacity:0; transition:opacity .3s ease,transform .3s ease; box-shadow:0 14px 50px rgba(0,0,0,.18); }
    #take2-caption.on { opacity:1; transform:translateX(-50%) translateY(0); }
    body.take2-camera #root, body.take2-camera > div:first-child { transition: transform .75s cubic-bezier(.2,.8,.2,1); }
  `});

  await page.evaluate(() => {
    if (document.getElementById('take2-stage')) return;
    const stage = document.createElement('div');
    stage.id = 'take2-stage';
    stage.innerHTML = `
      <div id="take2-vignette"></div>
      <div id="take2-title"><div id="take2-title-card"><div id="take2-kicker"></div><div id="take2-head"></div><div id="take2-sub"></div></div></div>
      <div id="take2-focus"></div>
      <div id="take2-caption"></div>`;
    document.body.appendChild(stage);
  });
}

async function titleCard(page, kicker, head, sub, ms = 2400) {
  await page.evaluate(({ kicker, head, sub }) => {
    const el = document.getElementById('take2-title');
    document.getElementById('take2-kicker').textContent = kicker;
    document.getElementById('take2-head').textContent = head;
    document.getElementById('take2-sub').textContent = sub;
    el.classList.add('on');
  }, { kicker, head, sub });
  await sleep(ms);
  await page.evaluate(() => document.getElementById('take2-title')?.classList.remove('on'));
  await sleep(500);
}

async function caption(page, text, ms = 1800) {
  await page.evaluate((text) => {
    const c = document.getElementById('take2-caption');
    c.textContent = text;
    c.classList.add('on');
  }, text);
  await sleep(ms);
  await page.evaluate(() => document.getElementById('take2-caption')?.classList.remove('on'));
}

async function focus(page, locator, pad = 18) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(({ x, y, width, height, pad }) => {
    const f = document.getElementById('take2-focus');
    Object.assign(f.style, {
      left: `${x-pad}px`, top: `${y-pad}px`, width: `${width+pad*2}px`, height: `${height+pad*2}px`
    });
    f.classList.add('on');
  }, { ...box, pad });
}

async function unfocus(page) {
  await page.evaluate(() => document.getElementById('take2-focus')?.classList.remove('on'));
}

async function ripple(page, locator) {
  const b = await locator.boundingBox(); if (!b) return;
  await page.evaluate(({ x, y }) => {
    const r = document.createElement('div'); r.className = 'take2-ripple';
    r.style.left = `${x}px`; r.style.top = `${y}px`; document.body.appendChild(r);
    setTimeout(() => r.remove(), 800);
  }, { x:b.x+b.width/2, y:b.y+b.height/2 });
}

async function cameraTo(page, locator, scale = 1.18) {
  const b = await locator.boundingBox(); if (!b) return;
  const vp = page.viewportSize();
  const cx = b.x + b.width/2, cy = b.y + b.height/2;
  const dx = vp.width/2 - cx, dy = vp.height/2 - cy;
  await page.evaluate(({ scale, dx, dy }) => {
    const root = document.querySelector('#root') || document.body.firstElementChild;
    if (!root) return;
    document.body.classList.add('take2-camera');
    root.style.transformOrigin = 'center center';
    root.style.transform = `translate(${dx/scale}px, ${dy/scale}px) scale(${scale})`;
  }, { scale, dx, dy });
  await sleep(850);
}

async function cameraReset(page) {
  await page.evaluate(() => {
    const root = document.querySelector('#root') || document.body.firstElementChild;
    if (root) root.style.transform = 'translate(0,0) scale(1)';
  });
  await sleep(750);
}

function candidates(page, specs) {
  return specs.map((s) => {
    if (s.type === 'role') return page.getByRole(s.role, { name: s.name });
    if (s.type === 'text') return page.getByText(s.text, { exact: s.exact ?? false });
    if (s.type === 'placeholder') return page.getByPlaceholder(s.text);
    return page.locator(s.css);
  });
}

async function firstVisible(page, specs, timeout = 6000) {
  const deadline = Date.now()+timeout;
  while (Date.now()<deadline) {
    for (const loc of candidates(page, specs)) {
      try { if (await loc.first().isVisible({ timeout:150 })) return loc.first(); } catch {}
    }
    await sleep(150);
  }
  return null;
}

async function clickFirst(page, specs, opts={}) {
  const loc = await firstVisible(page, specs, opts.timeout || 6500);
  if (!loc) {
    if (opts.optional) return null;
    throw new Error(`Could not find clickable target: ${JSON.stringify(specs)}`);
  }
  await loc.scrollIntoViewIfNeeded().catch(()=>{});
  await focus(page, loc, opts.pad ?? 14);
  await cameraTo(page, loc, opts.scale ?? 1.10);
  await sleep(opts.pre ?? 350);
  await ripple(page, loc);
  await loc.click();
  await sleep(opts.post ?? 650);
  await unfocus(page);
  await cameraReset(page);
  return loc;
}

async function composer(page) {
  return await firstVisible(page, [
    {type:'placeholder', text:'Ask Sifu about your work...'},
    {type:'placeholder', text:'Ask Sifu about your work…'},
    {type:'css', css:'textarea'},
    {type:'css', css:'input[type="text"]'}
  ], 5000);
}

async function typeHuman(page, loc, text, delay = 42) {
  await loc.click();
  await loc.fill('');
  await loc.type(text, { delay });
}

async function submitComposer(page, loc) {
  const send = await firstVisible(page, [
    {type:'role', role:'button', name:/send/i},
    {type:'css', css:'button[type="submit"]'}
  ], 1400);
  if (send) { await ripple(page, send); await send.click(); }
  else await loc.press('Enter');
}

async function openPersona(page, persona) {
  const u = new URL(BASE);
  u.searchParams.set('persona', persona);
  await page.goto(u.toString(), { waitUntil:'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(()=>{});
  await addCinematicLayer(page);
  await sleep(800);
}

async function waitForAnyText(page, regexes, timeout = 16000) {
  const end = Date.now()+timeout;
  while (Date.now()<end) {
    const text = await page.locator('body').innerText().catch(()=> '');
    if (regexes.some(r => r.test(text))) return text;
    await sleep(350);
  }
  return null;
}

async function run() {
  const browser = await chromium.launch({ headless:true });
  const context = await browser.newContext({
    viewport: { width:1920, height:1080 },
    screen: { width:1920, height:1080 },
    deviceScaleFactor:1,
    recordVideo: { dir: VIDEO_DIR, size: { width:1920, height:1080 } }
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    await openPersona(page, 'operator');
    await titleCard(page, 'SIFU · SHARED INTELLIGENCE', 'Expert know-how, on every shift.', 'A governed path from question → expert → reusable intelligence.', 2800);

    const q = await composer(page);
    if (!q) throw new Error('Ask Sifu composer not found.');
    await focus(page, q, 22); await cameraTo(page, q, 1.18);
    await caption(page, 'Amanda asks Sifu instead of searching documents or messaging around.', 1700);
    await typeHuman(page, q, QUESTION_1, 38);
    await sleep(650); await submitComposer(page, q); await sleep(750); await unfocus(page); await cameraReset(page);

    await caption(page, 'Sifu checks validated organisational knowledge first.', 1900);
    const firstAnswer = await waitForAnyText(page, [/Tan Wei Ming/i,/expert/i,/knowledge gap/i,/request/i], 18000);
    if (!firstAnswer) await caption(page, 'Knowledge gap detected — route to the right expert.', 1800);

    await clickFirst(page, [
      {type:'role', role:'button', name:/ask tan|request expertise|ask expert|find expert/i},
      {type:'text', text:/Ask Tan|Request expertise|Find an expert/i}
    ], { optional:true, scale:1.16 });

    await titleCard(page, 'WHEN KNOWLEDGE RUNS OUT', 'Sifu finds the person who knows.', 'The employee stays in flow. The gap becomes a governed expertise request.', 2400);

    await openPersona(page, 'expert');
    await clickFirst(page, [
      {type:'text', text:/Expertise requests/i},
      {type:'role', role:'button', name:/Expertise requests/i},
      {type:'role', role:'link', name:/Expertise requests/i}
    ], { optional:true, scale:1.10 });
    await caption(page, 'Tan sees Amanda’s request with its timestamp and context.', 1700);

    await clickFirst(page, [
      {type:'text', text:/sump pump|water level|RUNNING/i}
    ], { optional:true, scale:1.12 });

    const expertBox = await firstVisible(page, [
      {type:'placeholder', text:'Reply to this request...'},
      {type:'placeholder', text:'Share your expertise...'},
      {type:'placeholder', text:'Explain what you know...'},
      {type:'css', css:'textarea'}
    ], 4500);
    if (expertBox) {
      await focus(page, expertBox, 20); await cameraTo(page, expertBox, 1.16);
      await caption(page, 'The expert teaches naturally. Sifu handles the structuring.', 1600);
      await typeHuman(page, expertBox, EXPERT_REPLY, 25); await sleep(500); await submitComposer(page, expertBox);
      await sleep(1200); await unfocus(page); await cameraReset(page);
    }

    await clickFirst(page, [
      {type:'role', role:'button', name:/review what i understood|create candidate|propose teaching|submit teaching/i},
      {type:'text', text:/Review what I understood|Create candidate|Submit teaching/i}
    ], { optional:true, scale:1.15 });

    await titleCard(page, 'GOVERNANCE', 'AI proposes. Humans validate.', 'Candidate knowledge is reviewable, versioned, attributable and never silently promoted.', 2600);

    await openPersona(page, 'approver');
    await clickFirst(page, [
      {type:'text', text:/Reviews/i},
      {type:'role', role:'button', name:/Reviews/i},
      {type:'role', role:'link', name:/Reviews/i}
    ], { optional:true, scale:1.10 });
    await clickFirst(page, [
      {type:'text', text:/sump pump|water level|RUNNING/i}
    ], { optional:true, scale:1.12 });
    await caption(page, 'Jennifer verifies meaning, guardrails and provenance.', 1700);
    await clickFirst(page, [
      {type:'role', role:'button', name:/validate teaching|approve|publish/i},
      {type:'text', text:/Validate teaching|Approve|Publish/i}
    ], { optional:true, scale:1.18, post:900 });

    await titleCard(page, 'REUSABLE INTELLIGENCE', 'Teach it once. Reuse it everywhere.', 'Now the next operator can get the same governed answer without finding Tan again.', 2400);

    await openPersona(page, 'operator');
    const q2 = await composer(page);
    if (q2) {
      await focus(page, q2, 22); await cameraTo(page, q2, 1.18);
      await typeHuman(page, q2, QUESTION_2, 34); await sleep(500); await submitComposer(page, q2);
      await sleep(1500); await unfocus(page); await cameraReset(page);
      await waitForAnyText(page, [/validated organisational knowledge/i,/RUNNING/i,/escalate/i], 15000);
      await caption(page, 'The answer now comes from approved organisational knowledge.', 2200);
    }

    await titleCard(page, 'OPERATIONAL PAYOFF', 'Knowledge becomes a decision.', 'Harbour Exchange · pump RUNNING · water rising 3 mm/min · critical equipment not exposed.', 2500);

    await clickFirst(page, [
      {type:'text', text:/Cases/i},
      {type:'role', role:'button', name:/Cases/i},
      {type:'role', role:'link', name:/Cases/i}
    ], { optional:true, scale:1.08 });
    await clickFirst(page, [{type:'text', text:/Harbour Exchange/i}], { optional:true, scale:1.12 });
    await clickFirst(page, [
      {type:'role', role:'button', name:/apply validated knowledge|run assessment|assess/i},
      {type:'text', text:/Apply Validated Knowledge|Run assessment/i}
    ], { optional:true, scale:1.16, post:1200 });

    const esc = await firstVisible(page, [{type:'text', text:/ESCALATE/i}], 7000);
    if (esc) { await focus(page, esc, 26); await cameraTo(page, esc, 1.23); await caption(page, 'Deterministic rule trace → ESCALATE. Human remains in control.', 2600); }

    await titleCard(page, 'SIFU', 'Tan taught it once. Every shift knows.', 'Shared intelligence from us. Ask once. Teach forever.', 3600);
    await cameraReset(page); await unfocus(page); await sleep(500);
  } catch (err) {
    console.error('\nTAKE 2 FAILED:', err?.stack || err);
    await page.screenshot({ path: FAILURE_SHOT, fullPage:false }).catch(()=>{});
    throw err;
  } finally {
    await page.close().catch(()=>{});
    await context.close().catch(()=>{});
    await browser.close().catch(()=>{});
  }

  const temp = await video.path();
  const final = path.join(VIDEO_DIR, OUT_NAME);
  fs.copyFileSync(temp, final);
  console.log(`\nTake 2 recorded successfully:\n${final}`);
  console.log('Playwright produces VP8/VP9 WebM, which should play in modern browsers and avoids the unsupported MP4 codec issue from the previous attempt.');
}

run().catch(() => process.exit(1));
