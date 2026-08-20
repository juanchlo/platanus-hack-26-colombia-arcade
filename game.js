// San Antonio Drift — Platanus Hack 26: Bogotá
// Two players race downhill in beer crates through Barrio San Antonio, Cali.

const W = 800;
const H = 600;
const STORAGE_KEY = 'san-antonio-drift-scores';

// ---------------------------------------------------------------------------
// Cabinet controls — DO NOT modify existing keys, append only
// ---------------------------------------------------------------------------
const CABINET_KEYS = {
  P1_U: ['w'],
  P1_D: ['s'],
  P1_L: ['a'],
  P1_R: ['d'],
  P1_1: ['u'], // jump
  P1_2: ['i'], // push
  P1_3: ['o'],
  P1_4: ['j'],
  P1_5: ['k'],
  P1_6: ['l'],
  P2_U: ['ArrowUp'],
  P2_D: ['ArrowDown'],
  P2_L: ['ArrowLeft'],
  P2_R: ['ArrowRight'],
  P2_1: ['r'], // jump
  P2_2: ['t'], // push
  P2_3: ['y'],
  P2_4: ['f'],
  P2_5: ['g'],
  P2_6: ['h'],
  START1: ['Enter'],
  START2: ['2'],
};

const KEY_MAP = {};
for (const [code, keys] of Object.entries(CABINET_KEYS)) {
  for (const k of keys) KEY_MAP[k.length === 1 ? k.toLowerCase() : k] = code;
}

// ---------------------------------------------------------------------------
// Input state
// ---------------------------------------------------------------------------
const held = Object.create(null);
const pressed = Object.create(null);

window.addEventListener('keydown', (e) => {
  const code = KEY_MAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!code) return;
  if (!held[code]) pressed[code] = true;
  held[code] = true;
});
window.addEventListener('keyup', (e) => {
  const code = KEY_MAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (code) held[code] = false;
});

function consumePressed(code) {
  if (pressed[code]) { pressed[code] = false; return true; }
  return false;
}

// --- Helpers DRY para UI y Polígonos ---
function txtStyle(size, color, align = 'center') {
  return { fontFamily: 'monospace', fontSize: size, color: color, fontStyle: 'bold', align: align, stroke: '#000000', strokeThickness: 3 };
}

function drawPoly(gfx, color, points, lineColor) {
  gfx.fillStyle(color, 1);
  gfx.fillPoints(points, true);
  if (lineColor) {
    gfx.lineStyle(2, lineColor, 1);
    gfx.strokePoints(points, true);
  }
}

// ---------------------------------------------------------------------------
// Audio Engine (Procedural 8-bit Synth)
// ---------------------------------------------------------------------------
const A = {
  ctx: null, master: null, noise: null, on: false,
  init() {
    if (this.on) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4; // Volumen general
      this.master.connect(this.ctx.destination);
      // Generar buffer de ruido blanco una sola vez
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, len);
      const b = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) b[i] = Math.random() * 2 - 1;
      this.on = true;
    } catch (e) {}
  },
  tone(freq, dur, type, vol, sweepTo, delay = 0) {
    if (!this.on) return;
    const t = this.ctx.currentTime + delay, osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
  },
  noiseFx(dur, vol, freq, q, type, delay = 0) {
    if (!this.on) return;
    const t = this.ctx.currentTime + delay, src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.noise;
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  },
  sfx(kind) {
    if (!this.on) this.init();
    if (!this.on) return;
    if (kind === 'jump') {
      this.tone(150, 0.25, 'square', 0.15, 600); // Sweep hacia arriba (estilo Mario)
    } else if (kind === 'hit') {
      this.tone(300, 0.1, 'sawtooth', 0.2, 100);
      this.noiseFx(0.1, 0.3, 1000, 1, 'highpass'); // Impacto seco
    } else if (kind === 'crash') {
      this.tone(180, 0.4, 'sawtooth', 0.3, 40);
      this.noiseFx(0.3, 0.4, 300, 0.5, 'lowpass'); // Golpe sordo y grave
    } else if (kind === 'drift') {
      this.noiseFx(0.15, 0.1, 2000, 2, 'bandpass'); // Fricción aguda (chillido de llanta)
    } else if (kind === 'win') {
      [392, 523, 659, 783].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, f, i * 0.1)); // Arpegio feliz
    }
  }
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
function getStorage() {
  if (window.platanusArcadeStorage) return window.platanusArcadeStorage;
  return {
    async get(key) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? { found: false, value: null } : { found: true, value: JSON.parse(raw) };
      } catch { return { found: false, value: null }; }
    },
    async set(key, value) { window.localStorage.setItem(key, JSON.stringify(value)); },
  };
}

async function storageGet(key) { return getStorage().get(key); }
async function storageSet(key, val) { return getStorage().set(key, val); }

// ---------------------------------------------------------------------------
// Retro Scoreboard & Leaderboard (Hall of Fame)
// ---------------------------------------------------------------------------
const DEFAULT_SCORES = [
  { rank: 1, matchup: 'NEAA VS CHGO', score: 45000, dist: 1250 },
  { rank: 2, matchup: 'CALI VS DIAB', score: 38200, dist: 1040 },
  { rank: 3, matchup: 'SANT VS ANTO', score: 29500, dist: 850 },
  { rank: 4, matchup: 'PLAT VS HACK', score: 21000, dist: 620 },
  { rank: 5, matchup: 'BOG2 VS CAL1', score: 15000, dist: 480 },
];

function padScore(num) {
  const s = Math.max(0, Math.round(num || 0)).toString();
  return s.padStart(6, '0');
}

function showScorePopup(scene, x, y, text, color) {
  const t = scene.add.text(x, y, text, {
    fontFamily: 'monospace',
    fontSize: '15px',
    color: color || '#ffdd00',
    fontStyle: 'bold',
    stroke: '#000000',
    strokeThickness: 3,
  }).setOrigin(0.5).setDepth(15);

  scene.tweens.add({
    targets: t,
    y: y - 40,
    alpha: 0,
    scale: 1.25,
    duration: 850,
    ease: 'Cubic.easeOut',
    onComplete: () => t.destroy(),
  });
}

async function loadLeaderboard(scene) {
  try {
    const res = await storageGet(STORAGE_KEY);
    if (res && res.found && Array.isArray(res.value) && res.value.length > 0) {
      scene.gameState.leaderboard = res.value;
    } else {
      scene.gameState.leaderboard = JSON.parse(JSON.stringify(DEFAULT_SCORES));
    }
  } catch (_) {
    scene.gameState.leaderboard = JSON.parse(JSON.stringify(DEFAULT_SCORES));
  }
  scene.gameState.highScore = scene.gameState.leaderboard[0] ? scene.gameState.leaderboard[0].score : 45000;
  if (scene.hud && scene.hud.hiScore) {
    scene.hud.hiScore.setText(`HIGH SCORE\n${padScore(scene.gameState.highScore)}`);
  }
  if (scene.startHiScoreText) {
    const topM = scene.gameState.leaderboard[0]?.matchup || scene.gameState.leaderboard[0]?.name || 'NEAA VS CHGO';
    scene.startHiScoreText.setText(`★ RÉCORD: ${padScore(scene.gameState.highScore)} · ${topM} ★`);
  }
}

async function recordHighScore(scene, matchup, p1Score, p2Score, distance) {
  const dist = Math.round(distance);
  let lb = scene.gameState.leaderboard || JSON.parse(JSON.stringify(DEFAULT_SCORES));
  const topScore = Math.max(Math.round(p1Score), Math.round(p2Score));

  const candidate = {
    matchup: matchup || 'P1P1 VS P2P2',
    score: topScore,
    dist,
  };

  let isNewHigh = false;
  if (topScore > 0 && (lb.length < 5 || topScore > (lb[lb.length - 1]?.score || 0))) {
    lb.push(candidate);
    isNewHigh = true;
  }

  if (isNewHigh) {
    lb.sort((a, b) => b.score - a.score);
    lb = lb.slice(0, 5);
    for (let i = 0; i < lb.length; i++) lb[i].rank = i + 1;
    scene.gameState.leaderboard = lb;
    scene.gameState.highScore = lb[0].score;
    try {
      await storageSet(STORAGE_KEY, lb);
    } catch (_) {}
  }

  return { leaderboard: lb, isNewHigh, candidate };
}

// ---------------------------------------------------------------------------
// Phaser config
// ---------------------------------------------------------------------------
const config = {
  type: Phaser.AUTO,
  width: W,
  height: H,
  parent: 'game-root',
  backgroundColor: '#1a1a2e',
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: { preload, create, update },
};

new Phaser.Game(config);

// ---------------------------------------------------------------------------
// Scene lifecycle
// ---------------------------------------------------------------------------
function preload() {}

function create() {
  const scene = this;
  scene.phase = 'start'; // phases: start | playing | gameover

  // Game state
  scene.gameState = {
    speed: 0,         // current scroll speed (px/s)
    distance: 0,      // total distance scrolled
    elapsed: 0,       // tiempo transcurrido (segundos)
    musicStarted: false,
    highScore: 45000,
    leaderboard: null,
    gameMode: '2P',   // '1P' (vs CPU) | '2P' (1 vs 1)
  };

  // Build all layers (start hidden as needed)
  createBackground(scene);
  createTrack(scene);
  createParticleSystem(scene);
  createPlayers(scene);
  createObstaclePool(scene);
  createHud(scene);
  createStartScreen(scene);
  createHowToPlayScreen(scene);
  createLeaderboardScreen(scene);
  createNameEntryScreen(scene);
  createGameOverScreen(scene);

  loadLeaderboard(scene);
  showStartScreen(scene);
}

function update(time, delta) {
  const scene = this;
  clearPressed();

  if (scene.phase === 'start') {
    updateStartScreen(scene, time);
    return;
  }

  if (scene.phase === 'howtoplay') {
    updateHowToPlayScreen(scene);
    return;
  }

  if (scene.phase === 'leaderboard_view') {
    updateLeaderboardScreen(scene, time);
    return;
  }

  if (scene.phase === 'name_entry') {
    updateNameEntryScreen(scene, time);
    return;
  }

  if (scene.phase === 'playing') {
    updateScroll(scene, delta);
    updateParticles(scene, delta);
    updatePlayers(scene, delta, time);
    updateObstacles(scene, delta);
    checkPlayerElimination(scene);
    updateHud(scene);

    if (consumePressed('START1') || consumePressed('START2')) {
      pauseGame(scene);
    }
    return;
  }

  if (scene.phase === 'paused') {
    if (consumePressed('START1') || consumePressed('START2')) resumeGame(scene);
    return;
  }

  if (scene.phase === 'gameover') {
    updateGameOverScreen(scene, time);
    return;
  }
}

function clearPressed() {
  // pressed flags are set on keydown; consumed per-frame after reads
  // Nothing to do here — individual consumePressed calls handle clearing
}

// ---------------------------------------------------------------------------
// Background — static far-parallax (Cielo, Cerros, Cruces Isométricas, Iglesia)
// ---------------------------------------------------------------------------
function createBackground(scene) {
  scene.bgGraphics = scene.add.graphics();
  const gfx = scene.bgGraphics;

  // 1. Cielo Atardecer (Gradiente cálido)
  gfx.fillGradientStyle(0x2b1055, 0x2b1055, 0xe07a5f, 0xe07a5f, 1);
  gfx.fillRect(0, 0, W, H);

  // 2. Silueta de los Cerros de Cali (Fondo oscuro)
  gfx.fillStyle(0x1a1a2e, 1);
  gfx.beginPath();
  gfx.moveTo(0, 250);
  gfx.lineTo(200, 140);
  gfx.lineTo(400, 180);
  gfx.lineTo(650, 60);  // Pico Cerro Tres Cruces
  gfx.lineTo(W, 140);
  gfx.lineTo(W, H);
  gfx.lineTo(0, H);
  gfx.closePath();
  gfx.fill();

  // Dibujamos las cruces ordenadas de atrás hacia adelante
  drawIsoCross(gfx, 680, 90, 1.5); // Derecha (Atrás)
  drawIsoCross(gfx, 620, 95, 1.5); // Izquierda (Medio)
  drawIsoCross(gfx, 650, 105, 2.0); // Central (Frente y más grande)

  // 4. Iglesia de San Antonio Isométrica (Ubicada en la ladera)
  drawIsoChurch(gfx, 725, 220, 3.0);
}

// ---------------------------------------------------------------------------
// Track — Diagonal Isometric Projection (Desciende mid-left a bottom-right)
// ---------------------------------------------------------------------------
// Constantes isométricas rígidas (Sin punto de fuga) — compartidas con
// el sistema de obstáculos para que todo se dibuje sobre la misma pista.
const TRACK_M = 0.5;          // Pendiente 2:1 (diagonal hacia abajo-derecha)
const CURB_OFFSET = 50;       // Altura base del andén izquierdo
const CLIFF_OFFSET = 400;     // Altura base del barranco derecho
const LAT_MIN = -85;
const LAT_MAX = 85;
const COLLISION_X = 400;      // "Línea del ahora": donde vive el jugador en X

// ---------------------------------------------------------------------------
// Difficulty phases — dificultad incremental por tiempo
// ---------------------------------------------------------------------------
function getDiffPhase(elapsed) {
  if (elapsed < 20) return 0;  // Fácil
  if (elapsed < 60) return 1;  // Medio
  if (elapsed < 120) return 2; // Difícil
  return 3;                    // Muy difícil
}

const DIFF_SETTINGS = [
  { speedMax: 300, accel: 6,  spawnMin: 2.0, spawnMax: 3.0 },  // Fácil (0–20s)
  { speedMax: 500, accel: 10, spawnMin: 1.2, spawnMax: 2.0 },  // Medio (20s–60s)
  { speedMax: 700, accel: 14, spawnMin: 0.7, spawnMax: 1.3 },  // Difícil (60s–120s)
  { speedMax: 900, accel: 20, spawnMin: 0.4, spawnMax: 0.8 },  // Muy difícil (>120s)
];

const trackCurbY  = (x) => x * TRACK_M + CURB_OFFSET;
const trackCliffY = (x) => x * TRACK_M + CLIFF_OFFSET;

// Convierte una posición lateral (lat, igual que player.lat) + una X de
// pantalla en la Y correspondiente sobre la pista diagonal.
function laneY(x, lat) {
  const t = Phaser.Math.Clamp((lat - LAT_MIN) / (LAT_MAX - LAT_MIN), 0, 1);
  return trackCurbY(x) + t * (trackCliffY(x) - trackCurbY(x));
}

function createTrack(scene) {
  scene.backTrackGfx = scene.add.graphics().setDepth(2);
  scene.frontTrackGfx = scene.add.graphics().setDepth(8);
  renderTrack(scene, 0); // Frame inicial
}

