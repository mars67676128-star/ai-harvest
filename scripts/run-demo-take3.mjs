import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const videoDir = path.join(repoRoot, 'artifacts', 'video');
const recorder = path.join(frontendDir, 'scripts', 'record-demo-take3.mjs');
const pythonExe = path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
const dbPath = path.join(repoRoot, 'data', 'harvest_take3.db');
const backendUrl = 'http://127.0.0.1:8000';
const frontendUrl = 'http://127.0.0.1:5173';
const comspec = process.env.ComSpec || 'cmd.exe';

fs.mkdirSync(videoDir, { recursive: true });

const children = [];
let shuttingDown = false;

function isCmdShim(cmd) {
  return process.platform === 'win32' && /\.cmd$/i.test(cmd);
}

function commandLine(cmd, args = []) {
  // Commands passed here are npm/npx shims plus simple flag arguments. Keeping the
  // command line unquoted avoids Node's Windows .cmd spawn EINVAL issue while cwd
  // handles paths containing spaces such as C:\\Users\\Daymas Koh\\...
  return [cmd, ...args].join(' ');
}

function run(cmd, args, options = {}) {
  const cwd = options.cwd ?? repoRoot;
  const env = options.env ?? process.env;
  const useCmd = isCmdShim(cmd);
  const executable = useCmd ? comspec : cmd;
  const executableArgs = useCmd ? ['/d', '/s', '/c', commandLine(cmd, args)] : args;

  const result = spawnSync(executable, executableArgs, {
    cwd,
    env,
    stdio: 'inherit',
    shell: false,
    windowsHide: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} exited with code ${result.status}`);
}

function start(cmd, args, options = {}) {
  const cwd = options.cwd ?? repoRoot;
  const env = options.env ?? process.env;
  const useCmd = isCmdShim(cmd);
  const executable = useCmd ? comspec : cmd;
  const executableArgs = useCmd ? ['/d', '/s', '/c', commandLine(cmd, args)] : args;

  const child = spawn(executable, executableArgs, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: false,
    shell: false,
  });
  children.push(child);
  return child;
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, label, child, timeoutMs = 90000) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`${label} exited before becoming ready.`);
    if (await reachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready at ${url}.`);
}

function killTree(child) {
  if (!child || !child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: false,
    });
  } else {
    try { child.kill('SIGTERM'); } catch {}
  }
}

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [...children].reverse()) killTree(child);
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});
process.on('exit', cleanup);

async function main() {
  console.log('\n=== SIFU Take 3: one-command recorder ===\n');

  if (!fs.existsSync(pythonExe)) {
    console.log('Creating Python virtual environment...');
    run('python', ['-m', 'venv', '.venv']);
    run(pythonExe, ['-m', 'pip', 'install', '-r', 'requirements-dev.lock']);
  }

  if (!fs.existsSync(path.join(frontendDir, 'node_modules'))) {
    console.log('Installing frontend dependencies...');
    run('npm.cmd', ['install'], { cwd: frontendDir });
  }

  const playwrightCheck = spawnSync('node', ['-e', "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))"], {
    cwd: frontendDir,
    stdio: 'ignore',
    shell: false,
  });
  if (playwrightCheck.status !== 0) {
    console.log('Installing Playwright locally...');
    run('npm.cmd', ['install', '--no-save', '--package-lock=false', 'playwright'], { cwd: frontendDir });
  }

  console.log('Ensuring Chromium is installed...');
  run('npx.cmd', ['playwright', 'install', 'chromium'], { cwd: frontendDir });

  if (await reachable(`${backendUrl}/health`)) {
    throw new Error('Port 8000 is already in use. Close the existing backend first so Take 3 can start with a clean deterministic database.');
  }
  if (await reachable(frontendUrl)) {
    throw new Error('Port 5173 is already in use. Close the existing Vite frontend first so Take 3 can control the full recording session.');
  }

  try { fs.rmSync(dbPath, { force: true }); } catch {}

  const backendEnv = { ...process.env };
  delete backendEnv.HARVEST_AUTH_TOKENS;
  Object.assign(backendEnv, {
    HARVEST_ENV: 'demo',
    HARVEST_DB: 'data/harvest_take3.db',
    SIFU_EXPERT_DIRECTORY: JSON.stringify([
      {
        id: 'expert',
        name: 'Tan Wei Ming',
        role: 'Senior M&E Technician',
        skills: ['sump systems', 'drainage', 'pump maintenance'],
        domains: ['Technical Services'],
      },
    ]),
    SIFU_KNOWLEDGE_OWNERS: JSON.stringify([
      { id: 'approver', name: 'Jennifer Lim', domains: ['Technical Services'] },
    ]),
  });

  console.log('\nStarting backend on 127.0.0.1:8000...');
  const backend = start(pythonExe, ['-m', 'uvicorn', 'harvest.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: repoRoot,
    env: backendEnv,
  });
  await waitFor(`${backendUrl}/health`, 'Backend', backend);
  console.log('Backend ready.');

  console.log('\nStarting frontend on 127.0.0.1:5173...');
  const frontend = start('npm.cmd', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: frontendDir,
  });
  await waitFor(frontendUrl, 'Frontend', frontend);
  console.log('Frontend ready.');

  console.log('\nStarting Playwright recording...\n');
  const recorderEnv = {
    ...process.env,
    SIFU_DEMO_URL: frontendUrl,
    SIFU_VIDEO_DIR: videoDir,
  };
  const recording = spawnSync('node', [recorder], {
    cwd: frontendDir,
    env: recorderEnv,
    stdio: 'inherit',
    shell: false,
  });
  if (recording.error) throw recording.error;
  if (recording.status !== 0) throw new Error(`Take 3 recorder exited with code ${recording.status}`);

  const webm = path.join(videoDir, 'Sifu_DemoDay_Take3.webm');
  const mp4 = path.join(videoDir, 'Sifu_DemoDay_Take3.mp4');
  const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', shell: false });
  if (ffmpegCheck.status === 0 && fs.existsSync(webm)) {
    console.log('\nConverting to PowerPoint-safe H.264 MP4...');
    run('ffmpeg', [
      '-y', '-i', webm,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-r', '25',
      '-movflags', '+faststart',
      '-an',
      mp4,
    ]);
    console.log(`\nTake 3 complete:\n${mp4}`);
  } else {
    console.log(`\nTake 3 complete:\n${webm}`);
    console.log('ffmpeg was not found, so MP4 conversion was skipped.');
  }
}

main()
  .catch((error) => {
    console.error(`\nTAKE 3 SESSION FAILED: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup();
  });
