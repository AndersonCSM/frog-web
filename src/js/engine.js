// ============================================
// FROG RUN — Game Engine (Vertical Lanes)
// ============================================

const CONFIG = {
  CELL: 50,
  COLS: 13,
  ROWS: 11,
  INITIAL_TIME: 300,
  CLOCK_BONUS: 30,
  COIN_POINTS: 50,
  PHASE_BONUS: 200,
  API_URL: "https://api.anderson.grupo5.sd.ufersa.dev.br/score"
};

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
canvas.width = CONFIG.COLS * CONFIG.CELL;
canvas.height = CONFIG.ROWS * CONFIG.CELL;

// DOM
const $ = id => document.getElementById(id);
const $phaseVal = $('phase-value'), $scoreVal = $('score-value');
const $timerVal = $('timer-value'), $hudTimer = $('hud-timer');
const $startScreen = $('start-screen'), $pauseScreen = $('pause-screen');
const $gameoverScreen = $('gameover-screen'), $phaseScreen = $('phase-screen');
const $phaseAnnounce = $('phase-announce');
const $finalScore = $('final-score'), $finalPhase = $('final-phase');
const $saveStatus = $('save-status');
const $btnStart = $('btn-start'), $btnRetry = $('btn-retry');
const $playerName = $('player-name');

// State
let G = {}, lastTime = 0, animFrame = null;

function initState() {
  G = {
    phase: 1, score: 0, timer: CONFIG.INITIAL_TIME,
    paused: false, over: false, started: false,
    frog: { x: 0, y: Math.floor(CONFIG.ROWS / 2), hopAnim: 0, drift: 0 },
    lanes: [], obstacles: [], coins: [], clocks: [], particles: []
  };
}

// ---- Lane Generation (columns) ----
const PHASE1_LANES = ['safe', 'road', 'road', 'safe', 'water', 'water', 'safe', 'road', 'road', 'safe', 'road', 'road', 'safe'];

function generateLanes(phase) {
  const lanes = [];
  if (phase === 1) {
    PHASE1_LANES.forEach((t, i) => {
      const dir = i % 2 === 0 ? -1 : 1;
      const spd = t === 'safe' ? 0 : 0.8 + Math.random() * 0.4;
      lanes.push({ type: t, dir, speed: spd });
    });
  } else {
    for (let c = 0; c < CONFIG.COLS; c++) {
      if (c === 0 || c === CONFIG.COLS - 1 || c === Math.floor(CONFIG.COLS / 2)) {
        lanes.push({ type: 'safe', dir: 0, speed: 0 });
      } else {
        const t = Math.random() < 0.55 ? 'road' : 'water';
        const dir = Math.random() < 0.5 ? -1 : 1;
        const spd = (0.8 + (phase - 1) * 0.25) + Math.random() * 0.5;
        lanes.push({ type: t, dir, speed: spd });
      }
    }
  }
  return lanes;
}

// ---- Obstacles (move vertically in columns) ----
const CAR_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];
function carColor() { return CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]; }

function spawnObstacles() {
  G.obstacles = [];
  const H = CONFIG.ROWS * CONFIG.CELL;
  G.lanes.forEach((lane, col) => {
    if (lane.type === 'safe') return;
    const count = lane.type === 'road' ? 3 : 2;
    const spacing = H / count;
    for (let i = 0; i < count; i++) {
      const h = lane.type === 'road'
        ? CONFIG.CELL * (1.2 + Math.random() * 0.6)
        : CONFIG.CELL * (2.2 + Math.random() * 1.3);
      G.obstacles.push({
        x: col * CONFIG.CELL,
        y: i * spacing + Math.random() * spacing * 0.3,
        w: CONFIG.CELL, h,
        col, type: lane.type,
        speed: lane.speed * lane.dir,
        color: lane.type === 'road' ? carColor() : '#8B5E3C'
      });
    }
  });
}

// ---- Collectibles ----
function spawnCollectibles() {
  G.coins = []; G.clocks = [];
  for (let i = 0; i < 5 + G.phase; i++) G.coins.push(randomCell());
  G.clocks.push(randomCell());
  if (G.phase > 1) G.clocks.push(randomCell());
}

