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
    elapsed: 0,       // tiempo transcurrido (segundos)
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
  scene.trackGraphics = scene.add.graphics();
  renderTrack(scene, 0); // Frame inicial
}

// ---------------------------------------------------------------------------
// Track — Asfalto de Cali y Andenes (Mantiene dimensiones y límites intactos)
// ---------------------------------------------------------------------------
function renderTrack(scene, distance) {
  const gfx = scene.trackGraphics;
  gfx.clear();

  const curbY = trackCurbY;
  const cliffY = trackCliffY;

  // =========================================================================
  // 1. ZONAS VERDES LATERALES (Líneas divisorias y base para árboles/casas)
  // =========================================================================
  
  // -- Ladera Izquierda (Zanja/Pastizal oscuro) --
  const leftHillTop = (x) => curbY(x) - 160; 
  gfx.fillStyle(0x386131, 1);
  gfx.fillPoints([
    {x: 0, y: curbY(0)}, {x: W, y: curbY(W)},
    {x: W, y: leftHillTop(W)}, {x: 0, y: leftHillTop(0)}
  ], true);
  gfx.lineStyle(4, 0x24421e, 1);
  gfx.lineBetween(0, leftHillTop(0), W, leftHillTop(W));

  // -- Valle Derecho (Pastizal y desnivel) --
  const valleyTop = (x) => cliffY(x) + 40; 
  gfx.fillStyle(0x5c483a, 1); // Talud de tierra
  gfx.fillPoints([
    {x: 0, y: cliffY(0)}, {x: W, y: cliffY(W)},
    {x: W, y: valleyTop(W)}, {x: 0, y: valleyTop(0)}
  ], true);
  
  gfx.fillStyle(0x4a7c44, 1); // Suelo del valle
  gfx.fillPoints([
    {x: 0, y: valleyTop(0)}, {x: W, y: valleyTop(W)},
    {x: W, y: H}, {x: 0, y: H}
  ], true);
  gfx.lineStyle(4, 0x2e5429, 1);
  gfx.lineBetween(0, valleyTop(0), W, valleyTop(W));

  // =========================================================================
  // 2. PISTA DE ASFALTO (Franja ancha de color gris oscuro)
  // =========================================================================
  gfx.fillStyle(0x2a2a30, 1); // Gris oscuro asfalto
  gfx.fillPoints([
    {x: 0, y: curbY(0)}, {x: W, y: curbY(W)},
    {x: W, y: cliffY(W)}, {x: 0, y: cliffY(0)}
  ], true);

  // =========================================================================
  // 3. ANDENES / ACERAS (Bordes de color gris claro)
  // =========================================================================
  const sSpace = 120;
  let sOff = distance % sSpace;
  for (let x = W + sSpace - sOff; x > -sSpace; x -= sSpace) {
    let nextX = x - sSpace;
    // Andén superior (Izquierdo)
    gfx.fillStyle(0xdcdfe2, 1);
    gfx.fillPoints([
      {x: x, y: curbY(x)}, {x: nextX, y: curbY(nextX)},
      {x: nextX, y: curbY(nextX) - 16}, {x: x, y: curbY(x) - 16}
    ], true);
    // Cantodefinitorio del andén
    gfx.fillStyle(0x9aa0a6, 1);
    gfx.fillPoints([
      {x: x, y: curbY(x)}, {x: nextX, y: curbY(nextX)},
      {x: nextX, y: curbY(nextX) - 4}, {x: x, y: curbY(x) - 4}
    ], true);
  }

  // =========================================================================
  // 4. TEXTURA DEL ASFALTO (Manchas y grietas sin colisiones)
  // =========================================================================
  const lSpace = 160;
  let lOff = distance % lSpace;
  for (let x = W + lSpace - lOff; x > -lSpace; x -= lSpace) {
    let y = (curbY(x) + cliffY(x)) / 2;
    let roadWidth = cliffY(x) - curbY(x);
    
    // Manchas oscuras y grietas dinámicas dispersas en el asfalto
    gfx.fillStyle(0x1a1a20, 0.6);
    gfx.fillRect(x - 30, y - roadWidth * 0.25, 45, 12);
    gfx.fillRect(x - 80, y + roadWidth * 0.2, 35, 15);
    
    // Pequeños polígonos/grietas oscuras simulando parches en la vía
    gfx.fillStyle(0x111115, 0.8);
    gfx.fillPoints([
      {x: x - 20, y: y}, {x: x - 35, y: y - 8}, {x: x - 15, y: y - 14}
    ], true);
  }

  // =========================================================================
  // 5. GENERADOR PROCEDURAL DE CASAS Y ÁRBOLES (Escalas 6.5 y 5.5)
  // =========================================================================
  const objSpace = 100;
  let objOff = distance % objSpace;
  const startX = -objSpace - objOff;
  const endX = W + objSpace;

  for (let x = startX; x <= endX; x += objSpace) {
    let worldId = Math.floor((x + distance) / objSpace);
    
    let rand1 = Math.abs(Math.sin(worldId * 12.9898) * 43758.5453) % 1;
    let rand2 = Math.abs(Math.cos(worldId * 4.1415) * 43758.5453) % 1;
    
    // --- Lado Izquierdo (Ladera superior) ---
    if (rand1 > 0.35) {
      let y_house = curbY(x) - 10 - rand2 * 40;
      let y_tree = curbY(x) - 60 - rand2 * 80;
      if (rand1 > 0.9) {
        drawIsoHouse(gfx, x, y_house, 6.5, worldId % 2 !== 0);
      } else {
        drawIsoTree(gfx, x, y_tree, 5.5);
      }
    }
    
    // --- Lado Derecho (Valle inferior) ---
    if (rand2 > 0.25) {
      let y_house = cliffY(x) + 100 + rand1 * 50;
      let y_tree = cliffY(x) + 70 + rand1 * 100;
      if (rand2 > 0.85) {
        drawIsoHouse(gfx, x-10, y_house, 6.5, worldId % 2 === 0);
      } else {
        drawIsoTree(gfx, x, y_tree, 5.5);
      }
    }
  }
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
      knockbackVel: 0,
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
      knockbackVel: 0,
      alive: true,
      label: 'P2',
    },
  };
  scene.playerGraphics = scene.add.graphics().setDepth(5);
  renderPlayers(scene);
}