function renderTrack(scene, distance) {
  const bGfx = scene.backTrackGfx;
  const fGfx = scene.frontTrackGfx;
  bGfx.clear();
  fGfx.clear();

  const curbY = trackCurbY, cliffY = trackCliffY;
  const leftHillTop = (x) => curbY(x) - 160;
  const valleyTop = (x) => cliffY(x) + 40;

  // 1. ZONAS VERDES LATERALES (bGfx - Atrás de los jugadores)
  drawPoly(bGfx, 0x386131, [{x:0, y:curbY(0)}, {x:W, y:curbY(W)}, {x:W, y:leftHillTop(W)}, {x:0, y:leftHillTop(0)}]);
  bGfx.lineStyle(4, 0x24421e, 1); bGfx.lineBetween(0, leftHillTop(0), W, leftHillTop(W));
  
  drawPoly(bGfx, 0x5c483a, [{x:0, y:cliffY(0)}, {x:W, y:cliffY(W)}, {x:W, y:valleyTop(W)}, {x:0, y:valleyTop(0)}]);
  drawPoly(bGfx, 0x4a7c44, [{x:0, y:valleyTop(0)}, {x:W, y:valleyTop(W)}, {x:W, y:H}, {x:0, y:H}]);
  bGfx.lineStyle(4, 0x2e5429, 1); bGfx.lineBetween(0, valleyTop(0), W, valleyTop(W));

  // 2. ASFALTO (bGfx)
  drawPoly(bGfx, 0x2a2a30, [{x:0, y:curbY(0)}, {x:W, y:curbY(W)}, {x:W, y:cliffY(W)}, {x:0, y:cliffY(0)}]);

  // 3 y 4. ANDENES Y TEXTURA DE ASFALTO
  const sSpace = 120, lSpace = 160, objSpace = 100;
  for (let x = W + sSpace - (distance % sSpace); x > -sSpace; x -= sSpace) {
    let nx = x - sSpace;
    drawPoly(bGfx, 0xdcdfe2, [{x:x, y:curbY(x)}, {x:nx, y:curbY(nx)}, {x:nx, y:curbY(nx)-16}, {x:x, y:curbY(x)-16}]);
    drawPoly(bGfx, 0x9aa0a6, [{x:x, y:curbY(x)}, {x:nx, y:curbY(nx)}, {x:nx, y:curbY(nx)-4}, {x:x, y:curbY(x)-4}]);
  }

  for (let x = W + lSpace - (distance % lSpace); x > -lSpace; x -= lSpace) {
    let y = (curbY(x) + cliffY(x)) / 2, rw = cliffY(x) - curbY(x);
    bGfx.fillStyle(0x1a1a20, 0.6); bGfx.fillRect(x-30, y-rw*0.25, 45, 12); bGfx.fillRect(x-80, y+rw*0.2, 35, 15);
    drawPoly(bGfx, 0x111115, [{x:x-20, y:y}, {x:x-35, y:y-8}, {x:x-15, y:y-14}]);
  }

  // 5. DIVISIÓN DEL PROCEDURAL: Ladera al Fondo, Valle al Frente
  for (let x = -objSpace - (distance % objSpace); x <= W + objSpace; x += objSpace) {
    let wId = Math.floor((x + distance) / objSpace);
    let r1 = Math.abs(Math.sin(wId * 12.9898) * 43758.5453) % 1, r2 = Math.abs(Math.cos(wId * 4.1415) * 43758.5453) % 1;
    
    if (r1 > 0.35) {
      if (r1 > 0.9) drawIsoHouse(bGfx, x, curbY(x) - 10 - r2 * 40, 6.5, wId % 2 !== 0);
      else drawIsoTree(bGfx, x, curbY(x) - 60 - r2 * 80, 5.5);
    }
    
    if (r2 > 0.25) {
      if (r2 > 0.85) drawIsoHouse(fGfx, x-10, cliffY(x) + 100 + r1 * 50, 6.5, wId % 2 === 0);
      else drawIsoTree(fGfx, x, cliffY(x) + 70 + r1 * 100, 5.5);
    }
  }
}

function createParticleSystem(scene) {
  scene.particles = [];
  scene.particleGraphics = scene.add.graphics().setDepth(4);
}

function resetParticles(scene) {
  if (scene.particles) scene.particles.length = 0;
  if (scene.particleGraphics) scene.particleGraphics.clear();
}

function emitSlideParticles(scene, player, speed, dt) {
  if (!player.alive || player.jumping || player.jumpZ > 0.05) return;

  // Tasa de emisión escala fuertemente con la velocidad (de ~20/s a 200 km/h hasta ~90/s a 900 km/h)
  const normSpd = Math.max(0, Math.min(1, (speed - 200) / 700));
  const rate = Phaser.Math.Linear(20, 90, normSpd);
  const count = Math.random() < (rate * dt) ? (normSpd > 0.5 && Math.random() < 0.4 ? 2 : 1) : 0;
  if (count <= 0) return;

  for (let i = 0; i < count; i++) {
    // Puntos de contacto de la canasta con el asfalto (esquinas y base)
    const offsetX = Phaser.Math.Between(-14, 14);
    const offsetY = Phaser.Math.Between(12, 17);
    const px = player.x + offsetX;
    const py = player.y + offsetY;

    const isSpark = Math.random() < 0.7; // 70% chispas de fricción, 30% polvillo/humo
    if (isSpark) {
      // Chispas salen disparadas hacia atrás y hacia arriba por la fricción del pavimento
      const angle = Math.PI * 0.75 + Phaser.Math.FloatBetween(-0.55, 0.55);
      const spd = Phaser.Math.FloatBetween(40, 130) * (0.8 + normSpd * 0.8);
      const sparkColors = [0xffdd00, 0xff9900, 0xffffff, 0xff4400];
      scene.particles.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * spd - (speed * 0.22),
        vy: Math.sin(angle) * spd * 0.35 - Phaser.Math.FloatBetween(12, 35),
        life: 0,
        maxLife: Phaser.Math.FloatBetween(0.12, 0.28),
        size: Phaser.Math.FloatBetween(1.8, 3.2),
        color: sparkColors[Math.floor(Math.random() * sparkColors.length)],
        alpha: 1,
        type: 'spark',
      });
    } else {
      // Polvillo / humo de fricción en el asfalto
      scene.particles.push({
        x: px,
        y: py,
        vx: Phaser.Math.FloatBetween(-20, -5) - (speed * 0.12),
        vy: Phaser.Math.FloatBetween(-8, -20),
        life: 0,
        maxLife: Phaser.Math.FloatBetween(0.2, 0.45),
        size: Phaser.Math.FloatBetween(2.5, 5.0),
        color: 0x9999aa,
        alpha: 0.45,
        type: 'smoke',
      });
    }
  }
}

function emitLandingBurst(scene, player, speed) {
  if (!player.alive) return;
  const num = 12;
  for (let i = 0; i < num; i++) {
    const angle = (i / num) * Math.PI * 2;
    const spd = Phaser.Math.FloatBetween(35, 100);
    const sparkColors = [0xffdd00, 0xff7700, 0xffffff, 0xff3300];
    scene.particles.push({
      x: player.x + Phaser.Math.Between(-12, 12),
      y: player.y + 14,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd * 0.5 - 15,
      life: 0,
      maxLife: Phaser.Math.FloatBetween(0.15, 0.35),
      size: Phaser.Math.FloatBetween(2, 3.5),
      color: sparkColors[i % sparkColors.length],
      alpha: 1,
      type: 'spark',
    });
  }
}

function updateParticles(scene, delta) {
  const dt = delta / 1000;
  const gfx = scene.particleGraphics;
  if (!gfx) return;
  gfx.clear();

  for (let i = scene.particles.length - 1; i >= 0; i--) {
    const p = scene.particles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      scene.particles.splice(i, 1);
      continue;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const progress = p.life / p.maxLife;
    const curAlpha = p.alpha * (1 - progress);

    if (p.type === 'spark') {
      gfx.fillStyle(p.color, curAlpha);
      gfx.fillRect(p.x, p.y, p.size, p.size);
    } else {
      gfx.fillStyle(p.color, curAlpha * 0.4);
      gfx.fillCircle(p.x, p.y, p.size * (1 + progress * 0.7));
    }
  }
}

function createPlayers(scene) {
  scene.players = {
    p1: {
      lat: 40,  // Posición lateral inicial (izquierda visualmente)
      prog: 0,  // Posición adelante(+)/atrás(-) respecto a la línea del pelotón
      x: 0, y: 0, 
      score: 0,
      jumping: false, jumpTimer: 0, jumpLanding: false, landTimer: 0, landStartZ: 0, jumpZ: 0,
      pushing: false,
      pushCooldown: 0,
      paralyzed: 0,
      knockbackVel: 0,
      alive: true,
      label: 'P1',
    },
    p2: {
      lat: -40, // Posición lateral inicial (derecha visualmente)
      prog: 0,
      x: 0, y: 0,
      score: 0,
      jumping: false, jumpTimer: 0, jumpLanding: false, landTimer: 0, landStartZ: 0, jumpZ: 0,
      pushing: false,
      pushCooldown: 0,
      paralyzed: 0,
      knockbackVel: 0,
      alive: true,
      label: 'P2',
    },
  };
  scene.p1Gfx = scene.add.graphics().setDepth(5);
  scene.p2Gfx = scene.add.graphics().setDepth(5);
  renderPlayers(scene);
}

function renderPlayers(scene, time, speed) {
  scene.p1Gfx.clear();
  scene.p2Gfx.clear();
  const { p1, p2 } = scene.players;
  renderOnePlayer(scene.p1Gfx, p1, time, speed, scene);
  renderOnePlayer(scene.p2Gfx, p2, time, speed, scene);
}

function renderOnePlayer(gfx, player, time, speed, scene) {
  if (!player.alive) return;

  // Parpadeo al estar paralizado: alterna opacidad cada 80ms
  const blinking = player.paralyzed > 0 && Math.floor((time || 0) / 80) % 2 === 0;
  gfx.setAlpha(blinking ? 0.25 : 1.0);

  // Landing squash & burst — detectar transición jumpZ > 0 → 0
  const prevJZ = player._prevJZ || 0;
  const descending = prevJZ > player.jumpZ && player.jumpZ > 0.01;
  if (prevJZ > 0.08 && player.jumpZ <= 0.01 && !player.jumping && scene) {
    emitLandingBurst(scene, player, speed);
  }
  player._prevJZ = player.jumpZ;

  // Sombra en el piso (se achica mientras el jugador está en el aire)
  const shrink = 1 - player.jumpZ * 0.5;
  gfx.fillStyle(0x000000, 0.3);
  gfx.fillEllipse(player.x, player.y + 14, 34 * shrink, 10 * shrink);

  // Destello rojo breve mientras está paralizado tras un golpe
  if (player.paralyzed > 0) {
    gfx.fillStyle(0xff3333, 0.35 * Math.min(1, player.paralyzed / PARALYZE_DURATION));
    gfx.fillCircle(player.x, player.y, 46);
  }

  // Frecuencia de ondeo: crece linealmente con velocidad hasta doblar, nunca baja
  const targetWF = 0.0008 + Math.min(speed / 600, 1) * 0.0292;
  player._wF = Math.max(player._wF || 0.008, targetWF);

  // Trepidación / vibración mecánica sobre el asfalto a altas velocidades
  const isGrounded = (!player.jumping || player.jumpZ <= 0.02) && player.paralyzed <= 0;
  const jitterAmp = isGrounded ? Math.min(1.2, (speed / 900) * 1.2) : 0;
  const jitterY = jitterAmp > 0 ? (Math.sin((time || 0) * 0.05 + (player.label === 'P1' ? 0 : 2.5)) * jitterAmp) : 0;

  // Canasta y personaje suben juntos; al bajar el personaje cae más lento (flotación)
  const liftY = player.y - player.jumpZ * 46 + jitterY;
  const charJZ = descending ? Math.pow(player.jumpZ, 0.4) : player.jumpZ;
  const charY  = player.y - charJZ * 46 + jitterY;
  const pushDir = (player._pushT && (time - player._pushT) < 350) ? player._pushDir : 0;
  drawBeerCrate(gfx, player.x, liftY, 3);
  if (player.label === 'P1') drawNea(gfx, player.x, charY, 3, time, speed, charJZ, player._wF, pushDir);
  else drawChango(gfx, player.x, charY, 3, time, speed, charJZ, player._wF, pushDir);
}

function drawIsoBlock(gfx, cx, cy, w, d, h, cFront, cSide, cTop, cLine) {
  const tyL = w * 0.5, tyR = d * 0.5;
  drawPoly(gfx, cSide, [{x:cx,y:cy}, {x:cx+d,y:cy-tyR}, {x:cx+d,y:cy-tyR-h}, {x:cx,y:cy-h}]);
  drawPoly(gfx, cFront, [{x:cx,y:cy}, {x:cx-w,y:cy-tyL}, {x:cx-w,y:cy-tyL-h}, {x:cx,y:cy-h}]);
  drawPoly(gfx, cTop, [{x:cx,y:cy-h}, {x:cx-w,y:cy-tyL-h}, {x:cx-w+d,y:cy-tyL-tyR-h}, {x:cx+d,y:cy-tyR-h}]);
  if (cLine) {
    gfx.lineStyle(2, cLine, 1);
    gfx.strokePoints([{x:cx-w,y:cy-tyL},{x:cx,y:cy},{x:cx+d,y:cy-tyR},{x:cx+d,y:cy-tyR-h},{x:cx-w+d,y:cy-tyL-tyR-h},{x:cx-w,y:cy-tyL-h}], true);
    gfx.lineBetween(cx, cy, cx, cy-h); gfx.lineBetween(cx-w, cy-tyL-h, cx, cy-h); gfx.lineBetween(cx+d, cy-tyR-h, cx, cy-h);
  }
}

function drawIsoTree(gfx, cx, cy, scale = 2) {
  gfx.fillStyle(0x000000, 0.2); gfx.fillEllipse(cx, cy, 14*scale, 7*scale);
  gfx.fillStyle(0x4a2e1b, 1); gfx.fillRect(cx - 2*scale, cy - 8*scale, 4*scale, 8*scale);
  drawIsoBlock(gfx, cx, cy - 6*scale, 9*scale, 9*scale, 9*scale, 0x2e5928, 0x1f3d1b, 0x3d7035);
  drawIsoBlock(gfx, cx, cy - 13*scale, 6*scale, 6*scale, 6*scale, 0x3d7035, 0x2e5928, 0x4a8540);
}

function drawIsoHouse(gfx, cx, cy, scale = 2.5, isAltColor) {
  const s = scale, fw = 14*s, dw = 12*s, h = 12*s;
  drawIsoBlock(gfx, cx, cy, fw, dw, h, isAltColor ? 0xd95a53 : 0xeaddcf, isAltColor ? 0xa8413b : 0xbfb4a8, 0x3a3a3a);
  drawPoly(gfx, 0x3d2314, [{x:cx-3*s, y:cy-1.5*s}, {x:cx-7*s, y:cy-3.5*s}, {x:cx-7*s, y:cy-3.5*s-6*s}, {x:cx-3*s, y:cy-1.5*s-6*s}]);
  drawPoly(gfx, 0x112233, [{x:cx+3*s, y:cy-1.5*s-4*s}, {x:cx+7*s, y:cy-3.5*s-4*s}, {x:cx+7*s, y:cy-3.5*s-7*s}, {x:cx+3*s, y:cy-1.5*s-7*s}]);
}

function drawIsoCross(gfx, cx, cy, scale = 2) {
  const s = scale, cF = 0xcccccc, cS = 0x888899, cT = 0xeeeeee, cL = 0x222222;
  drawIsoBlock(gfx, cx, cy, 4*s, 4*s, 16*s, cF, cS, cT, cL);
  drawIsoBlock(gfx, cx + 7*s, cy - 10*s, 16*s, 4*s, 4*s, cF, cS, cT, cL);
  drawIsoBlock(gfx, cx, cy - 20*s, 4*s, 4*s, 8*s, cF, cS, cT, cL);
}

function drawIsoChurch(gfx, cx, cy, scale = 2.5) {
  const s = scale, nx = cx + 15*s, ny = cy - 10*s, cWallF = 0xf0f0f0, cWallS = 0xa0a0a8, cLine = 0x222222;
  drawIsoBlock(gfx, nx, ny, 25*s, 20*s, 18*s, cWallF, cWallS, 0xdddddd, cLine);
  drawPoly(gfx, 0x8c4c3e, [{x:nx, y:ny-18*s}, {x:nx-25*s, y:ny-30.5*s}, {x:nx-12.5*s, y:ny-36.25*s}]);
  drawPoly(gfx, 0x5e332a, [{x:nx, y:ny-18*s}, {x:nx-12.5*s, y:ny-36.25*s}, {x:nx+7.5*s, y:ny-46.25*s}, {x:nx+20*s, y:ny-28*s}]);
  
  drawIsoBlock(gfx, cx, cy, 14*s, 14*s, 35*s, cWallF, cWallS, 0xdddddd, cLine);
  drawPoly(gfx, 0x5e332a, [{x:cx-3*s,y:cy-1.5*s},{x:cx-11*s,y:cy-5.5*s},{x:cx-11*s,y:cy-15.5*s},{x:cx-3*s,y:cy-11.5*s}]);
  gfx.lineStyle(1.5, cLine, 1); gfx.lineBetween(cx-7*s, cy-3.5*s, cx-7*s, cy-13.5*s);
  [15, 25].forEach(yOff => drawPoly(gfx, 0x336699, [{x:cx-4*s,y:cy-2*s-yOff},{x:cx-10*s,y:cy-5*s-yOff},{x:cx-10*s,y:cy-12*s-yOff},{x:cx-4*s,y:cy-9*s-yOff}]));

  let tw = 14*s, td = 14*s, ty = cy - 35*s, tx = cx;
  for(let i=0; i<4; i++) {
    drawIsoBlock(gfx, tx, ty, tw, td, 4*s, 0x8c4c3e, 0x5e332a, 0x8c4c3e, cLine);
    tw -= 3*s; td -= 3*s; tx -= 1.5*s; ty -= 4.75*s;
  }
}
// ---------------------------------------------------------------------------
// Obstacles — huecos (small), borrachos/botellas (large) y baranda de drift
// ---------------------------------------------------------------------------