function randomCell() {
  let col, row;
  do {
    col = 1 + Math.floor(Math.random() * (CONFIG.COLS - 2));
    row = Math.floor(Math.random() * CONFIG.ROWS);
  } while (G.lanes[col] && G.lanes[col].type === 'safe' && Math.random() < 0.5);
  return { col, row, alive: true, anim: Math.random() * Math.PI * 2 };
}

// ---- Frog ----
function moveFrog(dx, dy) {
  if (G.paused || G.over || !G.started || G.frog.hopAnim > 0) return;

  const curLane = G.lanes[G.frog.x];
  const nx = G.frog.x + dx, ny = G.frog.y + dy;
  if (nx < 0 || nx >= CONFIG.COLS || ny < 0 || ny >= CONFIG.ROWS) return;
  const destLane = G.lanes[nx];

  // Block only water → non-water (horizontal) if not aligned
  if (curLane && curLane.type === 'water' && dx !== 0 &&
    destLane && destLane.type !== 'water' && Math.abs(G.frog.drift) > 1) {
    const currentPy = frogPixelY();
    const nearestRow = Math.round(currentPy / CONFIG.CELL);
    const offset = Math.abs(currentPy - nearestRow * CONFIG.CELL);
    if (offset > CONFIG.CELL * 0.3) return; // Not aligned — block move
    G.frog.y = Math.max(0, Math.min(CONFIG.ROWS - 1, nearestRow));
    G.frog.drift = 0;
  }
  // Moving to non-water lane: reset drift
  if (destLane && destLane.type !== 'water') {
    if (Math.abs(G.frog.drift) > 1) {
      const currentPy = frogPixelY();
      G.frog.y = Math.max(0, Math.min(CONFIG.ROWS - 1, Math.round(currentPy / CONFIG.CELL)));
    }
    G.frog.drift = 0;
  }

  G.frog.x = nx; G.frog.y = ny;
  G.frog.hopAnim = 0.12;
  checkCollectibles();
  if (nx >= CONFIG.COLS - 1) phaseComplete();
}

function checkCollectibles() {
  G.coins.forEach(c => {
    if (c.alive && c.col === G.frog.x && c.row === G.frog.y) {
      c.alive = false; G.score += CONFIG.COIN_POINTS;
      spawnParticles(c.col * CONFIG.CELL + CONFIG.CELL / 2, c.row * CONFIG.CELL + CONFIG.CELL / 2, '#fbbf24');
    }
  });
  G.clocks.forEach(c => {
    if (c.alive && c.col === G.frog.x && c.row === G.frog.y) {
      c.alive = false; G.timer = Math.min(G.timer + CONFIG.CLOCK_BONUS, CONFIG.INITIAL_TIME);
      spawnParticles(c.col * CONFIG.CELL + CONFIG.CELL / 2, c.row * CONFIG.CELL + CONFIG.CELL / 2, '#60a5fa');
    }
  });
}

function phaseComplete() {
  G.score += CONFIG.PHASE_BONUS; G.phase++;
  G.paused = true;
  $phaseAnnounce.textContent = `FASE ${G.phase}`;
  $phaseScreen.classList.remove('hidden');
  setTimeout(() => {
    $phaseScreen.classList.add('hidden');
    G.frog.x = 0; G.frog.y = Math.floor(CONFIG.ROWS / 2); G.frog.drift = 0;
    G.lanes = generateLanes(G.phase);
    spawnObstacles(); spawnCollectibles();
    G.paused = false;
  }, 1500);
}

// ---- Collision ----
function frogPixelY() { return G.frog.y * CONFIG.CELL + G.frog.drift; }

function frogRect() {
  const p = 6;
  return { x: G.frog.x * CONFIG.CELL + p, y: frogPixelY() + p, w: CONFIG.CELL - p * 2, h: CONFIG.CELL - p * 2 };
}

function overlap(a, bx, by, bw, bh) {
  return a.x < bx + bw && a.x + a.w > bx && a.y < by + bh && a.y + a.h > by;
}