function renderPlayers(scene, time, speed) {
  const gfx = scene.playerGraphics;
  gfx.clear();
  const { p1, p2 } = scene.players;
  renderOnePlayer(gfx, p1, time, speed);
  renderOnePlayer(gfx, p2, time, speed);
}

function renderOnePlayer(gfx, player, time, speed) {
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
  if (player.label === 'P1') drawNea(gfx, player.x, liftY, 3, time, speed);
  else drawChango(gfx, player.x, liftY, 3, time, speed);
}

// ---------------------------------------------------------------------------
// Procedural Assets (Casas y Árboles en perspectiva Isométrica 2:1)
// ---------------------------------------------------------------------------
// Función maestra para dibujar bloques isométricos 8-bits
function drawIsoBlock(gfx, cx, cy, w, d, h, cFront, cSide, cTop, cLine) {
  const tyL = w * 0.5; // Inclinación izquierda
  const tyR = d * 0.5; // Inclinación derecha

  // Lado derecho (Sombra)
  gfx.fillStyle(cSide, 1);
  gfx.fillPoints([{x:cx, y:cy}, {x:cx+d, y:cy-tyR}, {x:cx+d, y:cy-tyR-h}, {x:cx, y:cy-h}], true);

  // Lado frontal/izquierdo (Luz)
  gfx.fillStyle(cFront, 1);
  gfx.fillPoints([{x:cx, y:cy}, {x:cx-w, y:cy-tyL}, {x:cx-w, y:cy-tyL-h}, {x:cx, y:cy-h}], true);

  // Arriba (Luz superior)
  gfx.fillStyle(cTop, 1);
  gfx.fillPoints([{x:cx, y:cy-h}, {x:cx-w, y:cy-tyL-h}, {x:cx-w+d, y:cy-tyL-tyR-h}, {x:cx+d, y:cy-tyR-h}], true);

  // Bordes (Estilo pixel art)
  if (cLine) {
    gfx.lineStyle(2, cLine, 1);
    // Contorno exterior y aristas visibles
    gfx.strokePoints([{x:cx-w, y:cy-tyL}, {x:cx, y:cy}, {x:cx+d, y:cy-tyR}, {x:cx+d, y:cy-tyR-h}, {x:cx-w+d, y:cy-tyL-tyR-h}, {x:cx-w, y:cy-tyL-h}], true);
    gfx.lineBetween(cx, cy, cx, cy-h); // Arista central
    gfx.lineBetween(cx-w, cy-tyL-h, cx, cy-h); // Arista superior izq
    gfx.lineBetween(cx+d, cy-tyR-h, cx, cy-h); // Arista superior der
  }
}