// --- Arte procedural -------------------------------------------------------
function drawPothole(gfx, cx, cy, scale) {
  const s = scale || 1;
  const rx = 26 * s;
  const ry = 12 * s; // achatado para respetar la perspectiva de la pista

  gfx.fillStyle(0x0d0d10, 1);
  gfx.fillEllipse(cx, cy, rx * 2.15, ry * 2.15);

  gfx.fillStyle(0x2a2a30, 1);
  gfx.fillEllipse(cx, cy, rx * 1.8, ry * 1.8);

  gfx.fillStyle(0x000000, 1);
  gfx.fillEllipse(cx, cy, rx, ry);

  gfx.lineStyle(2 * s, 0x1a1a1a, 1);
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    const x2 = cx + Math.cos(ang) * rx * 1.9;
    const y2 = cy + Math.sin(ang) * ry * 1.9;
    gfx.lineBetween(cx + Math.cos(ang) * rx * 0.9, cy + Math.sin(ang) * ry * 0.9, x2, y2);
  }

  gfx.lineStyle(1.5 * s, 0x55555a, 0.6);
  gfx.strokeEllipse(cx, cy - ry * 0.15, rx * 1.75, ry * 1.75);
}

function drawBottle(gfx, x, y, s, tilt) {
  const C_GLASS = 0x2e7d32;
  const C_LABEL = 0xf5f5f0;
  const C_CAP   = 0x8a8a8a;
  const bw = 3 * s, bh = 9 * s;
  const ox = tilt * 2 * s;

  gfx.fillStyle(C_GLASS, 1);
  gfx.fillRoundedRect(x - bw / 2, y - bh / 2, bw, bh, s);
  gfx.fillRect(x - bw / 4 + ox, y - bh / 2 - 2 * s, bw / 2, 2.5 * s);

  gfx.fillStyle(C_CAP, 1);
  gfx.fillRect(x - bw / 5 + ox, y - bh / 2 - 3 * s, bw / 2.5, 1.5 * s);

  gfx.fillStyle(C_LABEL, 1);
  gfx.fillRect(x - bw / 2, y - 1 * s, bw, 3 * s);
}

function drawDrunkObstacle(gfx, cx, cy, scale) {
  const s = scale || 3;

  gfx.fillStyle(0x000000, 0.35);
  gfx.fillEllipse(cx, cy + 4 * s, 40 * s, 12 * s);

  const C_SKIN  = 0xc98a5b;
  const C_SHIRT = 0xf2f2f2;
  const C_PANTS = 0x2b2b40;
  const C_HAIR  = 0x1a1208;
  const C_DARK  = 0x1a1a1a;
  const C_RUANA = 0xb33a3a;

  gfx.fillStyle(C_PANTS, 1);
  gfx.fillRoundedRect(cx - 36 * s, cy - 3 * s, 20 * s, 6 * s, 3 * s);
  gfx.fillRoundedRect(cx - 30 * s, cy + 3 * s, 18 * s, 6 * s, 3 * s);

  gfx.fillStyle(C_RUANA, 1);
  gfx.fillRoundedRect(cx - 16 * s, cy - 6 * s, 24 * s, 12 * s, 4 * s);
  gfx.lineStyle(1 * s, 0x7a2424, 1);
  gfx.lineBetween(cx - 16 * s, cy, cx + 8 * s, cy);

  gfx.fillStyle(C_SHIRT, 1);
  gfx.fillRoundedRect(cx - 4 * s, cy - 5 * s, 10 * s, 10 * s, 3 * s);

  gfx.fillStyle(C_SKIN, 1);
  gfx.fillRoundedRect(cx - 2 * s, cy - 9 * s, 14 * s, 4 * s, 2 * s);

  gfx.fillStyle(C_SKIN, 1);
  gfx.fillCircle(cx + 14 * s, cy - 2 * s, 6 * s);
  gfx.fillStyle(C_HAIR, 1);
  gfx.fillEllipse(cx + 12 * s, cy - 6 * s, 10 * s, 5 * s);
  gfx.lineStyle(1 * s, C_DARK, 0.6);
  gfx.strokeCircle(cx + 14 * s, cy - 2 * s, 6 * s);

  drawBottle(gfx, cx - 22 * s, cy - 15 * s, s, 0.4);
  drawBottle(gfx, cx + 4 * s,  cy + 13 * s, s, -0.6);
  drawBottle(gfx, cx - 38 * s, cy + 11 * s, s, 1.0);
}

function drawAbyssBridge(gfx, cx, bridgeLat, scale, length) {
  const s = scale || 1;
  const aw = (length || 80) * s;  // longitud del abismo en px
  const half = aw / 2;
  const x1 = cx - half;
  const x2 = cx + half;

  const y1_curb = trackCurbY(x1);
  const y1_cliff = trackCliffY(x1);
  const y2_curb = trackCurbY(x2);
  const y2_cliff = trackCliffY(x2);

  const y1_top = y1_curb - 35;
  const y1_bot = y1_cliff + 45;
  const y2_top = y2_curb - 35;
  const y2_bot = y2_cliff + 45;

  // =========================================================================
  // 1. ABISMO PROFUNDO ESTRUCTURAL (Foso con paredes rocosas y profundidad 3D)
  // =========================================================================
  // Fondo negro abisal
  gfx.fillStyle(0x03030a, 1);
  gfx.fillPoints([
    { x: x1, y: y1_top }, { x: x2, y: y2_top },
    { x: x2, y: y2_bot }, { x: x1, y: y1_bot },
  ], true);

  // Pared rocosa izquierda (estrato rocoso en perspectiva)
  const wallW = Math.min(aw * 0.4, 45);
  gfx.fillStyle(0x181824, 1);
  gfx.fillPoints([
    { x: x1, y: y1_top },
    { x: x1 + wallW, y: y1_top + 20 },
    { x: x1 + wallW * 0.8, y: y1_bot - 20 },
    { x: x1, y: y1_bot },
  ], true);

  // Estratos de roca intermedia
  gfx.fillStyle(0x0f0f1c, 1);
  gfx.fillPoints([
    { x: x1 + wallW * 0.5, y: y1_top + 40 },
    { x: x2 - 5, y: y2_top + 60 },
    { x: x2 - 5, y: y2_bot - 10 },
    { x: x1 + wallW * 0.4, y: y1_bot - 10 },
  ], true);

  // Grietas y sombras profundas en el foso
  gfx.lineStyle(2 * s, 0x080812, 1);
  gfx.lineBetween(x1 + wallW * 0.5, y1_top + 40, x1 + wallW * 0.8, y1_bot - 20);

  // =========================================================================
  // 2. BORDES DE ASFALTO FRACTURADOS Y VARILLAS EXPUESTAS
  // =========================================================================
  // Borde de corte de asfalto izquierdo (x1)
  gfx.fillStyle(0x22222c, 1);
  gfx.fillPoints([
    { x: x1 - 6, y: y1_curb - 12 }, { x: x1, y: y1_curb - 12 },
    { x: x1, y: y1_cliff + 12 }, { x: x1 - 6, y: y1_cliff + 12 },
  ], true);
  // Línea de brillo en el borde de fractura
  gfx.lineStyle(1.8 * s, 0x484856, 1);
  gfx.lineBetween(x1 - 6, y1_curb - 12, x1 - 6, y1_cliff + 12);

  // Borde de corte de asfalto derecho (x2)
  gfx.fillStyle(0x1c1c24, 1);
  gfx.fillPoints([
    { x: x2, y: y2_curb - 12 }, { x: x2 + 6, y: y2_curb - 12 },
    { x: x2 + 6, y: y2_cliff + 12 }, { x: x2, y: y2_cliff + 12 },
  ], true);
  gfx.lineStyle(1.8 * s, 0x3a3a46, 1);
  gfx.lineBetween(x2 + 6, y2_curb - 12, x2 + 6, y2_cliff + 12);

  // Varillas de acero oxidado que asoman del asfalto roto
  const rebarColors = [0x9e4a24, 0xbf6432, 0x7a3418];
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    const ry1 = y1_curb + t * (y1_cliff - y1_curb);
    const rLen1 = 8 + (i % 3) * 5;
    gfx.lineStyle(2, rebarColors[i % 3], 1);
    gfx.lineBetween(x1, ry1, x1 + rLen1, ry1 + (i % 2 === 0 ? 3 : -3));

    const ry2 = y2_curb + t * (y2_cliff - y2_curb);
    const rLen2 = 7 + ((i + 1) % 3) * 5;
    gfx.lineStyle(2, rebarColors[i % 3], 1);
    gfx.lineBetween(x2, ry2, x2 - rLen2, ry2 + (i % 2 === 0 ? -2 : 3));
  }

  // Señalización vial de peligro: Conos de obra reflectivos en los extremos del asfalto
  const drawCone = (cx, cy) => {
    gfx.fillStyle(0x1a1a1a, 1);
    gfx.fillRect(cx - 5, cy + 4, 10, 3);
    gfx.fillStyle(0xff4400, 1);
    gfx.fillTriangle(cx - 4, cy + 4, cx + 4, cy + 4, cx, cy - 10);
    gfx.fillStyle(0xffffff, 1);
    gfx.fillRect(cx - 2, cy - 3, 4, 3);
  };
  drawCone(x1 - 12, y1_curb + 10);
  drawCone(x1 - 12, y1_cliff - 15);
  drawCone(x2 + 12, y2_curb + 10);
  drawCone(x2 + 12, y2_cliff - 15);

  // =========================================================================
  // 3. ESTRUCTURA Y VIGAS DE SOPORTE DEL PUENTE (Under-truss)
  // =========================================================================
  const bHalf = 16; // Mitad del ancho del puente en unidades de lat
  const bMin = bridgeLat - bHalf;
  const bMax = bridgeLat + bHalf;

  const y1t = laneY(x1, bMin), y1b = laneY(x1, bMax);
  const y2t = laneY(x2, bMin), y2b = laneY(x2, bMax);
  const midY_b = (y1b + y2b) / 2;

  // Sombra proyectada del puente en el abismo
  gfx.fillStyle(0x000000, 0.45);
  gfx.fillPoints([
    { x: x1, y: y1t + 30 }, { x: x2, y: y2t + 30 },
    { x: x2, y: y2b + 38 }, { x: x1, y: y1b + 38 },
  ], true);

  // Vigas pesadas de madera/hierro que sostienen el puente desde las paredes del foso
  gfx.lineStyle(4 * s, 0x221208, 1);
  gfx.lineBetween(x1, y1b + 28, cx, midY_b + 22);
  gfx.lineBetween(x2, y2b + 28, cx, midY_b + 22);
  gfx.lineStyle(2 * s, 0x482812, 1);
  gfx.lineBetween(x1, y1b + 26, cx, midY_b + 20);
  gfx.lineBetween(x2, y2b + 26, cx, midY_b + 20);

  // Tensores verticales bajo la plataforma
  gfx.lineStyle(1.5 * s, 0x5a351a, 0.9);
  gfx.lineBetween(cx, (y1t + y2t) / 2, cx, midY_b + 20);

  // =========================================================================
  // 4. PLATAFORMA DE TABLONES DE MADERA (3D Deck)
  // =========================================================================
  // Fascia / Borde frontal 3D de madera (da espesor visible a la pasarela)
  const deckThickness = 7 * s;
  gfx.fillStyle(0x381c0c, 1);
  gfx.fillPoints([
    { x: x1, y: y1b }, { x: x2, y: y2b },
    { x: x2, y: y2b + deckThickness }, { x: x1, y: y1b + deckThickness },
  ], true);
  gfx.lineStyle(1.5 * s, 0x5c3016, 1);
  gfx.lineBetween(x1, y1b, x2, y2b);

  // Tablones individuales rústicos
  const plankWidth = 8.5 * s;
  const numPlanks = Math.max(4, Math.floor(aw / plankWidth));
  const woodTones = [0x7c4a26, 0x6e3f1e, 0x8a552e, 0x5e3417, 0x774523];

  for (let i = 0; i < numPlanks; i++) {
    const px1 = x1 + (i / numPlanks) * aw;
    const px2 = x1 + ((i + 0.9) / numPlanks) * aw;

    const pt1 = laneY(px1, bMin), pb1 = laneY(px1, bMax);
    const pt2 = laneY(px2, bMin), pb2 = laneY(px2, bMax);

    gfx.fillStyle(woodTones[i % woodTones.length], 1);
    gfx.fillPoints([
      { x: px1, y: pt1 }, { x: px2, y: pt2 },
      { x: px2, y: pb2 }, { x: px1, y: pb1 },
    ], true);

    // Separación oscura entre tablones
    gfx.lineStyle(1.2 * s, 0x1a0d06, 0.85);
    gfx.lineBetween(px2, pt2, px2, pb2);

    // Clavos / pernos de hierro en los extremos de las tablas
    gfx.fillStyle(0x22130b, 1);
    gfx.fillRect(px1 + 1.5, pt1 + 1.5, 2.2, 2.2);
    gfx.fillRect(px1 + 1.5, pb1 - 3.5, 2.2, 2.2);
  }

  // =========================================================================
  // 5. BARANDAS OXIDADAS DE SAN ANTONIO (Con Malla, Tubos y Reflectivos)
  // =========================================================================
  const postHeight = 18 * s;
  const numPosts = Math.max(3, Math.floor(aw / (22 * s)));

  // Parantes verticales oxidados a lo largo de ambos lados
  for (let i = 0; i <= numPosts; i++) {
    const t = i / numPosts;
    const px = x1 + t * aw;
    const pTopY = laneY(px, bMin);
    const pBotY = laneY(px, bMax);

    // Postes superiores
    gfx.fillStyle(0x381408, 1); // sombra
    gfx.fillRect(px - 2.5 * s, pTopY - postHeight, 5 * s, postHeight);
    gfx.fillStyle(0x823716, 1); // tono óxido
    gfx.fillRect(px - 1.5 * s, pTopY - postHeight, 3 * s, postHeight);
    gfx.fillStyle(0xb55122, 1); // brillo óxido superior
    gfx.fillRect(px - 1.5 * s, pTopY - postHeight, 3 * s, 3 * s);

    // Postes inferiores
    gfx.fillStyle(0x381408, 1);
    gfx.fillRect(px - 2.5 * s, pBotY - postHeight, 5 * s, postHeight);
    gfx.fillStyle(0x823716, 1);
    gfx.fillRect(px - 1.5 * s, pBotY - postHeight, 3 * s, postHeight);
    gfx.fillStyle(0xb55122, 1);
    gfx.fillRect(px - 1.5 * s, pBotY - postHeight, 3 * s, 3 * s);

    // Cruces de alambre oxidado (malla de seguridad) entre postes
    if (i < numPosts) {
      const nextPx = x1 + ((i + 1) / numPosts) * aw;
      const nextTopY = laneY(nextPx, bMin);
      const nextBotY = laneY(nextPx, bMax);

      gfx.lineStyle(1.2 * s, 0x52230e, 0.8);
      // Malla baranda superior
      gfx.lineBetween(px, pTopY - 2 * s, nextPx, nextTopY - postHeight + 3 * s);
      gfx.lineBetween(px, pTopY - postHeight + 3 * s, nextPx, nextTopY - 2 * s);
      // Malla baranda inferior
      gfx.lineBetween(px, pBotY - 2 * s, nextPx, nextBotY - postHeight + 3 * s);
      gfx.lineBetween(px, pBotY - postHeight + 3 * s, nextPx, nextBotY - 2 * s);
    }
  }

  // Tubos horizontales principales de la baranda oxidada
  // -- Baranda Superior --
  gfx.lineStyle(4 * s, 0x2a0c04, 1); // sombra
  gfx.lineBetween(x1, y1t - postHeight + 2, x2, y2t - postHeight + 2);
  gfx.lineStyle(3 * s, 0x8a3916, 1); // óxido principal
  gfx.lineBetween(x1, y1t - postHeight, x2, y2t - postHeight);
  gfx.lineStyle(1.2 * s, 0xc8602b, 1); // filo brillante superior
  gfx.lineBetween(x1, y1t - postHeight - 1, x2, y2t - postHeight - 1);
  // Tubo intermedio
  gfx.lineStyle(2 * s, 0x732e12, 1);
  gfx.lineBetween(x1, y1t - postHeight * 0.5, x2, y2t - postHeight * 0.5);

  // -- Baranda Inferior --
  gfx.lineStyle(4 * s, 0x2a0c04, 1);
  gfx.lineBetween(x1, y1b - postHeight + 2, x2, y2b - postHeight + 2);
  gfx.lineStyle(3 * s, 0x8a3916, 1);
  gfx.lineBetween(x1, y1b - postHeight, x2, y2b - postHeight);
  gfx.lineStyle(1.2 * s, 0xc8602b, 1);
  gfx.lineBetween(x1, y1b - postHeight - 1, x2, y2b - postHeight - 1);
  // Tubo intermedio
  gfx.lineStyle(2 * s, 0x732e12, 1);
  gfx.lineBetween(x1, y1b - postHeight * 0.5, x2, y2b - postHeight * 0.5);

  // =========================================================================
  // 6. SEÑALES Y LUCES REFLECTIVAS EN LAS ENTRADAS DEL PUENTE
  // =========================================================================
  const drawEntryMarker = (ex, ey) => {
    // Poste reforzado
    gfx.fillStyle(0x1a1a1a, 1);
    gfx.fillRect(ex - 3.5 * s, ey - postHeight - 4 * s, 7 * s, postHeight + 4 * s);
    // Franjas de advertencia amarillo tráfico
    for (let f = 0; f < 3; f++) {
      gfx.fillStyle(f % 2 === 0 ? 0xf5b700 : 0x1a1a1a, 1);
      gfx.fillRect(ex - 3.5 * s, ey - postHeight - 2 * s + f * 5 * s, 7 * s, 4 * s);
    }
    // Reflector / Ojo de gato luminoso en la punta
    gfx.fillStyle(0xff8800, 0.9);
    gfx.fillCircle(ex, ey - postHeight - 5 * s, 4.5 * s);
    gfx.fillStyle(0xffff44, 1);
    gfx.fillCircle(ex, ey - postHeight - 5 * s, 2.2 * s);
  };

  drawEntryMarker(x1, y1t);
  drawEntryMarker(x1, y1b);
  drawEntryMarker(x2, y2t);
  drawEntryMarker(x2, y2b);
}

