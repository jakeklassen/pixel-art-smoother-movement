import { Keyboard } from 'contro';
import { Pane } from 'tweakpane';
import playerShipUrl from './assets/player-ship.png';
import { loadImage } from './lib/asset-loader.ts';
import { getResolution } from './lib/screen.ts';

const keyboard = new Keyboard();

// Controls - shmup style directional movement
const controls = {
  up: keyboard.key('w'),
  down: keyboard.key('s'),
  left: keyboard.key('a'),
  right: keyboard.key('d'),
  rotateLeft: keyboard.key('ArrowLeft'),
  rotateRight: keyboard.key('ArrowRight'),
};

const pane = new Pane();

const params = {
  speed: 60,
  rotationSpeed: 120,
  interpolation: true,
};

pane.addBinding(params, 'speed', { min: 10, max: 200, step: 1 });
pane.addBinding(params, 'rotationSpeed', {
  label: 'rot speed',
  min: 0,
  max: 360,
  step: 1,
});
pane.addBinding(params, 'interpolation');

const playerSprite = await loadImage(playerShipUrl);

const GAME_WIDTH = 128;
const GAME_HEIGHT = 128;

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

// Canvas stays at native resolution, scaled via CSS transform
canvas.width = GAME_WIDTH;
canvas.height = GAME_HEIGHT;
ctx.imageSmoothingEnabled = false;

const resize = () => {
  const { innerWidth, innerHeight } = window;
  const { factor } = getResolution(
    innerWidth,
    innerHeight,
    GAME_WIDTH,
    GAME_HEIGHT,
  );

  // Scale via CSS transform
  canvas.style.transform = `scale(${factor})`;
  canvas.style.transformOrigin = 'top left';
  canvas.style.left = `${innerWidth / 2 - (GAME_WIDTH * factor) / 2}px`;
  canvas.style.top = `${innerHeight / 2 - (GAME_HEIGHT * factor) / 2}px`;
};

resize();
window.addEventListener('resize', resize);

const player = {
  pos: {
    x: GAME_WIDTH / 2 - playerSprite.width / 2,
    y: GAME_HEIGHT / 2 - playerSprite.height / 2,
  },
  prevPos: {
    x: 0,
    y: 0,
  },
  dir: {
    x: 0,
    y: 0,
  },
  rotation: 0,
  prevRotation: 0,
  sprite: playerSprite as HTMLImageElement,
};

// Initialize previous state
player.prevPos.x = player.pos.x;
player.prevPos.y = player.pos.y;
player.prevRotation = player.rotation;

const TARGET_FPS = 60;
const STEP = 1000 / TARGET_FPS;
const dt = STEP / 1000;
let last = performance.now();
let deltaTimeAccumulator = 0;

function frame(hrt: DOMHighResTimeStamp) {
  deltaTimeAccumulator += Math.min(1000, hrt - last);

  // Store previous state before physics updates
  player.prevPos.x = player.pos.x;
  player.prevPos.y = player.pos.y;
  player.prevRotation = player.rotation;

  while (deltaTimeAccumulator >= STEP) {
    // Handle rotation
    if (controls.rotateLeft.query()) {
      player.rotation -= params.rotationSpeed * dt;
    }
    if (controls.rotateRight.query()) {
      player.rotation += params.rotationSpeed * dt;
    }

    // Shmup-style instant directional movement
    // Reset direction each frame
    player.dir.x = 0;
    player.dir.y = 0;

    if (controls.left.query()) player.dir.x = -1;
    if (controls.right.query()) player.dir.x = 1;
    if (controls.up.query()) player.dir.y = -1;
    if (controls.down.query()) player.dir.y = 1;

    // Update position - constant velocity, instant start/stop
    player.pos.x += params.speed * player.dir.x * dt;
    player.pos.y += params.speed * player.dir.y * dt;

    // Clamp to bounds
    if (player.pos.x < 0) {
      player.pos.x = 0;
    } else if (player.pos.x + player.sprite.width > GAME_WIDTH) {
      player.pos.x = GAME_WIDTH - player.sprite.width;
    }

    if (player.pos.y < 0) {
      player.pos.y = 0;
    } else if (player.pos.y + player.sprite.height > GAME_HEIGHT) {
      player.pos.y = GAME_HEIGHT - player.sprite.height;
    }

    deltaTimeAccumulator -= STEP;
  }

  // Interpolate for smooth rendering on high refresh rate displays
  let renderX: number;
  let renderY: number;
  let renderRotation: number;

  if (params.interpolation) {
    const alpha = deltaTimeAccumulator / STEP;
    renderX = player.prevPos.x + (player.pos.x - player.prevPos.x) * alpha;
    renderY = player.prevPos.y + (player.pos.y - player.prevPos.y) * alpha;
    renderRotation =
      player.prevRotation + (player.rotation - player.prevRotation) * alpha;
  } else {
    renderX = player.pos.x;
    renderY = player.pos.y;
    renderRotation = player.rotation;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Calculate sprite center in game coordinates (no scaling - native resolution)
  const centerX = (renderX + player.sprite.width / 2) | 0;
  const centerY = (renderY + player.sprite.height / 2) | 0;

  ctx.save();

  // Translate to sprite center, rotate, then draw offset by half sprite size
  ctx.translate(centerX, centerY);
  ctx.rotate((renderRotation * Math.PI) / 180);
  ctx.drawImage(
    player.sprite,
    -player.sprite.width / 2,
    -player.sprite.height / 2,
  );

  ctx.restore();

  last = hrt;
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
