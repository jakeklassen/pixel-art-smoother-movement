import { Pane } from 'tweakpane';
import playerShipUrl from './assets/player-ship.png';
import { loadImage } from './lib/asset-loader.ts';
import { getResolution } from './lib/screen.ts';

const pane = new Pane();

const params = {
  velocity: {
    x: 60,
    y: 30,
  },
  interpolation: true,
};

pane.addBinding(params, 'velocity', {
  min: 0,
  max: 200,
  step: 1,
});

pane.addBinding(params, 'interpolation');

const playerSprite = await loadImage(playerShipUrl);

const GAME_WIDTH = 128;
const GAME_HEIGHT = 128;

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

// Dynamic scale factor based on window size
let GAME_SCALE = 1;

const resize = () => {
  const { innerWidth, innerHeight } = window;
  const { width, height, factor } = getResolution(
    innerWidth,
    innerHeight,
    GAME_WIDTH,
    GAME_HEIGHT,
  );

  GAME_SCALE = factor;

  canvas.width = width;
  canvas.height = height;
  ctx.imageSmoothingEnabled = false;

  // Center the canvas
  canvas.style.left = `${innerWidth / 2 - width / 2}px`;
  canvas.style.top = `${innerHeight / 2 - height / 2}px`;
};

resize();
window.addEventListener('resize', resize);

const IDENTITY_MATRIX: DOMMatrix2DInit = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

const player = {
  pos: {
    x: GAME_WIDTH * 0.25 - playerSprite.width / 2,
    y: GAME_HEIGHT / 2 - playerSprite.height / 2,
  },
  prevPos: {
    x: 0,
    y: 0,
  },
  dir: {
    x: 1,
    y: 1,
  },
  vel: params.velocity,
  sprite: playerSprite as HTMLImageElement,
};

// Initialize prevPos to starting position
player.prevPos.x = player.pos.x;
player.prevPos.y = player.pos.y;

const TARGET_FPS = 60;
const STEP = 1000 / TARGET_FPS;
const dt = STEP / 1000;
let last = performance.now();
let deltaTimeAccumulator = 0;

function frame(hrt: DOMHighResTimeStamp) {
  deltaTimeAccumulator += Math.min(1000, hrt - last);

  // Store previous position before physics updates
  player.prevPos.x = player.pos.x;
  player.prevPos.y = player.pos.y;

  while (deltaTimeAccumulator >= STEP) {
    player.pos.x += player.vel.x * dt * player.dir.x;
    player.pos.y += player.vel.y * dt * player.dir.y;

    if (player.pos.x + player.sprite.width >= GAME_WIDTH) {
      player.pos.x = GAME_WIDTH - player.sprite.width;
      player.dir.x *= -1;
    } else if (player.pos.x <= 0) {
      player.pos.x = 0;
      player.dir.x *= -1;
    }

    if (player.pos.y + player.sprite.height >= GAME_HEIGHT) {
      player.pos.y = GAME_HEIGHT - player.sprite.height;
      player.dir.y *= -1;
    } else if (player.pos.y <= 0) {
      player.pos.y = 0;
      player.dir.y *= -1;
    }

    deltaTimeAccumulator -= STEP;
  }

  // Interpolate position for smooth rendering on high refresh rate displays
  let renderX: number;
  let renderY: number;

  if (params.interpolation) {
    const alpha = deltaTimeAccumulator / STEP;
    renderX = player.prevPos.x + (player.pos.x - player.prevPos.x) * alpha;
    renderY = player.prevPos.y + (player.pos.y - player.prevPos.y) * alpha;
  } else {
    renderX = player.pos.x;
    renderY = player.pos.y;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(IDENTITY_MATRIX);

  ctx.fillStyle = 'white';
  ctx.font = '10px Visitor';

  // Scale position to canvas coordinates at render time
  ctx.setTransform(
    GAME_SCALE,
    0,
    0,
    GAME_SCALE,
    (renderX * GAME_SCALE) | 0,
    (renderY * GAME_SCALE) | 0,
  );

  ctx.drawImage(player.sprite, 0, 0);

  ctx.setTransform(IDENTITY_MATRIX);

  last = hrt;
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