function checkFrogAlive(dt) {
  const fr = frogRect();
  const lane = G.lanes[G.frog.x];
  if (!lane) return;
  if (lane.type === 'road') {
    for (const ob of G.obstacles) {
      if (ob.col === G.frog.x && overlap(fr, ob.x, ob.y, ob.w, ob.h)) { gameOver(); return; }
    }
  } else if (lane.type === 'water') {
    let onLog = false;
    for (const ob of G.obstacles) {
      if (ob.col === G.frog.x && overlap(fr, ob.x, ob.y, ob.w, ob.h)) {
        onLog = true;
        G.frog.drift += ob.speed * dt * 60;
        // Keep G.frog.y synced with visual position so drift stays small
        const totalPy = G.frog.y * CONFIG.CELL + G.frog.drift;
        const nearRow = Math.round(totalPy / CONFIG.CELL);
        if (nearRow !== G.frog.y && nearRow >= 0 && nearRow < CONFIG.ROWS) {
          G.frog.drift = totalPy - nearRow * CONFIG.CELL;
          G.frog.y = nearRow;
        }
        const py = frogPixelY();
        if (py < -CONFIG.CELL / 2 || py > (CONFIG.ROWS - 0.5) * CONFIG.CELL) { gameOver(); return; }
        break;
      }
    }
    if (!onLog) { gameOver(); return; }
  }
}

// ---- Particles ----
function spawnParticles(x, y, color) {
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    G.particles.push({ x, y, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80, life: 0.5, maxLife: 0.5, color, r: 3 });
  }
}

// ---- Update ----
function update(dt) {
  if (G.paused || G.over) return;
  G.timer -= dt;
  if (G.timer <= 0) { G.timer = 0; gameOver(); return; }
  if (G.frog.hopAnim > 0) G.frog.hopAnim = Math.max(0, G.frog.hopAnim - dt);

  const H = CONFIG.ROWS * CONFIG.CELL;
  G.obstacles.forEach(ob => {
    ob.y += ob.speed * dt * 60;
    if (ob.speed < 0 && ob.y + ob.h < 0) ob.y = H;
    if (ob.speed > 0 && ob.y > H) ob.y = -ob.h;
  });

  G.particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
  G.particles = G.particles.filter(p => p.life > 0);

  checkFrogAlive(dt);
  checkCollectibles(); // Check every frame (for water drift pickup)
  updateHUD();
}

// ---- Render ----
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawLanes(); drawGrid(); drawObstacles(); drawCollectibles(); drawFrog(); drawParticles();
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < CONFIG.COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CONFIG.CELL, 0);
    ctx.lineTo(c * CONFIG.CELL, canvas.height);
    ctx.stroke();
  }
  for (let r = 1; r < CONFIG.ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * CONFIG.CELL);
    ctx.lineTo(canvas.width, r * CONFIG.CELL);
    ctx.stroke();
  }
}

function drawLanes() {
  G.lanes.forEach((lane, c) => {
    const x = c * CONFIG.CELL;
    if (lane.type === 'safe') {
      ctx.fillStyle = '#2d5a27';
      ctx.fillRect(x, 0, CONFIG.CELL, canvas.height);
      ctx.fillStyle = '#3a7a32';
      for (let r = 0; r < CONFIG.ROWS; r += 2) {
        ctx.fillRect(x + 15, r * CONFIG.CELL + 10, 4, 12);
        ctx.fillRect(x + 30, r * CONFIG.CELL + 30, 4, 10);
      }
    } else if (lane.type === 'road') {
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(x, 0, CONFIG.CELL, canvas.height);
      ctx.setLineDash([20, 15]);
      ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + CONFIG.CELL / 2, 0);
      ctx.lineTo(x + CONFIG.CELL / 2, canvas.height); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = '#1a4a7a';
      ctx.fillRect(x, 0, CONFIG.CELL, canvas.height);
      ctx.fillStyle = 'rgba(100,180,255,0.12)';
      const t = performance.now() / 1000;
      for (let r = 0; r < CONFIG.ROWS; r++) {
        const off = Math.sin(t * 2 + r * 0.8 + c) * 4;
        ctx.fillRect(x + 20 + off, r * CONFIG.CELL, 6, CONFIG.CELL);
      }
    }
  });
  // Goal column glow
  const gx = (CONFIG.COLS - 1) * CONFIG.CELL;
  ctx.fillStyle = 'rgba(74,222,128,0.15)';
  ctx.fillRect(gx, 0, CONFIG.CELL, canvas.height);
  ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvas.height); ctx.stroke();
  ctx.setLineDash([]);
}