function drawIsoTree(gfx, cx, cy, scale) {
  const s = scale || 2;
  // Sombra
  gfx.fillStyle(0x000000, 0.2);
  gfx.fillEllipse(cx, cy, 14 * s, 7 * s);

  // Tronco
  gfx.fillStyle(0x4a2e1b, 1);
  gfx.fillRect(cx - 2 * s, cy - 8 * s, 4 * s, 8 * s);
  
  // Hojas (Generador de bloques isométricos apilados)
  const drawBlock = (bx, by, bw, cTop, cLeft, cRight) => {
    const ty = bw * 0.5; // La magia de la pendiente 0.5
    gfx.fillStyle(cLeft, 1);
    gfx.fillPoints([{x:bx, y:by}, {x:bx-bw, y:by-ty}, {x:bx-bw, y:by-ty-bw}, {x:bx, y:by-bw}], true);
    gfx.fillStyle(cRight, 1);
    gfx.fillPoints([{x:bx, y:by}, {x:bx+bw, y:by-ty}, {x:bx+bw, y:by-ty-bw}, {x:bx, y:by-bw}], true);
    gfx.fillStyle(cTop, 1);
    gfx.fillPoints([{x:bx, y:by-bw}, {x:bx-bw, y:by-ty-bw}, {x:bx, y:by-ty*2-bw}, {x:bx+bw, y:by-ty-bw}], true);
  };
  
  // Dos capas de hojas formando la copa
  drawBlock(cx, cy - 6 * s, 9 * s, 0x3d7035, 0x2e5928, 0x1f3d1b);
  drawBlock(cx, cy - 13 * s, 6 * s, 0x4a8540, 0x3d7035, 0x2e5928);
}

function drawIsoHouse(gfx, cx, cy, scale, isAltColor) {
  const s = scale || 2.5;
  const fw = 14 * s; // Ancho cara izquierda
  const dw = 12 * s; // Ancho cara derecha
  const h  = 12 * s; // Altura
  const tyL = fw * 0.5; 
  const tyR = dw * 0.5;
  
  // Paletas intercambiables (Casas coloniales coloridas)
  const cFront = isAltColor ? 0xd95a53 : 0xeaddcf; 
  const cSide  = isAltColor ? 0xa8413b : 0xbfb4a8;
  const cRoof  = 0x3a3a3a;
  
  // Pared Izquierda
  gfx.fillStyle(cFront, 1);
  gfx.fillPoints([{x:cx, y:cy}, {x:cx-fw, y:cy-tyL}, {x:cx-fw, y:cy-tyL-h}, {x:cx, y:cy-h}], true);
  
  // Pared Derecha
  gfx.fillStyle(cSide, 1);
  gfx.fillPoints([{x:cx, y:cy}, {x:cx+dw, y:cy-tyR}, {x:cx+dw, y:cy-tyR-h}, {x:cx, y:cy-h}], true);
  
  // Techo (Plano para estilo cubo 8-bits)
  gfx.fillStyle(cRoof, 1);
  gfx.fillPoints([{x:cx, y:cy-h}, {x:cx-fw, y:cy-tyL-h}, {x:cx-fw+dw, y:cy-tyL-tyR-h}, {x:cx+dw, y:cy-tyR-h}], true);
  
  // Puerta Isométrica (Cara izquierda)
  gfx.fillStyle(0x3d2314, 1);
  gfx.fillPoints([
    {x:cx-3*s, y:cy-1.5*s}, {x:cx-7*s, y:cy-3.5*s}, 
    {x:cx-7*s, y:cy-3.5*s-6*s}, {x:cx-3*s, y:cy-1.5*s-6*s}
  ], true);

  // Ventana Isométrica (Cara derecha)
  gfx.fillStyle(0x112233, 1);
  gfx.fillPoints([
    {x:cx+3*s, y:cy-1.5*s-4*s}, {x:cx+7*s, y:cy-3.5*s-4*s}, 
    {x:cx+7*s, y:cy-3.5*s-7*s}, {x:cx+3*s, y:cy-1.5*s-7*s}
  ], true);
}