// --- Configuración por tipo -------------------------------------------------
// hazardRadius: mitad del ancho lateral que ocupa el peligro (en unidades de "lat")
// railGap: [min,max] de lat que SÍ es seguro pasar (pegado a la baranda) — el resto cae al vacío
const OBSTACLE_DEF = {
  hole:  { hazardRadius: 16, hitRadius: 30, scale: 1.1 },
  drunk: { hazardRadius: 26, hitRadius: 42, scale: 1.5 },
  rail:  { bridgeHalfW: 15, hitRadius: 40, scale: 1 },
};

const SPAWN_X = W + 120; // margen amplio para abismos largos
const DESPAWN_X = -120;

function createObstaclePool(scene) {
  scene.obstacles = [];
  scene.obstacleGraphics = scene.add.graphics().setDepth(3);
  scene.gameState.spawnTimer = 1.2; // primer obstáculo llega poco después de arrancar
}

function spawnObstacle(scene) {
  const phase = getDiffPhase(scene.gameState.elapsed);
  const type = rollObstacleType(phase);

  let lat, length, hitRadius;
  if (type === 'rail') {
    // El puente puede estar en cualquier posición lateral de la pista
    lat = Phaser.Math.Between(LAT_MIN + 22, LAT_MAX - 22);
    // Longitud variable del abismo (entre 55px y 160px)
    length = Phaser.Math.Between(55, 160);
    hitRadius = Math.round(length / 2) + 6;
  } else {
    lat = Phaser.Math.Between(LAT_MIN + 10, LAT_MAX - 10);
  }

  scene.obstacles.push({
    type, lat, length, hitRadius,
    x: SPAWN_X,
    resolvedP1: false,
    resolvedP2: false,
  });
}

function rollObstacleType(phase) {
  const r = Math.random();
  if (phase === 0) return r < 0.75 ? 'hole' : r < 0.92 ? 'drunk' : 'rail';
  if (phase === 1) return r < 0.40 ? 'hole' : r < 0.75 ? 'drunk' : 'rail';
  if (phase === 2) return r < 0.25 ? 'hole' : r < 0.60 ? 'drunk' : 'rail';
  return r < 0.20 ? 'hole' : r < 0.55 ? 'drunk' : 'rail';
}

function updateObstacles(scene, delta) {
  const dt = delta / 1000;
  const { p1, p2 } = scene.players;
  const gfx = scene.obstacleGraphics;

  // Spawn rate controlado por fase de dificultad
  const phase = getDiffPhase(scene.gameState.elapsed);
  const ds = DIFF_SETTINGS[phase];
  scene.gameState.spawnTimer -= dt;
  if (scene.gameState.spawnTimer <= 0) {
    spawnObstacle(scene);
    scene.gameState.spawnTimer = Phaser.Math.FloatBetween(ds.spawnMin, ds.spawnMax);
  }

  gfx.clear();

  for (let i = scene.obstacles.length - 1; i >= 0; i--) {
    const ob = scene.obstacles[i];
    ob.x -= scene.gameState.speed * dt;

    // Colisión por proximidad en pantalla (no por cruce de línea abstracta)
    checkObstacleProximity(scene, ob, p1, 'resolvedP1');
    checkObstacleProximity(scene, ob, p2, 'resolvedP2');

    const y = laneY(ob.x, ob.lat);
    const def = OBSTACLE_DEF[ob.type];
    if (ob.type === 'hole') drawPothole(gfx, ob.x, y, def.scale);
    else if (ob.type === 'drunk') drawDrunkObstacle(gfx, ob.x, y, def.scale);
    else if (ob.type === 'rail') drawAbyssBridge(gfx, ob.x, ob.lat, def.scale, ob.length);

    if (ob.x < DESPAWN_X) scene.obstacles.splice(i, 1);
  }
}

function checkObstacleProximity(scene, ob, player, flagKey) {
  if (ob[flagKey] || !player.alive) return;

  const def = OBSTACLE_DEF[ob.type];
  const obY = laneY(ob.x, ob.lat);

  if (ob.type === 'rail') {
    const halfLen = (ob.length || 80) / 2;
    // El abismo está activo en la coordenada X exacta donde se ubica el jugador en pantalla
    const inAbyssZone = (player.x >= ob.x - halfLen - 12) && (player.x <= ob.x + halfLen + 12);
    if (inAbyssZone) {
      const onBridge = Math.abs(player.lat - ob.lat) <= def.bridgeHalfW;
      const jumpingOver = player.jumping && player.jumpZ > 0.35;
      if (!onBridge && !jumpingOver) {
        // Cae al abismo apenas toca el hueco en pantalla
        ob[flagKey] = true;
        applyKnockback(scene, player);
      }
    } else if (ob.x + halfLen < player.x - 10 && !ob[flagKey]) {
      // Pasó exitosamente todo el tramo del puente
      A.sfx('jump');
      ob[flagKey] = true;
      player.score += 600;
      showScorePopup(scene, player.x, player.y - 35, '+600 DRIFT!', '#00ffff');
    }
  } else {
    // Huecos y borrachos: distancia real en pantalla
    const dx = ob.x - player.x;
    const dy = obY - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < def.hitRadius) {
      const inHazardLane = Math.abs(player.lat - ob.lat) < def.hazardRadius;
      if (!inHazardLane) {
        // Pasó de largo por el lado
        ob[flagKey] = true;
      } else if (isClearingJump(player, ob.type)) {
        // En el aire esquivando el obstáculo: seguro mientras se mantenga arriba
        if (ob.x < player.x - 5) {
          ob[flagKey] = true;
          const isHole = ob.type === 'hole';
          const pts = isHole ? 150 : 350;
          const label = isHole ? '+150' : '+350 SALTO!';
          const color = isHole ? '#00ff88' : '#ffdd00';
          player.score += pts;
          showScorePopup(scene, player.x, player.y - 35, label, color);
        }
      } else {
        // En el suelo sobre el obstáculo -> golpe
        ob[flagKey] = true;
        applyKnockback(scene, player);
      }
    }
  }
}

function resolveObstacleHit(scene, obstacle, player) {
  if (!player.alive) return;
  const def = OBSTACLE_DEF[obstacle.type];

  if (obstacle.type === 'rail') {
    // Solo estás a salvo si estás sobre el puente (auto-montaje)
    const onBridge = Math.abs(player.lat - obstacle.lat) <= def.bridgeHalfW;
    if (!onBridge) applyKnockback(scene, player);
    return;
  }
}

// Un obstáculo fallado NO es game over: te paraliza y te empuja hacia atrás
// gradualmente. Sólo perdés si salís de pantalla por el borde trasero.
function applyKnockback(scene, player) {
  player.paralyzed = PARALYZE_DURATION;
  player.knockbackVel = PROG_KNOCKBACK / PARALYZE_DURATION; // retroceso suave
  player.jumping = false;
  player.jumpLanding = false;
  player.jumpTimer = 0;
  player.jumpZ = 0;
  A.sfx('crash');
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function createHud(scene) {
  scene.hud = {};

  // P1 1UP (Neon Red/Pink)
  scene.hud.p1Score = scene.add.text(20, 10, '1UP NEA\n000000', {
    fontFamily: 'monospace', fontSize: '14px', color: '#ff4466', fontStyle: 'bold', lineSpacing: 2,
    stroke: '#000000', strokeThickness: 3,
  }).setDepth(10);

  // HIGH SCORE (Flashing Gold/Yellow in Center)
  scene.hud.hiScore = scene.add.text(W / 2, 10, 'HIGH SCORE\n045000', {
    fontFamily: 'monospace', fontSize: '14px', color: '#ffd700', fontStyle: 'bold', align: 'center', lineSpacing: 2,
    stroke: '#000000', strokeThickness: 3,
  }).setOrigin(0.5, 0).setDepth(10);

  // P2 2UP (Neon Cyan/Blue)
  scene.hud.p2Score = scene.add.text(W - 20, 10, '2UP CHG\n000000', {
    fontFamily: 'monospace', fontSize: '14px', color: '#00ccff', fontStyle: 'bold', align: 'right', lineSpacing: 2,
    stroke: '#000000', strokeThickness: 3,
  }).setOrigin(1, 0).setDepth(10);

  // Bottom Speed & Distance ticker
  scene.hud.speedDist = scene.add.text(W / 2, H - 18, '⚡ 200 km/h   🚩 0 m', {
    fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', fontStyle: 'bold',
    stroke: '#000000', strokeThickness: 3,
  }).setOrigin(0.5).setDepth(10);
}

function updateHud(scene) {
  const spd = Math.round(scene.gameState.speed);
  const dst = Math.round(scene.gameState.distance);
  const p1s = padScore(scene.players.p1.score);
  const p2s = padScore(scene.players.p2.score);
  const topScore = Math.max(scene.gameState.highScore || 45000, scene.players.p1.score, scene.players.p2.score);
  const hi = padScore(topScore);

  scene.hud.p1Score.setText(`1UP NEA\n${p1s}`);
  scene.hud.p2Score.setText(`2UP CHG\n${p2s}`);
  scene.hud.hiScore.setText(`HIGH SCORE\n${hi}`);
  scene.hud.speedDist.setText(`⚡ ${spd} km/h   🚩 ${dst} m`);
}

// ---------------------------------------------------------------------------
// Start screen — Splash Menu & Mode Selection
// ---------------------------------------------------------------------------
const MENU_ITEMS = [
  '1 JUGADOR  (VS CPU)',
  '2 JUGADORES (1 VS 1)',
  'TABLA DE RÉCORDS (TOP 5)',
];

function createStartScreen(scene) {
  const c = scene.add.container(0, 0).setDepth(20);
  c.add(scene.add.rectangle(W / 2, H / 2, W, H, 0x080810, 0.93));

  // Título e Identidad Visual
  c.add(scene.add.text(W / 2, 45, 'PLATANUS HACK 26 · ARCADE', {
    fontFamily: 'monospace', fontSize: '13px', color: '#886600', fontStyle: 'bold',
  }).setOrigin(0.5));
  c.add(scene.add.text(W / 2, 74, 'SAN ANTONIO DRIFT', {
    fontFamily: 'monospace', fontSize: '36px', color: '#ffdd00', fontStyle: 'bold',
    stroke: '#000000', strokeThickness: 5,
  }).setOrigin(0.5));
  c.add(scene.add.text(W / 2, 114, 'BARRIO SAN ANTONIO · CALI, COLOMBIA', {
    fontFamily: 'monospace', fontSize: '12px', color: '#888866',
  }).setOrigin(0.5));

  // Crate + character preview (Nea y Changó)
  const previewGfx = scene.add.graphics();
  const crateY = 216;
  const cx1 = W / 2 - 76;
  const cx2 = W / 2 + 76;
  drawBeerCrate(previewGfx, cx1, crateY, 3.8);
  drawNea(previewGfx, cx1, crateY, 3.8);           // P1 = Nea
  drawBeerCrate(previewGfx, cx2, crateY, 3.8);
  drawChango(previewGfx, cx2, crateY, 3.8);        // P2 = Changó
  c.add(previewGfx);

  c.add(scene.add.text(cx1, 244, 'P1  NEA', {
    fontFamily: 'monospace', fontSize: '11px', color: '#ff5555', fontStyle: 'bold',
  }).setOrigin(0.5));
  c.add(scene.add.text(cx2, 244, 'P2  CHANGÓ', {
    fontFamily: 'monospace', fontSize: '11px', color: '#5599ff', fontStyle: 'bold',
  }).setOrigin(0.5));

  // Opciones de Menú
  scene.startMenuIdx = 0;
  scene.startMenuTexts = [];
  const menuY = 296;
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const txt = scene.add.text(W / 2, menuY + i * 36, '', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    scene.startMenuTexts.push(txt);
    c.add(txt);
  }

  // High Score Attract Mode Ticker
  scene.startHiScoreText = scene.add.text(W / 2, menuY + MENU_ITEMS.length * 36 + 20, '★ RÉCORD: 045000 · NEAA VS CHGO ★', {
    fontFamily: 'monospace', fontSize: '12px', color: '#00ffcc', fontStyle: 'bold',
  }).setOrigin(0.5);
  c.add(scene.startHiScoreText);

  // Indicaciones inferiores
  c.add(scene.add.text(W / 2, H - 36, 'ARRIBA/ABAJO: ELEGIR MODO   |   START / BOTÓN 1: SELECCIONAR', {
    fontFamily: 'monospace', fontSize: '11px', color: '#ffdd00', fontStyle: 'bold',
  }).setOrigin(0.5));
  c.add(scene.add.text(W / 2, H - 18, 'P1: WASD / U   ·   P2: Flechas / R', {
    fontFamily: 'monospace', fontSize: '10px', color: '#555566',
  }).setOrigin(0.5));

  scene.startScreen = c;
  renderStartMenu(scene);
}

function renderStartMenu(scene) {
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const isSelected = i === scene.startMenuIdx;
    const txt = scene.startMenuTexts[i];
    if (isSelected) {
      txt.setText(`►  ${MENU_ITEMS[i]}  ◄`);
      txt.setColor('#ffdd00');
      txt.setFontSize(17);
    } else {
      txt.setText(`   ${MENU_ITEMS[i]}   `);
      txt.setColor('#777799');
      txt.setFontSize(14);
    }
  }
}