function drawObstacles() {
  G.obstacles.forEach(ob => ob.type === 'road' ? drawCar(ob) : drawLog(ob));
}

function drawCar(ob) {
  const x = ob.x + 6, y = ob.y, w = CONFIG.CELL - 12, h = ob.h;
  ctx.fillStyle = ob.color;
  rr(x, y, w, h, 6);
  ctx.fillStyle = 'rgba(200,230,255,0.5)';
  const wy = ob.speed < 0 ? y + 6 : y + h - h * 0.3;
  ctx.fillRect(x + 4, wy, w - 8, h * 0.22);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x - 2, y + 6, 4, 10); ctx.fillRect(x - 2, y + h - 16, 4, 10);
  ctx.fillRect(x + w - 2, y + 6, 4, 10); ctx.fillRect(x + w - 2, y + h - 16, 4, 10);
  ctx.fillStyle = '#fef08a';
  const hy = ob.speed < 0 ? y + 2 : y + h - 6;
  ctx.fillRect(x + 6, hy, 5, 4); ctx.fillRect(x + w - 11, hy, 5, 4);
}

function drawLog(ob) {
  const x = ob.x + 8, y = ob.y, w = CONFIG.CELL - 16, h = ob.h;
  ctx.fillStyle = '#8B5E3C';
  rr(x, y, w, h, 8);
  ctx.strokeStyle = '#6B3F1C'; ctx.lineWidth = 1;
  for (let i = 0; i < h; i += 18) {
    ctx.beginPath(); ctx.moveTo(x + 4, y + i + 8); ctx.lineTo(x + w - 4, y + i + 8); ctx.stroke();
  }
  ctx.fillStyle = '#6B3F1C';
  ctx.beginPath(); ctx.arc(x + w / 2, y + 5, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + w / 2, y + h - 5, 5, 0, Math.PI * 2); ctx.fill();
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.fill();
}

function drawCollectibles() {
  const t = performance.now() / 1000;
  G.coins.forEach(c => {
    if (!c.alive) return;
    const cx = c.col * CONFIG.CELL + CONFIG.CELL / 2;
    const cy = c.row * CONFIG.CELL + CONFIG.CELL / 2 + Math.sin(t * 3 + c.anim) * 3;
    ctx.fillStyle = 'rgba(251,191,36,0.2)';
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 10px Inter';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('$', cx, cy + 1);
  });
  G.clocks.forEach(c => {
    if (!c.alive) return;
    const cx = c.col * CONFIG.CELL + CONFIG.CELL / 2;
    const cy = c.row * CONFIG.CELL + CONFIG.CELL / 2 + Math.sin(t * 2 + c.anim) * 3;
    ctx.fillStyle = 'rgba(96,165,250,0.2)';
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1e3a5f';
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#93c5fd'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 3, cy + 1); ctx.stroke();
  });
}

function drawFrog() {
  const px = G.frog.x * CONFIG.CELL;
  const py = frogPixelY();
  const s = CONFIG.CELL;
  const hop = G.frog.hopAnim > 0 ? 1 + Math.sin(G.frog.hopAnim / 0.12 * Math.PI) * 0.15 : 1;
  ctx.save();
  ctx.translate(px + s / 2, py + s / 2);
  ctx.scale(hop, hop);
  ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 12;
  ctx.fillStyle = '#22c55e'; rr(-s * 0.35, -s * 0.3, s * 0.7, s * 0.6, 10);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#86efac'; rr(-s * 0.2, -s * 0.15, s * 0.4, s * 0.35, 6);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-8, -s * 0.25, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(8, -s * 0.25, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(-6, -s * 0.26, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(10, -s * 0.26, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(-s * 0.38, s * 0.15, 10, 8); ctx.fillRect(s * 0.28, s * 0.15, 10, 8);
  ctx.fillRect(-s * 0.38, -s * 0.22, 8, 8); ctx.fillRect(s * 0.30, -s * 0.22, 8, 8);
  ctx.restore();
}

