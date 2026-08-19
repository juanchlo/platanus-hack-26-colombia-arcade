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
function createTrack(scene) {
  scene.trackGraphics = scene.add.graphics();
  renderTrack(scene, 0); // Frame inicial
}

function renderTrack(scene, distance) {
  const gfx = scene.trackGraphics;
  gfx.clear();

  // Constantes isométricas rígidas (Sin punto de fuga)
  const m = 0.5; // Pendiente 2:1 (diagonal hacia abajo-derecha)
  const curbOffset = 50;  // Altura base del andén izquierdo
  const cliffOffset = 400; // Altura base del barranco derecho

  // Ecuaciones de rectas paralelas
  const curbY = (x) => x * m + curbOffset;
  const cliffY = (x) => x * m + cliffOffset;

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
      x: 0, y: 0, 
      jumping: false, jumpHeld: 0,
      pushing: false,
      alive: true,
      label: 'P1',
    },
    p2: {
      lat: 40, // Posición lateral (positivo es hacia el barranco derecho)
      x: 0, y: 0,
      jumping: false, jumpHeld: 0,
      pushing: false,
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
  if (p1.alive) drawBeerCrate(gfx, p1.x, p1.y, 3);
  if (p2.alive) drawBeerCrate(gfx, p2.x, p2.y, 3);
}

// ---------------------------------------------------------------------------
// Obstacles — huecos (small) and borrachos/botellas (large)
// ---------------------------------------------------------------------------
function createObstaclePool(scene) {
  // TODO: implement infinite obstacle generator
  scene.obstacles = [];
  scene.obstacleGraphics = scene.add.graphics();
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

  c.add(scene.add.text(W / 2, H - 28, 'P1: A/D mover   U saltar   I empujar     P2: ←/→ mover   R saltar   T empujar', {
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

  scene.players.p1.alive = true;
  scene.players.p2.alive = true;
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
  renderPlayers(scene);
}

function handlePlayerInput(scene, player, prefix, dt) {
  if (!player.alive) return;

  const latSpeed = 220; // Velocidad de esquive
  let dLat = 0;

  // Izquierda te mueve hacia el andén (arriba-derecha visualmente en la perpendicular)
  if (held[prefix + '_L']) dLat -= 1;
  // Derecha te mueve hacia el barranco (abajo-izquierda visualmente en la perpendicular)
  if (held[prefix + '_R']) dLat += 1;

  player.lat += dLat * latSpeed * dt;
  
  // Limitar para que no se salgan del asfalto matemáticamente
  player.lat = Phaser.Math.Clamp(player.lat, -85, 85);

  // Convertir la posición 'lat' en coordenadas de pantalla diagonales
  const baseX = W / 2; // 400
  const baseY = baseX * 0.5 + 225; // 425 (centro de la pista)
  
  // Ecuación perpendicular para moverse 3/4
  player.x = baseX + player.lat * (-2);
  player.y = baseY + player.lat * (1);

  // Lógica de Salto (se añadirá el eje Z después)
  if (held[prefix + '_1']) player.jumpHeld += dt;
  if (consumePressed(prefix + '_1')) {
    player.jumping = true;
  }
}

function resolvePlayerCollision(scene, p1, p2) {
  // Las colisiones ahora son 1D sobre el eje lateral
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
// Obstacles
// ---------------------------------------------------------------------------
function updateObstacles(scene, delta) {
  // TODO: spawn and scroll obstacles; check collisions with players
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