function drawIsoCross(gfx, cx, cy, scale) {
  const s = scale || 2;
  const cF = 0xcccccc; // Gris claro (Frente)
  const cS = 0x888899; // Gris oscuro (Lado)
  const cT = 0xeeeeee; // Blanco/Gris muy claro (Arriba)
  const cL = 0x222222; // Borde negro

  // Se dibuja de abajo hacia arriba para respetar el Z-Index
  // 1. Pilar inferior
  drawIsoBlock(gfx, cx, cy, 4*s, 4*s, 16*s, cF, cS, cT, cL);
  
  // 2. Brazo horizontal (Atraviesa el pilar)
  // Desplazamos el ancla (cx, cy) hacia arriba y a la izquierda para centrar el brazo
  const bx = cx + 7*s;
  const by = cy - 7*s - (6*s * 0.5);
  drawIsoBlock(gfx, bx, by, 16*s, 4*s, 4*s, cF, cS, cT, cL);
  
  // 3. Pilar superior
  const tx = cx;
  const ty = cy - 20*s;
  drawIsoBlock(gfx, tx, ty, 4*s, 4*s, 8*s, cF, cS, cT, cL);
}

function drawIsoChurch(gfx, cx, cy, scale) {
  const s = scale || 2.5;
  const cWallF = 0xf0f0f0; // Pared blanca
  const cWallS = 0xa0a0a8; // Pared sombra
  const cRoofF = 0x8c4c3e; // Techo terracota claro
  const cRoofS = 0x5e332a; // Techo terracota oscuro
  const cLine  = 0x222222;

  // 1. NAVE CENTRAL (Edificio principal atrás)
  const nx = cx + 15*s;
  const ny = cy - 10*s;
  drawIsoBlock(gfx, nx, ny, 25*s, 20*s, 18*s, cWallF, cWallS, 0xdddddd, cLine);
  
  // Techo a dos aguas de la nave (Construido con polígonos manuales por la inclinación)
  const rH = 12*s;
  gfx.fillStyle(cRoofF, 1);
  gfx.fillPoints([{x:nx, y:ny-18*s}, {x:nx-25*s, y:ny-12.5*s-18*s}, {x:nx-12.5*s, y:ny-6.25*s-18*s-rH}], true);
  gfx.fillStyle(cRoofS, 1);
  gfx.fillPoints([{x:nx, y:ny-18*s}, {x:nx-12.5*s, y:ny-6.25*s-18*s-rH}, {x:nx-12.5*s+20*s, y:ny-6.25*s-10*s-18*s-rH}, {x:nx+20*s, y:ny-10*s-18*s}], true);
  
  // 2. TORRE FRONTAL
  drawIsoBlock(gfx, cx, cy, 14*s, 14*s, 35*s, cWallF, cWallS, 0xdddddd, cLine);
  
  // Puerta de la torre (Doble hoja de madera)
  gfx.fillStyle(0x5e332a, 1);
  gfx.fillPoints([{x:cx-3*s, y:cy-1.5*s}, {x:cx-11*s, y:cy-5.5*s}, {x:cx-11*s, y:cy-5.5*s-10*s}, {x:cx-3*s, y:cy-1.5*s-10*s}], true);
  gfx.lineStyle(1.5, cLine, 1);
  gfx.lineBetween(cx-7*s, cy-3.5*s, cx-7*s, cy-3.5*s-10*s); // División de la puerta

  // Ventanas altas de la torre (Cristal azul)
  gfx.fillStyle(0x336699, 1);
  gfx.fillPoints([{x:cx-4*s, y:cy-2*s-15*s}, {x:cx-10*s, y:cy-5*s-15*s}, {x:cx-10*s, y:cy-5*s-22*s}, {x:cx-4*s, y:cy-2*s-22*s}], true);
  gfx.fillPoints([{x:cx-4*s, y:cy-2*s-25*s}, {x:cx-10*s, y:cy-5*s-25*s}, {x:cx-10*s, y:cy-5*s-32*s}, {x:cx-4*s, y:cy-2*s-32*s}], true);

  // 3. TECHO ESCALONADO DE LA TORRE (El sello visual de tu referencia)
  let tw = 14*s, td = 14*s, ty = cy - 35*s, tx = cx;
  for(let i=0; i<4; i++) {
    drawIsoBlock(gfx, tx, ty, tw, td, 4*s, cRoofF, cRoofS, cRoofF, cLine);
    // Reducir dimensiones y subir para el siguiente escalón
    tw -= 3*s; td -= 3*s;
    tx -= 1.5*s; // Mantener centrado visualmente
    ty -= 4*s + (1.5*s * 0.5); // Subir altura + offset isométrico
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
  const aw = (length || 70) * s;  // ancho/longitud del abismo en px
  const half = aw / 2;
  const x1 = cx - half;
  const x2 = cx + half;

  // 1. ABISMO — vacío oscuro que cubre todo el ancho de la pista
  gfx.fillStyle(0x050510, 0.95);
  gfx.fillPoints([
    {x: x1, y: trackCurbY(x1) - 12}, {x: x2, y: trackCurbY(x2) - 12},
    {x: x2, y: trackCliffY(x2) + 8}, {x: x1, y: trackCliffY(x1) + 8},
  ], true);

  // Bordes del abismo (grietas en el asfalto)
  gfx.lineStyle(2 * s, 0x222230, 1);
  gfx.lineBetween(x1, trackCurbY(x1) - 12, x1, trackCliffY(x1) + 8);
  gfx.lineBetween(x2, trackCurbY(x2) - 12, x2, trackCliffY(x2) + 8);

  // 2. PUENTE — pasarela estrecha sobre el abismo
  const bHalf = 15; // mitad del ancho del puente en unidades de lat
  const bMin = bridgeLat - bHalf;
  const bMax = bridgeLat + bHalf;

  // Esquinas del puente en coordenadas de pantalla
  const y1t = laneY(x1, bMin), y1b = laneY(x1, bMax);
  const y2t = laneY(x2, bMin), y2b = laneY(x2, bMax);

  // Superficie de madera
  gfx.fillStyle(0x6b4226, 1);
  gfx.fillPoints([
    {x: x1, y: y1t}, {x: x2, y: y2t},
    {x: x2, y: y2b}, {x: x1, y: y1b},
  ], true);

  // Tablones (líneas transversales adaptadas a la longitud)
  gfx.lineStyle(1.5 * s, 0x4a2e15, 0.7);
  const numPlanks = Math.max(3, Math.floor(aw / 14));
  for (let i = 1; i < numPlanks; i++) {
    const t = i / numPlanks;
    const px = x1 + t * aw;
    gfx.lineBetween(px, laneY(px, bMin), px, laneY(px, bMax));
  }

  // Barandas metálicas a los lados
  gfx.lineStyle(3 * s, 0x888888, 1);
  gfx.lineBetween(x1, y1t - 5 * s, x2, y2t - 5 * s);
  gfx.lineBetween(x1, y1b - 5 * s, x2, y2b - 5 * s);

  // Postes de la baranda adaptados a la longitud
  gfx.fillStyle(0x666666, 1);
  const numPosts = Math.max(2, Math.floor(aw / 32));
  for (let i = 0; i <= numPosts; i++) {
    const t = i / numPosts;
    const px = x1 + t * aw;
    gfx.fillRect(px - 2 * s, laneY(px, bMin) - 12 * s, 4 * s, 12 * s);
    gfx.fillRect(px - 2 * s, laneY(px, bMax) - 12 * s, 4 * s, 12 * s);
  }

  // Franjas de advertencia amarillo/negro en los bordes del abismo
  for (let side = 0; side < 2; side++) {
    const ex = side === 0 ? x1 - 4 * s : x2;
    for (let i = 0; i < 3; i++) {
      gfx.fillStyle(i % 2 === 0 ? 0xf2c40c : 0x1a1a1a, 1);
      const ey = trackCurbY(ex) - 10 + i * 8 * s;
      gfx.fillRect(ex, ey, 4 * s, 8 * s);
    }
  }
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
    // El abismo cubre todo el ancho — usar posición en el eje de la pista
    // (ignora offset lateral para que no se pueda esquivar moviéndose de lado)
    const trackX = 400 + player.prog;
    const hitRadius = ob.hitRadius || def.hitRadius;
    if (Math.abs(ob.x - trackX) < hitRadius) {
      ob[flagKey] = true;
      resolveObstacleHit(scene, ob, player);
    }
  } else {
    // Huecos y borrachos: distancia real en pantalla
    const dx = ob.x - player.x;
    const dy = obY - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < def.hitRadius) {
      ob[flagKey] = true;
      resolveObstacleHit(scene, ob, player);
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

  // hole / drunk — hay que estar en su carril Y saltar con la potencia adecuada
  const inHazardLane = Math.abs(player.lat - obstacle.lat) < def.hazardRadius;
  if (!inHazardLane) return; // el obstáculo no está en su camino, pasa de largo

  if (isClearingJump(player, obstacle.type)) return; // salto limpio, sin penalización

  applyKnockback(scene, player);
}

// Un obstáculo fallado NO es game over: te paraliza y te empuja hacia atrás
// gradualmente. Sólo perdés si salís de pantalla por el borde trasero.
function applyKnockback(scene, player) {
  player.paralyzed = PARALYZE_DURATION;
  player.knockbackVel = PROG_KNOCKBACK / PARALYZE_DURATION; // retroceso suave
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

  // Crate + character preview
  const previewGfx = scene.add.graphics();
  const crateY = 292;
  const cx1 = W / 2 - 72;
  const cx2 = W / 2 + 72;
  drawBeerCrate(previewGfx, cx1, crateY, 4);
  drawNea(previewGfx, cx1, crateY, 4);           // P1 = Nea
  drawBeerCrate(previewGfx, cx2, crateY, 4);
  drawChango(previewGfx, cx2, crateY, 4);          // P2 = Changó
  c.add(previewGfx);

  c.add(scene.add.text(cx1, 320, 'P1  NEA', {
    fontFamily: 'monospace', fontSize: '11px', color: '#ff5555',
  }).setOrigin(0.5));
  c.add(scene.add.text(cx2, 320, 'P2  CHANGO', {
    fontFamily: 'monospace', fontSize: '11px', color: '#5599ff',
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
  scene.gameState.elapsed = 0;
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
    player.knockbackVel = 0;
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
  scene.gameState.elapsed += dt;

  // Dificultad incremental por tiempo
  const phase = getDiffPhase(scene.gameState.elapsed);
  const ds = DIFF_SETTINGS[phase];

  // Acelera según la fase actual
  scene.gameState.speed = Math.min(scene.gameState.speed + ds.accel * dt, ds.speedMax);
  
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

  // Pierde el jugador que caiga demasiado atrás (prog-based = justo para ambos)
  for (const player of [p1, p2]) {
    if (player.alive && player.prog < PROG_ELIMINATE) {
      player.alive = false;
      player.eliminatedBy = 'trail';
    }
  }

  renderPlayers(scene, time, scene.gameState.speed);
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

  if (bothDead) { showGameOver(scene, 'NOBODY'); return; }
  if (p1Dead)  { showGameOver(scene, 'P2'); return; }
  if (p2Dead)  { showGameOver(scene, 'P1'); return; }
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
function drawNea(gfx, cx, cy, scale, time, speed) {
  const s = scale || 3;
  const r = (v) => Math.round(v * s);
  const baseY = cy - r(3.5);
  const bx = cx;

  // ── Animación idle
  const t = time || 0;
  const spd = speed || 0;
  const leanX = Math.round((spd / 900) * 18);             // 0–18px inclinación al frente
  const hairWave = Math.round(Math.sin(t * 0.005) * 12);  // ±12px onda horizontal coleta
  const hairBob  = Math.round(Math.sin(t * 0.005 + 0.8) * 4); // ±4px onda vertical coleta
  const blink = (t % 3000) < 100;                         // parpadeo cada 3 s × 100 ms
  const ubx = bx + leanX;                                 // pivot cuerpo superior

  // ── TENIS VERDE (cuerpo inferior — sin lean)
  gfx.fillStyle(0x33dd44, 1);
  gfx.fillRect(bx + r(1.3), baseY + r(1.5), r(4.2), r(1.6));
  gfx.fillStyle(0x1a8830, 1);
  gfx.fillRect(bx + r(1.1), baseY + r(2.9), r(4.6), r(0.6));
  gfx.fillStyle(0xaaeeaa, 1);
  gfx.fillRect(bx + r(3.3), baseY + r(1.5), r(1.2), r(0.6));

  // ── PIERNA (sin lean)
  gfx.fillStyle(0x111122, 1);
  gfx.fillRect(bx + r(2.5), baseY + r(0.2), r(2.5), r(1.5));
  gfx.fillRect(bx,          baseY - r(0.5), r(4),   r(1.2));

  // ── SHORTS (sin lean)
  gfx.fillStyle(0x1a1a2e, 1);
  gfx.fillRect(bx - r(2.5), baseY - r(1.8), r(4), r(1.8));

  // ── RIÑONERA AZUL (cuerpo superior — con lean)
  gfx.fillStyle(0x2288ff, 1);
  gfx.fillRect(ubx - r(3.8), baseY - r(3.2), r(2.8), r(1.5));
  gfx.fillStyle(0x88aaff, 1);
  gfx.fillRect(ubx - r(2.7), baseY - r(3.1), r(1),   r(1.3));

  // ── BRAZO IZQUIERDO (con lean)
  gfx.fillStyle(0xb56030, 1);
  gfx.fillRect(ubx,          baseY - r(6.5), r(1.5), r(1.5));
  gfx.fillRect(ubx + r(1.4), baseY - r(6.3), r(2.8), r(1.3));
  gfx.fillRect(ubx + r(3.7), baseY - r(6.3), r(1.3), r(3.8));
  gfx.fillStyle(0xc47840, 1);
  gfx.fillRect(ubx + r(3.4), baseY - r(2.5), r(1.8), r(1));

  // ── TORSO FUCSIA (con lean)
  gfx.fillStyle(0xdd1180, 1);
  gfx.fillRect(ubx - r(2.7), baseY - r(6.8), r(4.2), r(5.5));
  gfx.fillStyle(0xbb0f70, 1);
  gfx.fillRect(ubx + r(0.7), baseY - r(6.8), r(0.8), r(5.5));
  gfx.fillStyle(0x44bbff, 1);
  gfx.fillCircle(ubx - r(1), baseY - r(4.8), r(0.9));
  gfx.fillStyle(0xffee44, 1);
  gfx.fillCircle(ubx - r(1), baseY - r(4.8), r(0.45));

  // ── CUELLO (con lean)
  gfx.fillStyle(0xc47840, 1);
  gfx.fillRect(ubx - r(2.1), baseY - r(8.2), r(1.6), r(1.8));

  // ── CABEZA (con lean)
  const headX = ubx - r(1.3);
  const headY = baseY - r(10.4);

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
function drawChango(gfx, cx, cy, scale, time, speed) {
  const base = scale || 3;
  const s = base * 1.15;                          // 15% más grande que Nea
  const r = (v) => Math.round(v * s);
  const baseY = cy - Math.round(3.5 * base);      // anchor fijo al tope de la canasta
  const bx = cx;

  // ── Animación idle
  const t = time || 0;
  const spd = speed || 0;
  const leanX = Math.round((spd / 900) * 18);              // 0–18px inclinación
  const tailWave = Math.round(Math.sin(t * 0.006) * 13);   // ±13px onda horizontal cola
  const tailBob  = Math.round(Math.sin(t * 0.006 + 1.0) * 5); // ±5px onda vertical
  const blink = (t % 2800) < 110;                          // parpadeo cada 2.8 s
  const ubx = bx + leanX;                                  // pivot cuerpo superior

  // ── COLA — cuadrilátero ondulante (raíz fija, punta flamea en el viento)
  // La raíz sigue al cuerpo superior (ubx), la punta oscila independiente
  const tRX = bx - r(2.5);        // root x (no lean — sale de la espalda baja)
  const tRY = baseY - r(3.2);     // root y
  const tW  = r(0.9);             // grosor
  // Segmento 1: raíz → codo
  gfx.fillStyle(0xcc2222, 1);
  gfx.fillRect(tRX, tRY, tW, r(1.8));
  // Segmento 2: codo → tramo vertical (ondula con tailWave)
  const elbowX = tRX - r(3.8) + Math.round(tailWave * 0.3);
  const elbowY = baseY - r(4.8);
  gfx.fillRect(elbowX, elbowY, r(1.5), r(0.8));
  // Tramo final: cuadrilátero que flamea (base arriba fija, punta oscila ±13px)
  const stemX = elbowX + Math.round(tailWave * 0.15);
  const stemTopY = elbowY - r(2.0);
  const tipY = stemTopY - r(2.2);
  gfx.fillPoints([
    { x: stemX,          y: stemTopY },
    { x: stemX - tW,     y: stemTopY },
    { x: stemX - tW + tailWave, y: tipY + tailBob },
    { x: stemX + tailWave,      y: tipY + tailBob },
  ], true);
  // Punta de pica (sigue la onda)
  const pX = stemX + tailWave;
  const pY = tipY + tailBob;
  gfx.fillStyle(0x880000, 1);
  gfx.fillTriangle(pX - r(0.7), pY, pX + r(0.7), pY, pX, pY - r(2.0));
  gfx.fillRect(pX - r(1.2), pY - r(0.6), r(0.9), r(0.8));   // oreja izq pica
  gfx.fillRect(pX + r(0.3), pY - r(0.6), r(0.9), r(0.8));   // oreja der pica

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

  // ── BRAZO IZQUIERDO (con lean)
  gfx.fillStyle(0xcc2222, 1);
  gfx.fillRect(ubx,          baseY - r(6.5), r(1.5), r(1.5));
  gfx.fillRect(ubx + r(1.4), baseY - r(6.3), r(2.8), r(1.3));
  gfx.fillRect(ubx + r(3.7), baseY - r(6.3), r(1.3), r(3.5));
  gfx.fillStyle(0xbb1111, 1);
  gfx.fillRect(ubx + r(3.3), baseY - r(3.0), r(2.0), r(1.5));

  // ── TORSO ROJO (con lean)
  gfx.fillStyle(0xcc2222, 1);
  gfx.fillRect(ubx - r(2.7), baseY - r(6.8), r(4.2), r(4.5));
  gfx.fillStyle(0xaa1111, 1);
  gfx.fillRect(ubx + r(0.7), baseY - r(6.8), r(0.8), r(4.5));
  gfx.fillStyle(0xdd3333, 1);
  gfx.fillRect(ubx - r(2.0), baseY - r(6.5), r(2.0), r(1.5));

  // ── CUELLO (con lean)
  gfx.fillStyle(0xcc2222, 1);
  gfx.fillRect(ubx - r(2.1), baseY - r(8.2), r(1.6), r(1.8));

  // ── CABEZA (con lean)
  const headX = ubx - r(1.3);
  const headY = baseY - r(10.4);

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