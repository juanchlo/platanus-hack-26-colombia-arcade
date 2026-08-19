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
    musicStarted: false,
  };

  // Build all layers (start hidden as needed)
  createBackground(scene);
  createTrack(scene);
  createPlayers(scene);
  createObstaclePool(scene);
  createHud(scene);
  createStartScreen(scene);
  createGameOverScreen(scene);

  showStartScreen(scene);
}

function update(time, delta) {
  const scene = this;
  clearPressed();

  if (scene.phase === 'start') {
    updateStartScreen(scene, time);
    return;
  }

  if (scene.phase === 'playing') {
    updateScroll(scene, delta);
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
// Background — static far-parallax (Cielo y Cerros de Cali)
// ---------------------------------------------------------------------------
function createBackground(scene) {
  scene.bgGraphics = scene.add.graphics();
  const gfx = scene.bgGraphics;

  // 1. Cielo Atardecer (se ve en la esquina superior derecha)
  gfx.fillGradientStyle(0x2b1055, 0x2b1055, 0xe07a5f, 0xe07a5f, 1);
  gfx.fillRect(0, 0, W, H);

  // 2. Cerros de Cali en la distancia (horizonte superior derecho)
  gfx.fillStyle(0x1a1a2e, 1);
  gfx.beginPath();
  gfx.moveTo(250, 400);
  gfx.lineTo(500, 100); // Cerro 1 (ej. Cristo Rey)
  gfx.lineTo(650, 180);
  gfx.lineTo(850, 80);  // Cerro 2 (ej. Tres Cruces)
  gfx.lineTo(W, 450);
  gfx.lineTo(250, 450);
  gfx.closePath();
  gfx.fill();

  // Las 3 cruces en miniatura
  gfx.lineStyle(2, 0x555566, 1);
  for (let i = 0; i < 3; i++) {
    let x = 620 + i * 15;
    let y = 140 - (i === 1 ? 7 : 0);
    gfx.lineBetween(x, y, x, y - 10);
    gfx.lineBetween(x - 4, y - 6, x + 4, y - 6);
  }

  // 3. El abismo/vacío profundo (esquina inferior derecha y fondo)
  // El asfalto se dibujará sobre esto.
  gfx.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x050510, 0x050510, 1);
  gfx.fillRect(0, 200, W, H);
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

const trackCurbY  = (x) => x * TRACK_M + CURB_OFFSET;
const trackCliffY = (x) => x * TRACK_M + CLIFF_OFFSET;

// Convierte una posición lateral (lat, igual que player.lat) + una X de
// pantalla en la Y correspondiente sobre la pista diagonal.
function laneY(x, lat) {
  const t = Phaser.Math.Clamp((lat - LAT_MIN) / (LAT_MAX - LAT_MIN), 0, 1);
  return trackCurbY(x) + t * (trackCliffY(x) - trackCurbY(x));
}

function createTrack(scene) {
  scene.trackGraphics = scene.add.graphics();
  renderTrack(scene, 0); // Frame inicial
}

function renderTrack(scene, distance) {
  const gfx = scene.trackGraphics;
  gfx.clear();

  const curbY = trackCurbY;
  const cliffY = trackCliffY;

  // 1. BASE DE ASFALTO INCLINADO (Paralelogramo perfecto)
  gfx.fillStyle(0x3a3a45, 1);
  gfx.fillPoints([
    {x: 0, y: curbY(0)}, {x: W, y: curbY(W)},
    {x: W, y: cliffY(W)}, {x: 0, y: cliffY(0)}
  ], true);

  // 2. ANDÉN IZQUIERDO (Amarillo y Azul, tamaño constante)
  const sSpace = 120;
  let sOff = distance % sSpace;
  for (let x = W + sSpace - sOff; x > -sSpace; x -= sSpace) {
    let worldId = Math.floor((x + distance) / sSpace);
    let nextX = x - sSpace;
    gfx.fillStyle(worldId % 2 === 0 ? 0xddaa00 : 0x2255dd, 1);
    gfx.fillPoints([
      {x: x, y: curbY(x)}, {x: nextX, y: curbY(nextX)},
      {x: nextX, y: curbY(nextX) - 20}, {x: x, y: curbY(x) - 20}
    ], true);
  }

  // 3. LÍNEAS DE LA CALLE (Perpendiculares a la diagonal)
  const lSpace = 200;
  let lOff = distance % lSpace;
  for (let x = W + lSpace - lOff; x > -lSpace; x -= lSpace) {
    let y = (curbY(x) + cliffY(x)) / 2;
    gfx.fillStyle(0xddaa00, 0.9);
    // Dibujamos el rectángulo de la línea respetando el ángulo isométrico
    gfx.fillPoints([
      {x: x, y: y}, {x: x - 60, y: y - 30},
      {x: x - 60, y: y - 22}, {x: x, y: y + 8}
    ], true);
  }

  // 4. BARANDA OXIDADA CONSTANTE (Borde Inferior Derecho)
  gfx.lineStyle(4, 0x555555, 1);
  gfx.lineBetween(0, cliffY(0), W, cliffY(W));

  const rSpace = 150;
  let rOff = distance % rSpace;
  for (let x = W + rSpace - rOff; x > -rSpace; x -= rSpace) {
    let y = cliffY(x);
    gfx.fillStyle(0x8b4513, 1);
    gfx.fillRect(x, y - 40, 8, 40); // Postes rectos
  }
  // Tubo principal rígido
  gfx.lineStyle(6, 0x8b4513, 1);
  gfx.lineBetween(0, cliffY(0) - 35, W, cliffY(W) - 35);
}

function createPlayers(scene) {
  scene.players = {
    p1: {
      lat: -40, // Posición lateral (negativo es hacia el andén izquierdo)
      prog: 0,  // Posición adelante(+)/atrás(-) respecto a la línea del pelotón
      x: 0, y: 0, 
      jumping: false, jumpCharging: false, jumpHeld: 0, jumpElapsed: 0, jumpDuration: 0, jumpZ: 0,
      pushing: false,
      paralyzed: 0,
      alive: true,
      label: 'P1',
    },
    p2: {
      lat: 40, // Posición lateral (positivo es hacia el barranco derecho)
      prog: 0,
      x: 0, y: 0,
      jumping: false, jumpCharging: false, jumpHeld: 0, jumpElapsed: 0, jumpDuration: 0, jumpZ: 0,
      pushing: false,
      paralyzed: 0,
      alive: true,
      label: 'P2',
    },
  };
  scene.playerGraphics = scene.add.graphics();
  renderPlayers(scene);
}

function renderPlayers(scene) {
  const gfx = scene.playerGraphics;
  gfx.clear();
  const { p1, p2 } = scene.players;
  renderOnePlayer(gfx, p1);
  renderOnePlayer(gfx, p2);
}

function renderOnePlayer(gfx, player) {
  if (!player.alive) return;

  // Sombra en el piso (se achica mientras el jugador está en el aire)
  const shrink = 1 - player.jumpZ * 0.5;
  gfx.fillStyle(0x000000, 0.3);
  gfx.fillEllipse(player.x, player.y + 14, 34 * shrink, 10 * shrink);

  // Destello rojo breve mientras está paralizado tras un golpe
  if (player.paralyzed > 0) {
    gfx.fillStyle(0xff3333, 0.35 * Math.min(1, player.paralyzed / PARALYZE_DURATION));
    gfx.fillCircle(player.x, player.y, 46);
  }

  // La canasta se eleva visualmente durante el salto (eje Z falso)
  const liftY = player.y - player.jumpZ * 46;
  drawBeerCrate(gfx, player.x, liftY, 3);
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

function drawRustyRailObstacle(gfx, cx, cy, scale, length) {
  const s = scale || 1;
  const len = length || 90 * s;

  const C_POST      = 0x6b4226;
  const C_PIPE_BASE = 0x8b4513;
  const C_RUST_1    = 0xb35a1f;
  const C_RUST_2    = 0xd9782e;
  const C_HAZARD_Y  = 0xf2c40c;
  const C_HAZARD_B  = 0x1a1a1a;
  const C_DARK      = 0x2a1608;

  gfx.fillStyle(C_POST, 1);
  gfx.fillRect(cx - len / 2, cy - 6 * s, 5 * s, 26 * s);
  gfx.fillRect(cx + len / 2 - 5 * s, cy - 6 * s, 5 * s, 26 * s);

  gfx.fillStyle(C_RUST_1, 0.8);
  gfx.fillCircle(cx - len / 2 + 2 * s, cy + 16 * s, 6 * s);
  gfx.fillCircle(cx + len / 2 - 2 * s, cy + 16 * s, 6 * s);

  gfx.lineStyle(6 * s, C_PIPE_BASE, 1);
  gfx.beginPath();
  gfx.moveTo(cx - len / 2, cy - 4 * s);
  gfx.lineTo(cx, cy + 2 * s);
  gfx.lineTo(cx + len / 2, cy - 4 * s);
  gfx.strokePath();

  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const px = cx - len / 2 + t * len;
    const py = cy - 4 * s + Math.sin(t * Math.PI) * 6 * s;
    gfx.fillStyle(i % 2 === 0 ? C_RUST_1 : C_RUST_2, 0.85);
    gfx.fillCircle(px, py, 3 * s + (i % 3));
  }

  for (let i = 0; i < 4; i++) {
    gfx.fillStyle(i % 2 === 0 ? C_HAZARD_Y : C_HAZARD_B, 1);
    gfx.fillRect(cx - len / 2 - 2 * s + i * 3 * s, cy - 12 * s, 3 * s, 8 * s);
  }

  gfx.lineStyle(1 * s, C_DARK, 0.7);
  gfx.strokeRect(cx - len / 2, cy - 6 * s, 5 * s, 26 * s);
  gfx.strokeRect(cx + len / 2 - 5 * s, cy - 6 * s, 5 * s, 26 * s);
}

// --- Configuración por tipo -------------------------------------------------
// hazardRadius: mitad del ancho lateral que ocupa el peligro (en unidades de "lat")
// railGap: [min,max] de lat que SÍ es seguro pasar (pegado a la baranda) — el resto cae al vacío
const OBSTACLE_DEF = {
  hole:  { hazardRadius: 16, scale: 1.1 },
  drunk: { hazardRadius: 26, scale: 1.5 },
  rail:  { railSafeMin: 55, railSafeMax: 85, scale: 1 }, // franja segura pegada al barranco
};

const SPAWN_X = W + 90; // aparecen fuera de pantalla, a la derecha
const DESPAWN_X = -80;

function createObstaclePool(scene) {
  scene.obstacles = [];
  scene.obstacleGraphics = scene.add.graphics();
  scene.gameState.spawnTimer = 1.2; // primer obstáculo llega poco después de arrancar
}

function spawnObstacle(scene) {
  const roll = Math.random();
  let type = 'hole';
  if (roll < 0.34) type = 'hole';
  else if (roll < 0.68) type = 'drunk';
  else type = 'rail';

  let lat;
  if (type === 'rail') {
    // La baranda siempre está pegada al lado del barranco (lat positivo)
    lat = Phaser.Math.Between(60, 80);
  } else {
    lat = Phaser.Math.Between(LAT_MIN + 10, LAT_MAX - 10);
  }

  scene.obstacles.push({
    type, lat,
    x: SPAWN_X,
    prevX: SPAWN_X,
    resolvedP1: false, // ya se evaluó el cruce para cada jugador (cada uno tiene su propia línea, según su 'prog')
    resolvedP2: false,
  });
}

function updateObstacles(scene, delta) {
  const dt = delta / 1000;
  const { p1, p2 } = scene.players;
  const gfx = scene.obstacleGraphics;

  // Spawnea nuevos obstáculos; el ritmo se acelera con la velocidad
  scene.gameState.spawnTimer -= dt;
  if (scene.gameState.spawnTimer <= 0) {
    spawnObstacle(scene);
    const speedFactor = Phaser.Math.Clamp(scene.gameState.speed / 900, 0, 1);
    const gapMax = Phaser.Math.Linear(2.2, 0.9, speedFactor);
    const gapMin = Phaser.Math.Linear(1.1, 0.5, speedFactor);
    scene.gameState.spawnTimer = Phaser.Math.FloatBetween(gapMin, gapMax);
  }

  gfx.clear();

  for (let i = scene.obstacles.length - 1; i >= 0; i--) {
    const ob = scene.obstacles[i];
    ob.prevX = ob.x;
    ob.x -= scene.gameState.speed * dt;

    // Resolución del choque: se evalúa una sola vez por jugador, al cruzar
    // SU propia línea del "ahora" (la línea base desplazada por su 'prog').
    checkObstacleCrossing(scene, ob, p1, 'resolvedP1');
    checkObstacleCrossing(scene, ob, p2, 'resolvedP2');

    const y = laneY(ob.x, ob.lat);
    const def = OBSTACLE_DEF[ob.type];
    if (ob.type === 'hole') drawPothole(gfx, ob.x, y, def.scale);
    else if (ob.type === 'drunk') drawDrunkObstacle(gfx, ob.x, y, def.scale);
    else if (ob.type === 'rail') drawRustyRailObstacle(gfx, ob.x, y, def.scale, 110);

    if (ob.x < DESPAWN_X) scene.obstacles.splice(i, 1);
  }
}

function checkObstacleCrossing(scene, ob, player, flagKey) {
  if (ob[flagKey]) return;
  const line = COLLISION_X + player.prog; // adelantarse o rezagarse mueve tu propia línea de choque
  if (ob.prevX >= line && ob.x < line) {
    ob[flagKey] = true;
    resolveObstacleHit(scene, ob, player);
  }
}

function resolveObstacleHit(scene, obstacle, player) {
  if (!player.alive) return;
  const def = OBSTACLE_DEF[obstacle.type];

  if (obstacle.type === 'rail') {
    // Debe estar drifteando MUY cerca de la baranda (franja segura); si no, lo golpea
    const inSafeZone = player.lat >= def.railSafeMin && player.lat <= def.railSafeMax;
    if (!inSafeZone) applyKnockback(scene, player);
    return;
  }

  // hole / drunk — hay que estar en su carril Y saltar con la potencia adecuada
  const inHazardLane = Math.abs(player.lat - obstacle.lat) < def.hazardRadius;
  if (!inHazardLane) return; // el obstáculo no está en su camino, pasa de largo

  if (isClearingJump(player, obstacle.type)) return; // salto limpio, sin penalización

  applyKnockback(scene, player);
}

// Un obstáculo fallado NO es game over: te manda hacia atrás y te paraliza
// un instante. Sólo perdés si te quedan empujando tanto que salís de pantalla.
function applyKnockback(scene, player) {
  player.prog -= PROG_KNOCKBACK;
  player.paralyzed = PARALYZE_DURATION;
  player.jumping = false;
  player.jumpCharging = false;
  player.jumpZ = 0;
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function createHud(scene) {
  scene.hud = {};
  scene.hud.p1Label = scene.add.text(20, 16, 'P1', { fontFamily: 'monospace', fontSize: '20px', color: '#ff4444' }).setDepth(10);
  scene.hud.p2Label = scene.add.text(W - 20, 16, 'P2', { fontFamily: 'monospace', fontSize: '20px', color: '#44aaff' }).setOrigin(1, 0).setDepth(10);
  scene.hud.speed = scene.add.text(W / 2, 16, '', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' }).setOrigin(0.5, 0).setDepth(10);
}

function updateHud(scene) {
  const spd = Math.round(scene.gameState.speed);
  scene.hud.speed.setText(`${spd} km/h`);
}

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------
function createStartScreen(scene) {
  const c = scene.add.container(0, 0).setDepth(20);
  c.add(scene.add.rectangle(W / 2, H / 2, W, H, 0x080810, 0.93));

  c.add(scene.add.text(W / 2, 72, 'PLATANUS HACK 26', {
    fontFamily: 'monospace', fontSize: '13px', color: '#886600',
  }).setOrigin(0.5));
  c.add(scene.add.text(W / 2, 100, 'SAN ANTONIO DRIFT', {
    fontFamily: 'monospace', fontSize: '40px', color: '#ffdd00', fontStyle: 'bold',
  }).setOrigin(0.5));
  c.add(scene.add.text(W / 2, 158, 'BARRIO SAN ANTONIO · CALI, COLOMBIA', {
    fontFamily: 'monospace', fontSize: '12px', color: '#666644',
  }).setOrigin(0.5));

  // Crate preview — two crates representing P1 and P2
  const previewGfx = scene.add.graphics();
  const crateY = 278;
  const cx1 = W / 2 - 70;
  const cx2 = W / 2 + 70;
  drawBeerCrate(previewGfx, cx1, crateY, 4);
  drawBeerCrate(previewGfx, cx2, crateY, 4);
  c.add(previewGfx);

  c.add(scene.add.text(cx1, 230, 'P1', {
    fontFamily: 'monospace', fontSize: '13px', color: '#ff5555', fontStyle: 'bold',
  }).setOrigin(0.5));
  c.add(scene.add.text(cx2, 230, 'P2', {
    fontFamily: 'monospace', fontSize: '13px', color: '#5599ff', fontStyle: 'bold',
  }).setOrigin(0.5));

  const startText = scene.add.text(W / 2, 368, 'PRESS START', {
    fontFamily: 'monospace', fontSize: '26px', color: '#ffffff', fontStyle: 'bold',
  }).setOrigin(0.5);
  c.add(startText);
  scene.tweens.add({
    targets: startText, alpha: 0.15, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });

  c.add(scene.add.text(W / 2, H - 28, 'P1: WASD mover   U saltar   I empujar     P2: Flechas mover   R saltar   T empujar', {
    fontFamily: 'monospace', fontSize: '10px', color: '#444444',
  }).setOrigin(0.5));

  scene.startScreen = c;
}

function showStartScreen(scene) {
  scene.phase = 'start';
  scene.startScreen.setVisible(true);
}

function updateStartScreen(scene, time) {
  if (consumePressed('START1') || consumePressed('START2')) {
    scene.startScreen.setVisible(false);
    startGame(scene);
  }
}

// ---------------------------------------------------------------------------
// Game over screen
// ---------------------------------------------------------------------------
function createGameOverScreen(scene) {
  const c = scene.add.container(0, 0).setDepth(20);
  c.add(scene.add.rectangle(W / 2, H / 2, W, H, 0x0a0a1a, 0.92));
  scene.goTitle = scene.add.text(W / 2, 180, '', { fontFamily: 'monospace', fontSize: '32px', color: '#ffdd00', fontStyle: 'bold' }).setOrigin(0.5);
  scene.goSub = scene.add.text(W / 2, 240, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);
  c.add(scene.goTitle);
  c.add(scene.goSub);
  c.add(scene.add.text(W / 2, H - 50, 'PRESS START TO PLAY AGAIN', { fontFamily: 'monospace', fontSize: '14px', color: '#aaaaaa' }).setOrigin(0.5));
  scene.gameOverScreen = c;
  c.setVisible(false);
}

function showGameOver(scene, winnerLabel) {
  scene.phase = 'gameover';
  scene.goTitle.setText(winnerLabel + ' WINS!');
  scene.goSub.setText(`Distance: ${Math.round(scene.gameState.distance)} m`);
  scene.gameOverScreen.setVisible(true);
}

function updateGameOverScreen(scene, time) {
  if (consumePressed('START1') || consumePressed('START2')) {
    scene.gameOverScreen.setVisible(false);
    resetGame(scene);
    startGame(scene);
  }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame(scene) {
  scene.phase = 'playing';
  scene.gameState.speed = 200;
  scene.gameState.distance = 0;
  scene.gameState.spawnTimer = 1.2;
  scene.obstacles = [];
  if (scene.obstacleGraphics) scene.obstacleGraphics.clear();

  for (const player of [scene.players.p1, scene.players.p2]) {
    player.alive = true;
    player.eliminatedBy = null;
    player.jumping = false;
    player.jumpCharging = false;
    player.jumpHeld = 0;
    player.jumpElapsed = 0;
    player.jumpDuration = 0;
    player.jumpZ = 0;
    player.prog = 0;
    player.paralyzed = 0;
  }
  scene.players.p1.x = W / 2 - 80;
  scene.players.p2.x = W / 2 + 80;

  if (!scene.gameState.musicStarted) {
    startMusic(scene);
    scene.gameState.musicStarted = true;
  }
}

function resetGame(scene) {
  scene.obstacles = [];
  scene.gameState.speed = 0;
  scene.gameState.distance = 0;
  scene.gameState.spawnTimer = 1.2;
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
  // Acelera progresivamente el mapa
  scene.gameState.speed = Math.min(scene.gameState.speed + 8 * dt, 900);
  
  // Aumenta la distancia global
  scene.gameState.distance += scene.gameState.speed * dt;
  
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
  handlePlayerInput(scene, p2, 'P2', dt);
  resolvePlayerCollision(scene, p1, p2);

  // Si el rezago (empujones acumulados hacia atrás) es demasiado, el jugador
  // queda fuera de pantalla por arriba y pierde — sin necesidad de un solo golpe fatal.
  for (const player of [p1, p2]) {
    if (player.alive && player.prog < PROG_ELIMINATE) {
      player.alive = false;
      player.eliminatedBy = 'trail';
    }
  }

  renderPlayers(scene);
}

// Rango de movimiento voluntario adelante/atrás (el empujón de un obstáculo
// SÍ puede mandarte más atrás de este límite; sólo avanzando lo recuperás).
const PROG_MOVE_MIN = -60;
const PROG_MOVE_MAX = 60;
const PROG_KNOCKBACK = 50;     // cuánto te manda hacia atrás un obstáculo fallado
const PROG_ELIMINATE = -170;   // más atrás que esto = salís de pantalla, perdés
const PARALYZE_DURATION = 0.5; // segundos paralizado tras un golpe

function handlePlayerInput(scene, player, prefix, dt) {
  if (!player.alive) return;

  if (player.paralyzed > 0) {
    player.paralyzed = Math.max(0, player.paralyzed - dt);
  }

  const latSpeed = 220;  // Velocidad de esquive lateral
  const progSpeed = 170; // Velocidad de avance/retroceso

  // Mientras está paralizado (recién golpeado) no responde a los controles
  if (player.paralyzed <= 0) {
    let dLat = 0;
    // Izquierda te mueve hacia el andén (arriba-derecha visualmente en la perpendicular)
    if (held[prefix + '_L']) dLat -= 1;
    // Derecha te mueve hacia el barranco (abajo-izquierda visualmente en la perpendicular)
    if (held[prefix + '_R']) dLat += 1;
    if (dLat !== 0) {
      player.lat = Phaser.Math.Clamp(player.lat + dLat * latSpeed * dt, -85, 85);
    }

    let dProg = 0;
    if (held[prefix + '_U']) dProg += 1; // adelante: te adelantás en la bajada
    if (held[prefix + '_D']) dProg -= 1; // atrás: te rezagás a propósito
    if (dProg !== 0) {
      // El movimiento voluntario respeta el rango normal; si venís de un
      // empujón más atrás de ese rango, primero tenés que remontar hasta él.
      player.prog = Phaser.Math.Clamp(player.prog + dProg * progSpeed * dt, PROG_MOVE_MIN, PROG_MOVE_MAX);
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

  // --- Salto variable: mantené presionado para cargar, soltá para saltar ---
  // Hueco (obstáculo pequeño) = toque corto. Botellas+borracho (grande) = carga larga.
  const JUMP_MIN_DURATION = 0.22;   // salto corto (toque rápido)
  const JUMP_MAX_DURATION = 0.85;   // salto largo (carga máxima)
  const JUMP_MAX_CHARGE   = 0.6;    // segundos de carga para llegar al salto máximo

  if (consumePressed(prefix + '_1') && !player.jumping) {
    player.jumpCharging = true;
    player.jumpHeld = 0;
  }
  if (player.jumpCharging) {
    if (held[prefix + '_1']) {
      player.jumpHeld = Math.min(player.jumpHeld + dt, JUMP_MAX_CHARGE);
    } else {
      // Soltó el botón: despega con una duración proporcional a la carga
      const t = player.jumpHeld / JUMP_MAX_CHARGE;
      player.jumpDuration = Phaser.Math.Linear(JUMP_MIN_DURATION, JUMP_MAX_DURATION, t);
      player.jumpElapsed = 0;
      player.jumping = true;
      player.jumpCharging = false;
    }
  }

  if (player.jumping) {
    player.jumpElapsed += dt;
    if (player.jumpElapsed >= player.jumpDuration) {
      player.jumping = false;
      player.jumpZ = 0;
    } else {
      // Arco parabólico simple (0 → 1 → 0) para la altura visual
      player.jumpZ = Math.sin(Math.PI * (player.jumpElapsed / player.jumpDuration));
    }
  }
}

// Duración de salto necesaria para "limpiar" cada tipo de obstáculo
const JUMP_REQUIRED = { hole: 0.22, drunk: 0.55 };

function isClearingJump(player, obstacleType) {
  return player.jumping && player.jumpDuration >= JUMP_REQUIRED[obstacleType];
}

function resolvePlayerCollision(scene, p1, p2) {
  // Las colisiones se resuelven en el eje lateral, como antes — el nuevo eje
  // de avance/retroceso no bloquea entre jugadores, sólo el lateral.
  const minLatDist = 40; // Ancho lateral de la canasta
  const diff = p1.lat - p2.lat;
  
  if (Math.abs(diff) < minLatDist) {
    const push = (minLatDist - Math.abs(diff)) / 2;
    if (diff > 0) { p1.lat += push; p2.lat -= push; }
    else { p1.lat -= push; p2.lat += push; }
    
    // Asegurar que un choque no los empuje fuera del puente
    p1.lat = Phaser.Math.Clamp(p1.lat, -85, 85);
    p2.lat = Phaser.Math.Clamp(p2.lat, -85, 85);
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

  if (bothDead) { showGameOver(scene, 'NOBODY'); return; }
  if (p1Dead)  { showGameOver(scene, 'P2'); return; }
  if (p2Dead)  { showGameOver(scene, 'P1'); return; }
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

  // Palette — dark maroon plastic, like the Trougott Simon crate
  const C_TOP    = 0xd93232;  // top face (sunlit)
  const C_FRONT  = 0xb82020;  // front face
  const C_RIGHT  = 0x8a1515;  // right face (shadow)
  const C_DARK   = 0x3a0808;  // outlines
  const C_HOLE   = 0x180303;  // handle holes (near black)
  const C_SHINE  = 0xe84444;  // highlight strip at top of front
  const C_STRIPE = 0xa51c1c;  // horizontal rib lines
  const C_DIV    = 0x7a1212;  // bottle divider lines on top face

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