function showStartScreen(scene) {
  scene.phase = 'start';
  if (scene.startScreen) scene.startScreen.setVisible(true);
  if (scene.leaderboardScreen) scene.leaderboardScreen.setVisible(false);
  if (scene.nameEntryScreen) scene.nameEntryScreen.setVisible(false);
  if (scene.gameOverScreen) scene.gameOverScreen.setVisible(false);
  renderStartMenu(scene);
}

function updateStartScreen(scene, time) {
  // Navegación de menú
  if (consumePressed('P1_U') || consumePressed('P2_U')) {
    scene.startMenuIdx = (scene.startMenuIdx - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
    renderStartMenu(scene);
  }
  if (consumePressed('P1_D') || consumePressed('P2_D')) {
    scene.startMenuIdx = (scene.startMenuIdx + 1) % MENU_ITEMS.length;
    renderStartMenu(scene);
  }

  // Selección
  if (consumePressed('START1') || consumePressed('START2') || consumePressed('P1_1') || consumePressed('P2_1')) {
    A.init(); // <--- INYECTAR AQUÍ (Desbloquea el audio)
    scene.startScreen.setVisible(false);
    if (scene.startMenuIdx === 0) {
      // 1 JUGADOR (VS CPU)
      scene.gameState.gameMode = '1P';
      startGame(scene);
    } else if (scene.startMenuIdx === 1) {
      // 2 JUGADORES (1 VS 1)
      scene.gameState.gameMode = '2P';
      startGame(scene);
      showHowToPlayScreen(scene);
    } else if (scene.startMenuIdx === 2) {
      // TABLA DE RÉCORDS
      showLeaderboardScreen(scene);
    }
  }
}

// ---------------------------------------------------------------------------
// Leaderboard View Screen (Acceso desde el menú principal)
// ---------------------------------------------------------------------------
function createHowToPlayScreen(scene) {
  const c = scene.add.container(0, 0).setDepth(20).setVisible(false);
  c.add(scene.add.rectangle(W / 2, H / 2, W, H, 0x050512, 0.93));

  // Personajes
  const gfx = scene.add.graphics();
  const crateY = 210;
  const cx1 = W / 2 - 120, cx2 = W / 2 + 120;
  drawBeerCrate(gfx, cx1, crateY, 4); drawNea(gfx, cx1, crateY, 4);
  drawBeerCrate(gfx, cx2, crateY, 4); drawChango(gfx, cx2, crateY, 4);
  c.add(gfx);

  c.add(scene.add.text(W / 2, 32, '¿CÓMO JUGAR?', {
    fontFamily: 'monospace', fontSize: '32px', color: '#ffdd00', fontStyle: 'bold',
    stroke: '#000', strokeThickness: 5,
  }).setOrigin(0.5));

  c.add(scene.add.text(W / 2, 76, '¡Sé el último en caer al vacío o quedar atrás!', {
    fontFamily: 'monospace', fontSize: '16px', color: '#aaffcc', fontStyle: 'bold',
  }).setOrigin(0.5));

  // Controles — guardamos refs para mostrar/ocultar según modo
  const t = (x, y, str, col, sz) => scene.add.text(x, y, str, {
    fontFamily: 'monospace', fontSize: (sz || 15) + 'px', color: col || '#ffffff',
  }).setOrigin(0.5);

  const lh = 26; // line height
  const p1Lines = [
    t(cx1, 268, 'NEA  —  P1', '#ff6666', 17),
    t(cx1, 268 + lh,     '← Mover →   A / D', '#cccccc'),
    t(cx1, 268 + lh * 2, 'Saltar:  U  (mantener = largo)', '#cccccc'),
    t(cx1, 268 + lh * 3, 'Empujar: I', '#cccccc'),
  ];
  const p2Lines = [
    t(cx2, 268, 'CHANGÓ  —  P2', '#6699ff', 17),
    t(cx2, 268 + lh,     '← Mover →   ← / →', '#cccccc'),
    t(cx2, 268 + lh * 2, 'Saltar:  R  (mantener = largo)', '#cccccc'),
    t(cx2, 268 + lh * 3, 'Empujar: T', '#cccccc'),
  ];

  p1Lines.forEach(tx => c.add(tx));
  p2Lines.forEach(tx => c.add(tx));

  scene.htpP2Lines = p2Lines;

  c.add(scene.add.text(W / 2, H - 30, 'CUALQUIER BOTÓN PARA COMENZAR', {
    fontFamily: 'monospace', fontSize: '16px', color: '#ffdd00', fontStyle: 'bold',
  }).setOrigin(0.5));

  scene.howToPlayScreen = c;
}

function showHowToPlayScreen(scene) {
  scene.phase = 'howtoplay';
  scene.howToPlayScreen.setVisible(true);
  // Mostrar controles P2 solo en modo 2 jugadores
  const is2P = scene.gameState.gameMode === '2P';
  scene.htpP2Lines.forEach(tx => tx.setVisible(is2P));
}

function updateHowToPlayScreen(scene) {
  const anyBtn = consumePressed('START1') || consumePressed('START2') ||
    consumePressed('P1_1') || consumePressed('P2_1') ||
    consumePressed('P1_U') || consumePressed('P2_U');
  if (anyBtn) {
    scene.howToPlayScreen.setVisible(false);
    startGame(scene);
  }
}

function createLeaderboardScreen(scene) {
  const c = scene.add.container(0, 0).setDepth(20);
  c.add(scene.add.rectangle(W / 2, H / 2, W, H, 0x050512, 0.95));

  const bgGfx = scene.add.graphics();
  bgGfx.lineStyle(2, 0xffdd00, 0.8);
  bgGfx.strokeRect(36, 20, W - 72, H - 40);
  bgGfx.lineStyle(1, 0x00ccff, 0.5);
  bgGfx.strokeRect(40, 24, W - 80, H - 48);
  c.add(bgGfx);

  c.add(scene.add.text(W / 2, 55, '★ TABLA DE RÉCORDS HISTÓRICOS ★', {
    fontFamily: 'monospace', fontSize: '24px', color: '#ffdd00', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4,
  }).setOrigin(0.5));
  c.add(scene.add.text(W / 2, 90, 'BARRIO SAN ANTONIO · CALI', {
    fontFamily: 'monospace', fontSize: '12px', color: '#8888aa',
  }).setOrigin(0.5));

  c.add(scene.add.text(W / 2, 138, 'POS   DUELO (P1 VS P2)        PUNTAJE    DISTANCIA', {
    fontFamily: 'monospace', fontSize: '13px', color: '#00ffff', fontStyle: 'bold',
  }).setOrigin(0.5));

  scene.lbViewRows = [];
  const rankColors = ['#ffd700', '#e0e0e0', '#cd7f32', '#00ffff', '#ffff66'];
  for (let i = 0; i < 5; i++) {
    const row = scene.add.text(W / 2, 180 + i * 36, '', {
      fontFamily: 'monospace', fontSize: '14px', color: rankColors[i], fontStyle: 'bold',
    }).setOrigin(0.5);
    scene.lbViewRows.push(row);
    c.add(row);
  }

  const backPrompt = scene.add.text(W / 2, H - 50, 'PRESIONA START O BOTÓN 1 PARA VOLVER', {
    fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
  }).setOrigin(0.5);
  c.add(backPrompt);
  scene.tweens.add({
    targets: backPrompt, alpha: 0.2, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });

  scene.leaderboardScreen = c;
  c.setVisible(false);
}

function showLeaderboardScreen(scene) {
  scene.phase = 'leaderboard_view';
  const lb = scene.gameState.leaderboard || DEFAULT_SCORES;
  const rankLabels = ['1ST', '2ND', '3RD', '4TH', '5TH'];
  for (let i = 0; i < 5; i++) {
    const item = lb[i];
    if (item && scene.lbViewRows[i]) {
      const rank = rankLabels[i];
      const match = (item.matchup || item.name || '---- VS ----').padEnd(19, ' ');
      const sc = padScore(item.score);
      const d = `${item.dist || 0}m`.padStart(8, ' ');
      scene.lbViewRows[i].setText(`${rank}   ${match}  ${sc}   ${d}`);
    }
  }
  scene.leaderboardScreen.setVisible(true);
}

function updateLeaderboardScreen(scene, time) {
  if (consumePressed('START1') || consumePressed('START2') || consumePressed('P1_1') || consumePressed('P2_1')) {
    scene.leaderboardScreen.setVisible(false);
    showStartScreen(scene);
  }
}

// ---------------------------------------------------------------------------
// Name Entry Screen — 4 Iniciales por Jugador (P1 y P2)
// ---------------------------------------------------------------------------
const CHAR_SET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!- ';

function createNameEntryScreen(scene) {
  const c = scene.add.container(0, 0).setDepth(20);
  c.add(scene.add.rectangle(W / 2, H / 2, W, H, 0x050512, 0.95));

  const bgGfx = scene.add.graphics();
  bgGfx.lineStyle(2, 0xffdd00, 0.8);
  bgGfx.strokeRect(36, 20, W - 72, H - 40);
  bgGfx.lineStyle(1, 0x00ccff, 0.5);
  bgGfx.strokeRect(40, 24, W - 80, H - 48);
  c.add(bgGfx);

  scene.neTitle = scene.add.text(W / 2, 50, '¡FIN DE LA CARRERA!', {
    fontFamily: 'monospace', fontSize: '26px', color: '#ffdd00', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4,
  }).setOrigin(0.5);
  c.add(scene.neTitle);

  scene.neSub = scene.add.text(W / 2, 85, '', {
    fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
  }).setOrigin(0.5);
  c.add(scene.neSub);

  c.add(scene.add.text(W / 2, 120, 'REGISTREN SUS 4 INICIALES (P1 VS P2)', {
    fontFamily: 'monospace', fontSize: '13px', color: '#00ffcc', fontStyle: 'bold',
  }).setOrigin(0.5));

  // Cajas para las letras de P1
  c.add(scene.add.text(W / 2 - 170, 160, 'JUGADOR 1 (NEA)', {
    fontFamily: 'monospace', fontSize: '14px', color: '#ff4466', fontStyle: 'bold',
  }).setOrigin(0.5));

  scene.p1LetterTexts = [];
  for (let i = 0; i < 4; i++) {
    const lt = scene.add.text(W / 2 - 230 + i * 40, 210, 'A', {
      fontFamily: 'monospace', fontSize: '28px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);
    scene.p1LetterTexts.push(lt);
    c.add(lt);
  }

  // VS en el centro
  c.add(scene.add.text(W / 2, 210, 'VS', {
    fontFamily: 'monospace', fontSize: '24px', color: '#ffdd00', fontStyle: 'bold',
  }).setOrigin(0.5));

  // Cajas para las letras de P2
  scene.p2LabelText = scene.add.text(W / 2 + 170, 160, 'JUGADOR 2 (CHANGÓ)', {
    fontFamily: 'monospace', fontSize: '14px', color: '#00ccff', fontStyle: 'bold',
  }).setOrigin(0.5);
  c.add(scene.p2LabelText);

  scene.p2LetterTexts = [];
  for (let i = 0; i < 4; i++) {
    const lt = scene.add.text(W / 2 + 110 + i * 40, 210, 'A', {
      fontFamily: 'monospace', fontSize: '28px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);
    scene.p2LetterTexts.push(lt);
    c.add(lt);
  }

  // Gráficos para los cursores de selección activa
  scene.neCursorGfx = scene.add.graphics();
  c.add(scene.neCursorGfx);

  // Instrucciones
  c.add(scene.add.text(W / 2, 280, 'P1: WASD cambiar letra / posición   |   P2: Flechas cambiar letra / posición', {
    fontFamily: 'monospace', fontSize: '11px', color: '#aaaacc', fontStyle: 'bold',
  }).setOrigin(0.5));

  const confirmPrompt = scene.add.text(W / 2, H - 45, 'PRESIONEN BOTÓN 1 O START PARA REGISTRAR EN EL SCOREBOARD', {
    fontFamily: 'monospace', fontSize: '12px', color: '#ffdd00', fontStyle: 'bold',
  }).setOrigin(0.5);
  c.add(confirmPrompt);
  scene.tweens.add({
    targets: confirmPrompt, alpha: 0.25, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });

  scene.nameEntryScreen = c;
  c.setVisible(false);
}

function showNameEntry(scene, winnerLabel) {
  scene.phase = 'name_entry';
  A.sfx('win');
  scene.neWinnerLabel = winnerLabel;

  const p1s = Math.round(scene.players.p1.score);
  const p2s = Math.round(scene.players.p2.score);
  const dist = Math.round(scene.gameState.distance);

  let winText = '¡EMPATE!';
  if (winnerLabel === 'P1') winText = '¡P1 (NEA) GANA!';
  else if (winnerLabel === 'P2') winText = scene.gameState.gameMode === '1P' ? '¡CPU (CHANGÓ) GANA!' : '¡P2 (CHANGÓ) GANA!';
  scene.neTitle.setText(winText);
  scene.neSub.setText(`P1: ${padScore(p1s)} PTS   |   P2: ${padScore(p2s)} PTS   |   ${dist} METROS`);

  // Iniciales por defecto
  scene.nameEntry = {
    p1Chars: ['N', 'E', 'A', '1'],
    p1Idx: 0,
    p2Chars: scene.gameState.gameMode === '1P' ? ['C', 'P', 'U', '1'] : ['C', 'H', 'G', 'O'],
    p2Idx: 0,
    p1Ready: false,
    p2Ready: scene.gameState.gameMode === '1P',
  };

  if (scene.p2LabelText) {
    scene.p2LabelText.setText(scene.gameState.gameMode === '1P' ? 'JUGADOR 2 (CPU)' : 'JUGADOR 2 (CHANGÓ)');
  }

  renderNameEntry(scene);
  scene.nameEntryScreen.setVisible(true);
}

function renderNameEntry(scene) {
  const ne = scene.nameEntry;
  if (!ne) return;

  // Render P1 letters
  for (let i = 0; i < 4; i++) {
    scene.p1LetterTexts[i].setText(ne.p1Chars[i]);
    scene.p1LetterTexts[i].setColor(i === ne.p1Idx ? '#ffff00' : '#ff4466');
  }

  // Render P2 letters
  for (let i = 0; i < 4; i++) {
    scene.p2LetterTexts[i].setText(ne.p2Chars[i]);
    scene.p2LetterTexts[i].setColor(i === ne.p2Idx ? '#ffff00' : '#00ccff');
  }

  // Dibujar cursores indicadores alrededor de la letra activa
  const gfx = scene.neCursorGfx;
  gfx.clear();

  // Cursor P1
  const p1X = W / 2 - 230 + ne.p1Idx * 40;
  gfx.lineStyle(2, 0xff4466, 1);
  gfx.strokeRect(p1X - 16, 192, 32, 36);
  // Flechitas arriba y abajo
  gfx.fillStyle(0xffffff, 0.8);
  gfx.fillTriangle(p1X, 185, p1X - 6, 190, p1X + 6, 190);
  gfx.fillTriangle(p1X, 235, p1X - 6, 230, p1X + 6, 230);

  // Cursor P2 (si no es CPU)
  if (scene.gameState.gameMode !== '1P') {
    const p2X = W / 2 + 110 + ne.p2Idx * 40;
    gfx.lineStyle(2, 0x00ccff, 1);
    gfx.strokeRect(p2X - 16, 192, 32, 36);
    gfx.fillTriangle(p2X, 185, p2X - 6, 190, p2X + 6, 190);
    gfx.fillTriangle(p2X, 235, p2X - 6, 230, p2X + 6, 230);
  }
}

function updateNameEntryScreen(scene, time) {
  const ne = scene.nameEntry;
  if (!ne) return;

  // --- Controles Jugador 1 (P1) ---
  if (consumePressed('P1_U')) {
    let curIdx = CHAR_SET.indexOf(ne.p1Chars[ne.p1Idx]);
    curIdx = (curIdx + 1) % CHAR_SET.length;
    ne.p1Chars[ne.p1Idx] = CHAR_SET[curIdx];
    renderNameEntry(scene);
  }
  if (consumePressed('P1_D')) {
    let curIdx = CHAR_SET.indexOf(ne.p1Chars[ne.p1Idx]);
    curIdx = (curIdx - 1 + CHAR_SET.length) % CHAR_SET.length;
    ne.p1Chars[ne.p1Idx] = CHAR_SET[curIdx];
    renderNameEntry(scene);
  }
  if (consumePressed('P1_L')) {
    ne.p1Idx = (ne.p1Idx - 1 + 4) % 4;
    renderNameEntry(scene);
  }
  if (consumePressed('P1_R')) {
    ne.p1Idx = (ne.p1Idx + 1) % 4;
    renderNameEntry(scene);
  }
  if (consumePressed('P1_1')) {
    ne.p1Idx = (ne.p1Idx + 1) % 4;
    renderNameEntry(scene);
  }

  // --- Controles Jugador 2 (P2) en modo 2P ---
  if (scene.gameState.gameMode !== '1P') {
    if (consumePressed('P2_U')) {
      let curIdx = CHAR_SET.indexOf(ne.p2Chars[ne.p2Idx]);
      curIdx = (curIdx + 1) % CHAR_SET.length;
      ne.p2Chars[ne.p2Idx] = CHAR_SET[curIdx];
      renderNameEntry(scene);
    }
    if (consumePressed('P2_D')) {
      let curIdx = CHAR_SET.indexOf(ne.p2Chars[ne.p2Idx]);
      curIdx = (curIdx - 1 + CHAR_SET.length) % CHAR_SET.length;
      ne.p2Chars[ne.p2Idx] = CHAR_SET[curIdx];
      renderNameEntry(scene);
    }
    if (consumePressed('P2_L')) {
      ne.p2Idx = (ne.p2Idx - 1 + 4) % 4;
      renderNameEntry(scene);
    }
    if (consumePressed('P2_R')) {
      ne.p2Idx = (ne.p2Idx + 1) % 4;
      renderNameEntry(scene);
    }
    if (consumePressed('P2_1')) {
      ne.p2Idx = (ne.p2Idx + 1) % 4;
      renderNameEntry(scene);
    }
  }

  // Finalizar / Confirmar registro
  if (consumePressed('START1') || consumePressed('START2')) {
    const p1Str = ne.p1Chars.join('');
    const p2Str = ne.p2Chars.join('');
    const matchup = `${p1Str} VS ${p2Str}`;

    scene.nameEntryScreen.setVisible(false);
    showGameOver(scene, scene.neWinnerLabel, matchup);
  }
}

// ---------------------------------------------------------------------------
// Game over screen — Retro Scoreboard / Hall of Fame
// ---------------------------------------------------------------------------
function createGameOverScreen(scene) {
  const c = scene.add.container(0, 0).setDepth(20);
  c.add(scene.add.rectangle(W / 2, H / 2, W, H, 0x050512, 0.95));

  const bgGfx = scene.add.graphics();
  bgGfx.lineStyle(2, 0xffdd00, 0.8);
  bgGfx.strokeRect(36, 20, W - 72, H - 40);
  bgGfx.lineStyle(1, 0x00ccff, 0.5);
  bgGfx.strokeRect(40, 24, W - 80, H - 48);
  c.add(bgGfx);

  scene.goTitle = scene.add.text(W / 2, 48, '', {
    fontFamily: 'monospace', fontSize: '26px', color: '#ffdd00', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4,
  }).setOrigin(0.5);
  c.add(scene.goTitle);

  scene.goScores = scene.add.text(W / 2, 80, '', {
    fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
  }).setOrigin(0.5);
  c.add(scene.goScores);

  scene.goBanner = scene.add.text(W / 2, 108, '', {
    fontFamily: 'monospace', fontSize: '13px', color: '#ff44aa', fontStyle: 'bold',
  }).setOrigin(0.5);
  c.add(scene.goBanner);

  // Título de la tabla de récords
  c.add(scene.add.text(W / 2, 142, '★ TABLA DE RÉCORDS (TOP 5) ★', {
    fontFamily: 'monospace', fontSize: '15px', color: '#00ffcc', fontStyle: 'bold',
  }).setOrigin(0.5));

  c.add(scene.add.text(W / 2, 172, 'POS   DUELO (P1 VS P2)        PUNTAJE    DISTANCIA', {
    fontFamily: 'monospace', fontSize: '12px', color: '#8888aa', fontStyle: 'bold',
  }).setOrigin(0.5));

  // Filas para el TOP 5
  scene.goScoreRows = [];
  const rankColors = ['#ffd700', '#e0e0e0', '#cd7f32', '#00ffff', '#ffff66'];
  for (let i = 0; i < 5; i++) {
    const row = scene.add.text(W / 2, 204 + i * 32, '', {
      fontFamily: 'monospace', fontSize: '14px', color: rankColors[i], fontStyle: 'bold',
    }).setOrigin(0.5);
    scene.goScoreRows.push(row);
    c.add(row);
  }

  const restartPrompt = scene.add.text(W / 2, H - 42, 'PRESIONA START PARA VOLVER AL MENÚ', {
    fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
  }).setOrigin(0.5);
  c.add(restartPrompt);
  scene.tweens.add({
    targets: restartPrompt, alpha: 0.2, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });

  scene.gameOverScreen = c;
  c.setVisible(false);
}

async function showGameOver(scene, winnerLabel, matchup) {
  scene.phase = 'gameover';
  const p1s = Math.round(scene.players.p1.score);
  const p2s = Math.round(scene.players.p2.score);
  const dist = Math.round(scene.gameState.distance);

  let winText = '¡EMPATE!';
  if (winnerLabel === 'P1') winText = '¡P1 (NEA) GANA!';
  else if (winnerLabel === 'P2') winText = scene.gameState.gameMode === '1P' ? '¡CPU (CHANGÓ) GANA!' : '¡P2 (CHANGÓ) GANA!';
  scene.goTitle.setText(winText);

  scene.goScores.setText(`P1: ${padScore(p1s)} PTS  |  P2: ${padScore(p2s)} PTS  |  ${dist} METROS`);

  // Actualizar tabla persistente de récords con el formato P1 VS P2
  const finalMatchup = matchup || 'NEAA VS CHGO';
  const res = await recordHighScore(scene, finalMatchup, p1s, p2s, dist);

  if (res.isNewHigh) {
    scene.goBanner.setText(`🎉 ¡NUEVO RÉCORD REGISTRADO: ${finalMatchup}! 🎉`);
    scene.goBanner.setColor('#ff3399');
  } else {
    scene.goBanner.setText(`DUELO REGISTRADO: ${finalMatchup}`);
    scene.goBanner.setColor('#8888bb');
  }

  const rankLabels = ['1ST', '2ND', '3RD', '4TH', '5TH'];
  for (let i = 0; i < 5; i++) {
    const item = res.leaderboard[i];
    if (item && scene.goScoreRows[i]) {
      const rank = rankLabels[i];
      const match = (item.matchup || item.name || '---- VS ----').padEnd(19, ' ');
      const sc = padScore(item.score);
      const d = `${item.dist || 0}m`.padStart(8, ' ');
      scene.goScoreRows[i].setText(`${rank}   ${match}  ${sc}   ${d}`);
    }
  }

  scene.gameOverScreen.setVisible(true);
}

function updateGameOverScreen(scene, time) {
  if (consumePressed('START1') || consumePressed('START2') || consumePressed('P1_1') || consumePressed('P2_1')) {
    scene.gameOverScreen.setVisible(false);
    resetGame(scene);
    showStartScreen(scene);
  }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame(scene) {
  scene.phase = 'playing';
  scene.gameState.speed = 200;
  scene.gameState.distance = 0;
  scene.gameState.elapsed = 0;
  scene.gameState.spawnTimer = 1.2;
  scene.obstacles = [];
  if (scene.obstacleGraphics) scene.obstacleGraphics.clear();

  for (const player of [scene.players.p1, scene.players.p2]) {
    player.alive = true;
    player.eliminatedBy = null;
    player.score = 0;
    player.jumping = false;
    player.jumpLanding = false;
    player.jumpTimer = 0;
    player.landTimer = 0;
    player.landStartZ = 0;
    player.jumpZ = 0;
    player.prog = 0;
    player.paralyzed = 0;
    player.knockbackVel = 0;
    player.pushCooldown = 0;
    player._wF = 0.0008;
    player._pushT = null;
  }
  scene.players.p1.x = W / 2 - 80;
  scene.players.p2.x = W / 2 + 80;

  // if (!scene.gameState.musicStarted) {
  //   startMusic(scene);
  //   scene.gameState.musicStarted = true;
  // }
}

function resetGame(scene) {
  scene.obstacles = [];
  scene.gameState.speed = 0;
  scene.gameState.distance = 0;
  scene.gameState.spawnTimer = 1.2;
  resetParticles(scene);
}

function pauseGame(scene) {
  scene.phase = 'paused';
  // TODO: show pause overlay
}

function resumeGame(scene) {
  scene.phase = 'playing';
}

// ---------------------------------------------------------------------------
// Scroll
// ---------------------------------------------------------------------------
function updateScroll(scene, delta) {
  const dt = delta / 1000;
  scene.gameState.elapsed += dt;

  // Dificultad incremental por tiempo
  const phase = getDiffPhase(scene.gameState.elapsed);
  const ds = DIFF_SETTINGS[phase];

  // Acelera según la fase actual
  scene.gameState.speed = Math.min(scene.gameState.speed + ds.accel * dt, ds.speedMax);
  
  // Aumenta la distancia global
  scene.gameState.distance += scene.gameState.speed * dt;

  // Puntuación acumulada por distancia y velocidad
  const speedMult = 1 + (scene.gameState.speed / 500);
  const distPts = scene.gameState.speed * dt * 0.4 * speedMult;
  if (scene.players.p1.alive) scene.players.p1.score += distPts;
  if (scene.players.p2.alive) scene.players.p2.score += distPts;
  
  // Dibuja la pista renderizando el desplazamiento de izquierda-arriba
  renderTrack(scene, scene.gameState.distance); 
}
// ---------------------------------------------------------------------------
// Player movement, jump, drift, push
// ---------------------------------------------------------------------------
function updatePlayers(scene, delta, time) {
  const dt = delta / 1000;
  const { p1, p2 } = scene.players;

  handlePlayerInput(scene, p1, 'P1', dt);
  if (scene.gameState.gameMode === '1P') {
    updateCpuPlayer(scene, p2, dt, time);
  } else {
    handlePlayerInput(scene, p2, 'P2', dt);
  }
  resolvePlayerCollision(scene, p1, p2);

  // Emisión de partículas de fricción y chispas al deslizarse sobre el asfalto
  emitSlideParticles(scene, p1, scene.gameState.speed, dt);
  emitSlideParticles(scene, p2, scene.gameState.speed, dt);

  // Pierde el jugador que caiga demasiado atrás (prog-based = justo para ambos)
  for (const player of [p1, p2]) {
    if (player.alive && player.prog < PROG_ELIMINATE) {
      player.alive = false;
      player.eliminatedBy = 'trail';
    }
  }

  renderPlayers(scene, time, scene.gameState.speed);
}

function updateCpuPlayer(scene, cpu, dt, time) {
  if (!cpu.alive) return;

  if (cpu.pushCooldown > 0) {
    cpu.pushCooldown = Math.max(0, cpu.pushCooldown - dt);
  }

  if (cpu.paralyzed > 0) {
    cpu.paralyzed = Math.max(0, cpu.paralyzed - dt);
    if (cpu.knockbackVel > 0) {
      cpu.prog -= cpu.knockbackVel * dt;
      if (cpu.paralyzed <= 0) cpu.knockbackVel = 0;
    }
    return;
  }

  const latSpeed = 200;

  // Busca el obstáculo más cercano por delante
  let closestOb = null;
  let minDist = 9999;
  for (const ob of scene.obstacles) {
    const distToCpu = ob.x - cpu.x;
    if (distToCpu > -25 && distToCpu < minDist) {
      minDist = distToCpu;
      closestOb = ob;
    }
  }

  let targetLat = cpu.lat;
  let wantsJump = false;

  if (closestOb && minDist < 220) {
    if (closestOb.type === 'rail') {
      targetLat = closestOb.lat; // Guiar hacia el puente
    } else {
      const inHazard = Math.abs(cpu.lat - closestOb.lat) < 32;
      if (inHazard) {
        if (minDist < 90) wantsJump = true;
        else targetLat = closestOb.lat > 0 ? (closestOb.lat - 38) : (closestOb.lat + 38);
      }
    }
  } else {
    // Si no hay peligro inminente, fluctuación natural
    targetLat = -35 + Math.sin(time * 0.002) * 20;
  }

  const diffLat = targetLat - cpu.lat;
  if (Math.abs(diffLat) > 3) {
    const dLat = diffLat > 0 ? 1 : -1;
    cpu.lat = Phaser.Math.Clamp(cpu.lat + dLat * latSpeed * dt, -85, 85);
  }

  // Convertir lat + prog a pantalla
  const baseX = W / 2;
  const baseY = baseX * 0.5 + 225;
  cpu.x = baseX + cpu.lat * (-2) + cpu.prog * 1;
  cpu.y = baseY + cpu.lat * 1 + cpu.prog * 0.5;

  // Oportunidad de empujar a P1 si está cerca y cooldown disponible
  const p1 = scene.players.p1;
  if (p1 && p1.alive && (!cpu.pushCooldown || cpu.pushCooldown <= 0)) {
    const dLat = cpu.lat - p1.lat;
    const dProg = cpu.prog - p1.prog;
    if (Math.abs(dLat) < 50 && Math.abs(dProg) < 50 && Math.random() < (0.6 * dt)) {
      cpu.pushCooldown = 1.6;
      const pushDir = dLat >= 0 ? -1 : 1;
      p1.lat = Phaser.Math.Clamp(p1.lat + pushDir * 38, LAT_MIN, LAT_MAX);
      p1.paralyzed = 0.35;
      cpu.score += 200;
      cpu._pushT = scene.time.now;
      cpu._pushDir = p1.x >= cpu.x ? 1 : -1;
      showScorePopup(scene, cpu.x, cpu.y - 35, '¡EMPUJÓN CPU!', '#ff44aa');
    }
  }

  // Salto de la CPU
  if (wantsJump && !cpu.jumping) {
    cpu.jumping = true;
    cpu.jumpLanding = false;
    cpu.jumpTimer = 0;
    cpu.landTimer = 0;
    cpu.landStartZ = 1.0;
  }

  if (cpu.jumping) {
    if (!cpu.jumpLanding) {
      cpu.jumpTimer += dt;
      if (cpu.jumpTimer < 0.10) {
        cpu.jumpZ = Math.sin((cpu.jumpTimer / 0.10) * (Math.PI / 2));
      } else {
        cpu.jumpZ = 1.0;
      }
      if (cpu.jumpTimer >= 0.6) {
        cpu.jumpLanding = true;
        cpu.landTimer = 0;
        cpu.landStartZ = cpu.jumpZ;
      }
    } else {
      cpu.landTimer += dt;
      if (cpu.landTimer >= 0.14) {
        cpu.jumping = false;
        cpu.jumpLanding = false;
        cpu.jumpZ = 0;
      } else {
        cpu.jumpZ = cpu.landStartZ * Math.cos((cpu.landTimer / 0.14) * (Math.PI / 2));
      }
    }
  }
}

// Rango de movimiento voluntario adelante/atrás (el empujón de un obstáculo
// SÍ puede mandarte más atrás de este límite; sólo avanzando lo recuperás).
const PROG_MOVE_MIN = -60;
const PROG_MOVE_MAX = 60;
const PROG_KNOCKBACK = 50;     // cuánto te manda hacia atrás un obstáculo fallado
const PROG_ELIMINATE = -300;   // 6 golpes sin recuperar = eliminado (justo para ambas posiciones laterales)
const PARALYZE_DURATION = 0.7; // segundos paralizado tras un golpe (el knockback se aplica gradualmente)

function handlePlayerInput(scene, player, prefix, dt) {
  if (!player.alive) return;

  if (player.paralyzed > 0) {
    player.paralyzed = Math.max(0, player.paralyzed - dt);
    // Retroceso suave durante la parálisis
    if (player.knockbackVel > 0) {
      player.prog -= player.knockbackVel * dt;
      if (player.paralyzed <= 0) player.knockbackVel = 0;
    }
  }

  const latSpeed = 220;  // Velocidad de esquive lateral
  const progSpeed = 170; // Velocidad de avance/retroceso

  // Mientras está paralizado (recién golpeado) no responde a los controles
  if (player.paralyzed <= 0) {
    let dLat = 0;
    // Izquierda (A / Flecha Izq) te mueve hacia la izquierda de la pantalla
    if (held[prefix + '_L']) dLat += 1;
    // Derecha (D / Flecha Der) te mueve hacia la derecha de la pantalla
    if (held[prefix + '_R']) dLat -= 1;
    if (dLat !== 0) {
      player.lat = Phaser.Math.Clamp(player.lat + dLat * latSpeed * dt, -85, 85);
    }

    let dProg = 0;
    if (held[prefix + '_U']) dProg += 1; // adelante: te adelantás en la bajada
    if (held[prefix + '_D']) dProg -= 1; // atrás: te rezagás a propósito
    if (dProg !== 0) {
      // Movimiento voluntario sin teletransporte: si el knockback te mandó
      // más allá del rango, podés volver gradualmente, pero no ir más lejos.
      let newProg = player.prog + dProg * progSpeed * dt;
      if (dProg > 0) {
        newProg = Math.min(newProg, PROG_MOVE_MAX);   // no pasar del máximo
        newProg = Math.max(newProg, player.prog);      // nunca retroceder al avanzar
      } else {
        newProg = Math.max(newProg, PROG_MOVE_MIN);   // no pasar del mínimo
        newProg = Math.min(newProg, player.prog);      // nunca avanzar al retroceder
      }
      player.prog = newProg;
    }
  }

  // Convertir 'lat' + 'prog' en coordenadas de pantalla diagonales
  const baseX = W / 2; // 400
  const baseY = baseX * 0.5 + 225; // 425 (centro de la pista)

  // Eje lateral (perpendicular a la pista)
  player.x = baseX + player.lat * (-2);
  player.y = baseY + player.lat * (1);
  // Eje de avance/retroceso (paralelo a la pendiente de la pista, misma m = 0.5)
  player.x += player.prog * 1;
  player.y += player.prog * 0.5;

  if (player.paralyzed > 0) return; // no puede saltar mientras está aturdido

  // --- Salto instantáneo: despega de inmediato y se mantiene hasta 2s si se deja presionado ---
  const MAX_JUMP_TIME = 2.0;    // Máximo tiempo total en el aire
  const MIN_JUMP_HOLD = 0.18;   // Tiempo mínimo en el aire para un toque rápido
  const LAND_DURATION = 0.14;   // Duración de caída/aterrizaje suave

  if (consumePressed(prefix + '_1') && !player.jumping) {
    A.sfx('jump');
    player.jumping = true;
    player.jumpLanding = false;
    player.jumpTimer = 0;
    player.landTimer = 0;
    player.landStartZ = 1.0;
  }

  if (player.jumping) {
    if (!player.jumpLanding) {
      player.jumpTimer += dt;
      const isHeld = held[prefix + '_1'];

      // Sube instantáneamente al tope en los primeros 0.10s
      if (player.jumpTimer < 0.10) {
        player.jumpZ = Math.sin((player.jumpTimer / 0.10) * (Math.PI / 2));
      } else {
        player.jumpZ = 1.0;
      }

      // Si soltó el botón (tras el mínimo) o se alcanzó el tiempo máximo de 2.0s
      if ((!isHeld && player.jumpTimer >= MIN_JUMP_HOLD) || player.jumpTimer >= (MAX_JUMP_TIME - LAND_DURATION)) {
        player.jumpLanding = true;
        player.landTimer = 0;
        player.landStartZ = player.jumpZ;
      }
    } else {
      player.landTimer += dt;
      if (player.landTimer >= LAND_DURATION) {
        player.jumping = false;
        player.jumpLanding = false;
        player.jumpZ = 0;
      } else {
        const t = player.landTimer / LAND_DURATION;
        player.jumpZ = player.landStartZ * Math.cos(t * (Math.PI / 2));
      }
    }
  }

  // Disminuir cooldown de empuje con el tiempo
  if (player.pushCooldown > 0) {
    player.pushCooldown = Math.max(0, player.pushCooldown - dt);
  }

  // --- Empuje (Push) con botón de acción 2 ('I' para P1, 'T' para P2) con cooldown respetable ---
  const PUSH_COOLDOWN = 1.0; // Cooldown de 1.0s para evitar spam manteniendo la fluidez
  if (consumePressed(prefix + '_2') && player.paralyzed <= 0 && (!player.pushCooldown || player.pushCooldown <= 0)) {
    player.pushCooldown = PUSH_COOLDOWN;
    const opp = (prefix === 'P1') ? scene.players.p2 : scene.players.p1;
    if (opp && opp.alive) {
      const dLat = player.lat - opp.lat;
      const dProg = player.prog - opp.prog;
      if (Math.abs(dLat) < 55 && Math.abs(dProg) < 55) {
        const pushDir = dLat >= 0 ? -1 : 1;
        opp.lat = Phaser.Math.Clamp(opp.lat + pushDir * 38, LAT_MIN, LAT_MAX);
        opp.paralyzed = 0.35;
        player.score += 200;
        player._pushT = scene.time.now;
        player._pushDir = opp.x >= player.x ? 1 : -1;
        A.sfx('hit');
        showScorePopup(scene, player.x, player.y - 35, '+200 EMPUJÓN!', '#ff44aa');
      } else {
        // Intento al aire: dispara la animación de empuje de brazos
        player._pushT = scene.time.now;
        player._pushDir = player.lat >= 0 ? -1 : 1;
      }
    } else {
      player._pushT = scene.time.now;
      player._pushDir = player.lat >= 0 ? -1 : 1;
    }
  }
}

function isClearingJump(player, obstacleType) {
  return player.jumping && player.jumpZ > 0.25;
}

function resolvePlayerCollision(scene, p1, p2) {
  if (!p1.alive || !p2.alive) return;
  const minLat = 35;  // tamaño lateral de la canasta
  const minProg = 40; // tamaño adelante/atrás

  const dLat  = p1.lat  - p2.lat;
  const dProg = p1.prog - p2.prog;
  const oLat  = minLat  - Math.abs(dLat);
  const oProg = minProg - Math.abs(dProg);

  if (oLat > 0 && oProg > 0) {
    // Separar por el eje con menor penetración
    if (oLat < oProg) {
      const push = oLat / 2;
      if (dLat > 0) { p1.lat += push; p2.lat -= push; }
      else          { p1.lat -= push; p2.lat += push; }
    } else {
      const push = oProg / 2;
      if (dProg > 0) { p1.prog += push; p2.prog -= push; }
      else           { p1.prog -= push; p2.prog += push; }
    }
    p1.lat = Phaser.Math.Clamp(p1.lat, LAT_MIN, LAT_MAX);
    p2.lat = Phaser.Math.Clamp(p2.lat, LAT_MIN, LAT_MAX);
  }
}

// ---------------------------------------------------------------------------
// Elimination check
// ---------------------------------------------------------------------------
function checkPlayerElimination(scene) {
  const { p1, p2 } = scene.players;
  const bothDead = !p1.alive && !p2.alive;
  const p1Dead = !p1.alive && p2.alive;
  const p2Dead = p1.alive && !p2.alive;

  if (bothDead) { showNameEntry(scene, 'NOBODY'); return; }
  if (p1Dead)  { showNameEntry(scene, 'P2'); return; }
  if (p2Dead)  { showNameEntry(scene, 'P1'); return; }
}

// ---------------------------------------------------------------------------
// Nea — P1 character (procedural 8-bit pixel art)
//
// Vista de PERFIL IZQUIERDO — cara mirando hacia la DERECHA.
// Espejo exacto del perfil derecho: nariz, gorra, tenis y brazo apuntan
// a la derecha; coleta cae a la izquierda (atrás); riñonera visible
// en el lado izquierdo (hacia el espectador).
//
// cx, cy = same anchor as drawBeerCrate (center of front face)
// ---------------------------------------------------------------------------
function drawNea(gfx, cx, cy, scale, time, speed, jumpZ, waveF, pushDir) {
  const s = scale || 3;
  const r = (v) => Math.round(v * s);
  const baseY = cy - r(3.5);
  const bx = cx;

  // ── Animación idle + salto
  const t = time || 0;
  const spd = speed || 0;
  const wF = waveF || 0.0008;
  const hairWave = Math.round(Math.sin(t * wF) * 5);
  const hairBob  = Math.round(Math.sin(t * wF + 0.8) * 2);
  const blink = (t % 3000) < 100;

  // Lean angular: 1° por cada 10 km/h, máx 75° desde vertical (15° de la horizontal)
  const ang = Math.min(spd / 10, 75) * Math.PI / 180;
  const sinL = Math.sin(ang), cosL1 = 1 - Math.cos(ang);
  const lax = Math.round(r(2.0) * sinL), lay = Math.round(r(2.0) * cosL1);
  const lnx = Math.round(r(5.0) * sinL), lny = Math.round(r(5.0) * cosL1);
  const lhx = Math.round(r(7.9) * sinL), lhy = Math.round(r(7.9) * cosL1);

  // ── TENIS VERDE
  gfx.fillStyle(0x33dd44, 1);
  gfx.fillRect(bx + r(1.3), baseY + r(1.5), r(4.2), r(1.6));
  gfx.fillStyle(0x1a8830, 1);
  gfx.fillRect(bx + r(1.1), baseY + r(2.9), r(4.6), r(0.6));
  gfx.fillStyle(0xaaeeaa, 1);
  gfx.fillRect(bx + r(3.3), baseY + r(1.5), r(1.2), r(0.6));

  // ── PIERNA
  gfx.fillStyle(0x111122, 1);
  gfx.fillRect(bx + r(2.5), baseY + r(0.2), r(2.5), r(1.5));
  gfx.fillRect(bx,          baseY - r(0.5), r(4),   r(1.2));

  // ── SHORTS
  gfx.fillStyle(0x1a1a2e, 1);
  gfx.fillRect(bx - r(2.5), baseY - r(1.8), r(4), r(1.8));

  // ── RIÑONERA AZUL
  gfx.fillStyle(0x2288ff, 1);
  gfx.fillRect(bx - r(3.8) + lax, baseY - r(3.2) + lay, r(2.8), r(1.5));
  gfx.fillStyle(0x88aaff, 1);
  gfx.fillRect(bx - r(2.7) + lax, baseY - r(3.1) + lay, r(1),   r(1.3));

  // ── BRAZO IZQUIERDO
  gfx.fillStyle(0xb56030, 1);
  gfx.fillRect(bx          + lax, baseY - r(6.5) + lay, r(1.5), r(1.5));
  gfx.fillRect(bx + r(1.4) + lax, baseY - r(6.3) + lay, r(2.8), r(1.3));
  if (pushDir > 0) {
    // Empuje derecha: antebrazo horizontal extendido
    gfx.fillRect(bx + r(4.2) + lax, baseY - r(6.5) + lay, r(7), r(1.3));
    gfx.fillStyle(0xc47840, 1);
    gfx.fillRect(bx + r(10.8) + lax, baseY - r(6.6) + lay, r(2), r(1.6));
  } else if (pushDir < 0) {
    // Empuje izquierda: brazo sale del torso hacia la izquierda
    gfx.fillRect(bx - r(2.7) + lax, baseY - r(5.5) + lay, r(8.5), r(1.3));
    gfx.fillStyle(0xc47840, 1);
    gfx.fillRect(bx - r(10.7) + lax, baseY - r(5.6) + lay, r(2), r(1.6));
  } else {
    gfx.fillRect(bx + r(3.7) + lax, baseY - r(6.3) + lay, r(1.3), r(3.8));
    gfx.fillStyle(0xc47840, 1);
    gfx.fillRect(bx + r(3.4) + lax, baseY - r(2.5) + lay, r(1.8), r(1));
  }

  // ── TORSO FUCSIA
  gfx.fillStyle(0xdd1180, 1);
  gfx.fillRect(bx - r(2.7) + lax, baseY - r(6.8) + lay, r(4.2), r(5.5));
  gfx.fillStyle(0xbb0f70, 1);
  gfx.fillRect(bx + r(0.7) + lax, baseY - r(6.8) + lay, r(0.8), r(5.5));
  gfx.fillStyle(0x44bbff, 1);
  gfx.fillCircle(bx - r(1) + lax, baseY - r(4.8) + lay, r(0.9));
  gfx.fillStyle(0xffee44, 1);
  gfx.fillCircle(bx - r(1) + lax, baseY - r(4.8) + lay, r(0.45));

  // ── CUELLO
  gfx.fillStyle(0xc47840, 1);
  gfx.fillRect(bx - r(2.1) + lnx, baseY - r(8.2) + lny, r(1.6), r(1.8));

  // ── CABEZA
  const headX = bx - r(1.3) + lhx;
  const headY = baseY - r(10.4) + lhy;

  gfx.fillStyle(0xc47840, 1);
  gfx.fillCircle(headX, headY, r(2.2));

  // NARIZ →derecha
  gfx.fillStyle(0x9e5520, 1);
  gfx.fillTriangle(
    headX + r(1.9), headY + r(0.1),
    headX + r(3.4), headY + r(0.7),
    headX + r(1.9), headY + r(1.3),
  );

  // OJO — parpadeo
  gfx.fillStyle(0x1a0800, 1);
  if (blink) {
    gfx.fillRect(headX + r(0.3), headY - r(0.05), r(1.2), r(0.12));  // ojo cerrado
  } else {
    gfx.fillRect(headX + r(0.3), headY - r(0.2),  r(1.2), r(0.35));  // ojo abierto
  }

  // ── PELO NEGRO — coleta ondea como cabello en el viento
  gfx.fillStyle(0x0d0d0d, 1);
  // Coleta: cuadrilátero — raíz fija a la cabeza, punta oscila ±12px en X y ±4px en Y
  const hRX = headX - r(2.6);  // root right-x
  const hRY = headY - r(1.8);  // root y
  const hW  = r(1.8);          // width
  const hH  = r(7.5);          // length
  gfx.fillPoints([
    { x: hRX,               y: hRY },
    { x: hRX - hW,          y: hRY },
    { x: hRX - hW + hairWave, y: hRY + hH + hairBob },
    { x: hRX + hairWave,      y: hRY + hH + hairBob },
  ], true);
  gfx.fillRect(headX - r(2.3), headY - r(2.3), r(4.5), r(1.1));   // cobertura superior
  // Spike trasero sigue la onda (efecto ±5px)
  gfx.fillRect(headX - r(2.5) + Math.round(hairWave * 0.4), headY - r(3.5), r(1), r(2));
  gfx.fillRect(headX - r(0.5), headY - r(3.8), r(0.8), r(1.8));   // spike superior

  // ── GORRA SNAPBACK
  const capBot = headY - r(2.2);
  gfx.fillStyle(0xf8f8f8, 1);
  gfx.fillRect(headX - r(3.2), capBot - r(2.8), r(5.5), r(2.8));
  gfx.fillStyle(0xe8e8f8, 1);
  gfx.fillCircle(headX - r(1.5), capBot - r(2.8), r(2.3));
  gfx.fillStyle(0xf8f8f8, 1);
  gfx.fillRect(headX - r(3.2), capBot - r(2.8), r(5.5), r(2));
  gfx.fillStyle(0xccccdd, 1);
  gfx.fillRect(headX - r(1.1), capBot - r(5.2), r(0.9), r(0.9));

  // ALA VERDE
  gfx.fillStyle(0x44cc22, 1);
  gfx.fillPoints([
    { x: headX + r(2.3), y: capBot          },
    { x: headX + r(2.3), y: capBot - r(1)   },
    { x: headX + r(6.8), y: capBot - r(2.4) },
    { x: headX + r(6.8), y: capBot - r(1.3) },
  ], true);
  gfx.fillStyle(0x228811, 1);
  gfx.fillPoints([
    { x: headX + r(2.3), y: capBot          },
    { x: headX + r(6.8), y: capBot - r(1.3) },
    { x: headX + r(6.5), y: capBot - r(0.5) },
    { x: headX + r(2.3), y: capBot + r(0.3) },
  ], true);

  // Logo gorra
  const logoX = headX - r(1.2);
  const logoY = capBot - r(1.8);
  gfx.fillStyle(0xff44aa, 1);
  gfx.fillTriangle(logoX, logoY - r(1.1), logoX - r(0.6), logoY, logoX + r(0.6), logoY);
  gfx.fillTriangle(logoX - r(0.9), logoY - r(0.6), logoX, logoY - r(1.1), logoX - r(0.2), logoY);
  gfx.fillTriangle(logoX + r(0.9), logoY - r(0.6), logoX, logoY - r(1.1), logoX + r(0.2), logoY);

  // ── ARETE DE CRUZ DORADO
  const earX = headX - r(2.1);
  const earY = headY + r(0.5);
  gfx.fillStyle(0xffcc00, 1);
  gfx.fillRect(earX - r(0.5), earY,            r(1.1), r(0.3));
  gfx.fillRect(earX - r(0.15), earY - r(0.45), r(0.35), r(1.1));
}

// ---------------------------------------------------------------------------
// Changó — P2 character (diablo caleño, perfil izquierdo mirando derecha)
//
// Rojo con cuernos, cola pica, cinturón negro/dorado, bota negra, colmillo.
// Cola flota hacia atrás (izquierda) por la velocidad del descenso.
//
// cx, cy = mismo anchor que drawBeerCrate (centro de la cara frontal)
// ---------------------------------------------------------------------------
function drawChango(gfx, cx, cy, scale, time, speed, jumpZ, waveF, pushDir) {
  const base = scale || 3;
  const s = base * 1.15;                          // 15% más grande que Nea
  const r = (v) => Math.round(v * s);
  const baseY = cy - Math.round(3.5 * base);      // anchor fijo al tope de la canasta
  const bx = cx;

  // ── Animación idle
  const t = time || 0;
  const spd = speed || 0;
  const wF = waveF || 0.0008;
  const tailWave = Math.round(Math.sin(t * wF) * 6);
  const tailBob  = Math.round(Math.sin(t * wF + 1.0) * 2);
  const blink = (t % 2800) < 110;

  // Lean angular: 1° por cada 10 km/h, máx 75° desde vertical (15° de la horizontal)
  const ang = Math.min(spd / 10, 75) * Math.PI / 180;
  const sinL = Math.sin(ang), cosL1 = 1 - Math.cos(ang);
  const lax = Math.round(r(2.5) * sinL), lay = Math.round(r(2.5) * cosL1);
  const lnx = Math.round(r(4.5) * sinL), lny = Math.round(r(4.5) * cosL1);
  const lhx = Math.round(r(7.4) * sinL), lhy = Math.round(r(7.4) * cosL1);

  // ── COLA — cinta continua de raíz a punta, ondula con el viento
  const cRX = bx - r(2.7) + lax;                              // raíz: borde izq del torso
  const cRY = baseY - r(3.8);
  const cMX = bx - r(6.5) + Math.round(tailWave * 0.4);     // punto medio
  const cMY = baseY - r(6.5);
  const cPX = bx - r(5.5) + tailWave;                        // punta
  const cPY = baseY - r(10.0) + tailBob;
  const hw  = r(0.55);
  gfx.fillStyle(0xcc2222, 1);
  gfx.fillPoints([
    { x: cRX,       y: cRY - hw },
    { x: cMX - hw,  y: cMY },
    { x: cPX - hw,  y: cPY + hw },
    { x: cPX + hw,  y: cPY + hw },
    { x: cMX + hw,  y: cMY },
    { x: cRX,       y: cRY + hw },
  ], true);
  gfx.fillStyle(0x880000, 1);
  gfx.fillTriangle(cPX - r(0.8), cPY + hw, cPX + r(0.8), cPY + hw, cPX, cPY - r(2.2));

  // ── BOTA NEGRA (cuerpo inferior — sin lean)
  gfx.fillStyle(0x111111, 1);
  gfx.fillRect(bx + r(1.3), baseY + r(1.4), r(4.2), r(1.8));
  gfx.fillRect(bx + r(1.0), baseY + r(3.0), r(4.5), r(0.5));

  // ── PIERNA (sin lean)
  gfx.fillStyle(0xcc2222, 1);
  gfx.fillRect(bx + r(2.5), baseY + r(0.2), r(2.2), r(1.5));
  gfx.fillRect(bx,          baseY - r(0.5), r(4),   r(1.2));

  // ── PANTALÓN NEGRO (sin lean)
  gfx.fillStyle(0x111111, 1);
  gfx.fillRect(bx - r(2.5), baseY - r(2.5), r(4.2), r(2.5));

  // ── CINTURÓN con hebilla dorada (sin lean)
  gfx.fillStyle(0x000000, 1);
  gfx.fillRect(bx - r(2.7), baseY - r(3.2), r(4.2), r(0.9));
  gfx.fillStyle(0xddaa00, 1);
  gfx.fillRect(bx - r(0.55), baseY - r(3.15), r(1.1), r(0.75));
  gfx.fillStyle(0x000000, 1);
  gfx.fillRect(bx - r(0.2), baseY - r(3.0), r(0.4), r(0.5));

  // ── BRAZO IZQUIERDO
  gfx.fillStyle(0xcc2222, 1);
  gfx.fillRect(bx          + lax, baseY - r(6.5) + lay, r(1.5), r(1.5));
  gfx.fillRect(bx + r(1.4) + lax, baseY - r(6.3) + lay, r(2.8), r(1.3));
  if (pushDir > 0) {
    // Empuje derecha: antebrazo horizontal extendido
    gfx.fillRect(bx + r(4.2) + lax, baseY - r(6.5) + lay, r(7), r(1.3));
    gfx.fillStyle(0xbb1111, 1);
    gfx.fillRect(bx + r(10.8) + lax, baseY - r(6.6) + lay, r(2), r(1.6));
  } else if (pushDir < 0) {
    // Empuje izquierda: brazo sale del torso hacia la izquierda
    gfx.fillRect(bx - r(2.7) + lax, baseY - r(5.5) + lay, r(8.5), r(1.3));
    gfx.fillStyle(0xbb1111, 1);
    gfx.fillRect(bx - r(10.7) + lax, baseY - r(5.6) + lay, r(2), r(1.6));
  } else {
    gfx.fillRect(bx + r(3.7) + lax, baseY - r(6.3) + lay, r(1.3), r(3.5));
    gfx.fillStyle(0xbb1111, 1);
    gfx.fillRect(bx + r(3.3) + lax, baseY - r(3.0) + lay, r(2.0), r(1.5));
  }

  // ── TORSO ROJO
  gfx.fillStyle(0xcc2222, 1);
  gfx.fillRect(bx - r(2.7) + lax, baseY - r(6.8) + lay, r(4.2), r(4.5));
  gfx.fillStyle(0xaa1111, 1);
  gfx.fillRect(bx + r(0.7) + lax, baseY - r(6.8) + lay, r(0.8), r(4.5));
  gfx.fillStyle(0xdd3333, 1);
  gfx.fillRect(bx - r(2.0) + lax, baseY - r(6.5) + lay, r(2.0), r(1.5));

  // ── CUELLO
  gfx.fillStyle(0xcc2222, 1);
  gfx.fillRect(bx - r(2.1) + lnx, baseY - r(8.2) + lny, r(1.6), r(1.8));

  // ── CABEZA
  const headX = bx - r(1.3) + lhx;
  const headY = baseY - r(10.4) + lhy;

  // CUERNO TRASERO (izquierda = atrás) — detrás de la cabeza
  gfx.fillStyle(0x880000, 1);
  gfx.fillRect(headX + r(0.6), headY - r(4.0), r(1.6), r(2.2));
  gfx.fillTriangle(
    headX + r(0.6), headY - r(4.0),
    headX + r(2.2), headY - r(4.0),
    headX + r(1.4), headY - r(7.2),
  );

  // CABEZA (círculo rojo)
  gfx.fillStyle(0xcc2222, 1);
  gfx.fillCircle(headX, headY, r(2.3));

  // CUERNO DELANTERO (encima de la cabeza, más prominente)
  gfx.fillStyle(0xaa1111, 1);
  gfx.fillRect(headX - r(0.9), headY - r(3.8), r(1.8), r(2.0));
  gfx.fillStyle(0x880000, 1);
  gfx.fillTriangle(
    headX - r(0.9), headY - r(3.8),
    headX + r(0.9), headY - r(3.8),
    headX,          headY - r(7.0),
  );

  // OREJA PUNTIAGUDA (izquierda — visible en perfil izquierdo)
  gfx.fillStyle(0xbb1111, 1);
  gfx.fillTriangle(
    headX - r(2.0), headY - r(0.5),
    headX - r(4.2), headY - r(3.0),
    headX - r(2.0), headY - r(1.8),
  );

  // OJO AMARILLO — parpadeo
  if (blink) {
    gfx.fillStyle(0x880000, 1);
    gfx.fillRect(headX + r(0.2), headY - r(0.15), r(1.5), r(0.15));  // ojo cerrado
  } else {
    gfx.fillStyle(0xffcc00, 1);
    gfx.fillRect(headX + r(0.2), headY - r(0.6), r(1.5), r(1.0));
    gfx.fillStyle(0x000000, 1);
    gfx.fillRect(headX + r(0.7), headY - r(0.6), r(0.5), r(1.0));  // pupila vertical
  }

  // CEJA FRUNCIDA (angry)
  gfx.fillStyle(0x660000, 1);
  gfx.fillRect(headX - r(0.2), headY - r(1.7), r(2.0), r(0.5));
  gfx.fillRect(headX + r(1.6), headY - r(2.2), r(0.5), r(0.8));  // inner raised

  // NARIZ (apunta derecha — perfil)
  gfx.fillStyle(0xaa1111, 1);
  gfx.fillTriangle(
    headX + r(1.9), headY + r(0.2),
    headX + r(3.2), headY + r(0.8),
    headX + r(1.9), headY + r(1.4),
  );

  // COLMILLO BLANCO
  gfx.fillStyle(0xffffff, 1);
  gfx.fillRect(headX + r(1.3), headY + r(1.4), r(0.6), r(1.2));
}

// ---------------------------------------------------------------------------
// Beer crate — 8-bit isometric style (canasta de cervezas)
//
// Layout (viewed from front-left at ~30°):
//   [TOP FACE]   ← parallelogram, lighter red, bottle-slot grid
//   [FRONT FACE] ← rectangle, medium red, horizontal ribs, handle holes
//   [RIGHT FACE] ← parallelogram sliver, dark red
//
// cx, cy = center of the front face
// ---------------------------------------------------------------------------
function drawBeerCrate(gfx, cx, cy, scale) {
  const s  = scale || 4;
  const fw = 12 * s;  // front face width
  const fh =  7 * s;  // front face height
  const tx =  4 * s;  // isometric x-offset (depth going right)
  const ty =  4 * s;  // isometric y-offset (depth going up)

  // Corner anchors of the front face
  const fl = cx - fw / 2;  // left x
  const fr = cx + fw / 2;  // right x
  const ft = cy - fh / 2;  // top y
  const fb = cy + fh / 2;  // bottom y

  // Palette — dark maroon plastic, darkened so characters read clearly on top
  const C_TOP    = 0x8a1a1a;  // top face
  const C_FRONT  = 0x6e1010;  // front face
  const C_RIGHT  = 0x4a0a0a;  // right face (shadow)
  const C_DARK   = 0x1a0303;  // outlines
  const C_HOLE   = 0x0a0101;  // handle holes (near black)
  const C_SHINE  = 0xa02222;  // highlight strip at top of front
  const C_STRIPE = 0x5c0d0d;  // horizontal rib lines
  const C_DIV    = 0x3d0808;  // bottle divider lines on top face

  // --- RIGHT FACE (drawn first — sits behind front face) ---
  gfx.fillStyle(C_RIGHT, 1);
  gfx.fillPoints([
    { x: fr,      y: ft      },   // top-left  (= front face top-right)
    { x: fr + tx, y: ft - ty },   // top-right (= top face top-right)
    { x: fr + tx, y: fb - ty },   // bottom-right
    { x: fr,      y: fb      },   // bottom-left (= front face bottom-right)
  ], true);

  // --- TOP FACE ---
  gfx.fillStyle(C_TOP, 1);
  gfx.fillPoints([
    { x: fl,      y: ft      },   // bottom-left  (front face top-left)
    { x: fr,      y: ft      },   // bottom-right (front face top-right)
    { x: fr + tx, y: ft - ty },   // top-right
    { x: fl + tx, y: ft - ty },   // top-left
  ], true);

  // Bottle slot grid on top face: 2 vertical dividers + 1 horizontal
  gfx.lineStyle(s, C_DIV, 1);
  for (let i = 1; i <= 2; i++) {
    const t = i / 3;
    // Line runs from front edge → back edge of the parallelogram
    gfx.lineBetween(
      fl + t * fw,        ft,
      fl + tx + t * fw,   ft - ty,
    );
  }
  // Horizontal divider at mid-depth
  gfx.lineBetween(
    fl + tx * 0.5,   ft - ty * 0.5,
    fr + tx * 0.5,   ft - ty * 0.5,
  );

  // --- FRONT FACE ---
  gfx.fillStyle(C_FRONT, 1);
  gfx.fillRect(fl, ft, fw, fh);

  // Horizontal ribs (plastic texture)
  const nRibs = 5;
  for (let i = 1; i <= nRibs; i++) {
    const ry = ft + Math.round(i * fh / (nRibs + 1));
    gfx.fillStyle(C_STRIPE, 1);
    gfx.fillRect(fl + s, ry, fw - 2 * s, s);
  }

  // Handle holes — two rectangular cutouts near top of front face
  const hw = Math.round(fw * 0.24);
  const hh = Math.round(fh * 0.30);
  const hy = ft + Math.round(fh * 0.26);
  gfx.fillStyle(C_HOLE, 1);
  gfx.fillRect(fl + s * 2,       hy, hw, hh);  // left hole
  gfx.fillRect(fr - s * 2 - hw,  hy, hw, hh);  // right hole

  // Thin highlight strip at very top of front face
  gfx.fillStyle(C_SHINE, 1);
  gfx.fillRect(fl + s, ft, fw - 2 * s, s);

  // --- OUTLINES ---
  gfx.lineStyle(s, C_DARK, 1);
  // Front face border
  gfx.strokeRect(fl, ft, fw, fh);
  // Top face border
  gfx.strokePoints([
    { x: fl,      y: ft      },
    { x: fr,      y: ft      },
    { x: fr + tx, y: ft - ty },
    { x: fl + tx, y: ft - ty },
  ], true);
  // Right face border
  gfx.strokePoints([
    { x: fr,      y: ft      },
    { x: fr + tx, y: ft - ty },
    { x: fr + tx, y: fb - ty },
    { x: fr,      y: fb      },
  ], true);
}

// ---------------------------------------------------------------------------
// Music — 8-bit Cali salsa via Web Audio API
// ---------------------------------------------------------------------------
function startMusic(scene) {
  // TODO: implement salsa caleña 8-bit loop with AudioContext oscillators
  try {
    const ctx = scene.sound.context;
    if (!ctx) return;
    // Placeholder: single chord drone to confirm audio works
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 220;
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    // Will be replaced with full salsa arrangement
  } catch (_) {}
}