function drawParticles() {
  G.particles.forEach(p => {
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (p.life / p.maxLife), 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ---- HUD ----
function updateHUD() {
  $phaseVal.textContent = G.phase;
  $scoreVal.textContent = G.score;
  const m = Math.floor(G.timer / 60), s = Math.floor(G.timer % 60);
  $timerVal.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  $hudTimer.classList.toggle('danger', G.timer <= 30);
}

// ---- Game Over ----
function gameOver() {
  G.over = true;
  stopMusic();
  $finalScore.textContent = G.score;
  $finalPhase.textContent = G.phase;
  $saveStatus.textContent = 'Salvando pontuação...';
  $saveStatus.className = 'save-status';
  setTimeout(() => $gameoverScreen.classList.remove('hidden'), 600);
  saveScore();
}

async function saveScore() {
  const name = $playerName.value.trim() || 'Jogador';
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, score: G.score })
    });
    $saveStatus.textContent = res.ok ? '✓ Pontuação salva!' : '✗ Erro ao salvar';
    if (!res.ok) $saveStatus.className = 'save-status error';
  } catch (e) {
    $saveStatus.textContent = '✗ Falha na conexão';
    $saveStatus.className = 'save-status error';
  }
}

// ---- Game Loop ----
function gameLoop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  update(dt); render();
  animFrame = requestAnimationFrame(gameLoop);
}

function startGame() {
  initState(); G.started = true;
  G.lanes = generateLanes(1);
  spawnObstacles(); spawnCollectibles(); updateHUD();
  $startScreen.classList.add('hidden');
  $gameoverScreen.classList.add('hidden');
  $pauseScreen.classList.add('hidden');
  $phaseScreen.classList.add('hidden');
  lastTime = performance.now();
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = requestAnimationFrame(gameLoop);
  startMusic();
}

// ---- Input ----
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!G.started || G.over) return;
    G.paused = !G.paused;
    $pauseScreen.classList.toggle('hidden', !G.paused);
    return;
  }
  const map = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  if (map[e.key]) { e.preventDefault(); moveFrog(map[e.key][0], map[e.key][1]); }
});

$btnStart.addEventListener('click', startGame);
$btnRetry.addEventListener('click', startGame);
$playerName.addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });

// ---- Music (MP3) ----
const $btnMusic = $('btn-music'), $musicIcon = $('music-icon');
const bgMusic = new Audio('src/assets/sounds/TalkingCuteChiptune.mp3');
bgMusic.loop = true;
bgMusic.volume = 0.4;
let musicEnabled = false;

function toggleMusic() {
  musicEnabled = !musicEnabled;
  $musicIcon.textContent = musicEnabled ? '\u{1F50A}' : '\u{1F507}';
  if (musicEnabled) { bgMusic.play().catch(() => { }); }
  else { bgMusic.pause(); }
}

function stopMusic() {
  bgMusic.pause();
  bgMusic.currentTime = 0;
}

function startMusic() {
  if (musicEnabled) { bgMusic.currentTime = 0; bgMusic.play().catch(() => { }); }
}

$btnMusic.addEventListener('click', toggleMusic);

// ---- Mobile Touch Controls ----
const dirMap = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
document.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
  btn.addEventListener('touchstart', e => {
    e.preventDefault();
    const d = dirMap[btn.dataset.dir];
    if (d) moveFrog(d[0], d[1]);
  }, { passive: false });
});
const $pauseMobile = $('btn-pause-mobile');
$pauseMobile.addEventListener('touchstart', e => {
  e.preventDefault();
  if (!G.started || G.over) return;
  G.paused = !G.paused;
  $pauseScreen.classList.toggle('hidden', !G.paused);
}, { passive: false });

// ---- Init ----
initState();
G.lanes = generateLanes(1);
spawnObstacles();
render();
