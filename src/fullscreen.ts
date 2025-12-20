import { Keyboard } from 'contro';
import { Pane } from 'tweakpane';
import playerShipUrl from './assets/player-ship.png';
import { loadImage } from './lib/asset-loader.ts';
import { getResolution } from './lib/screen.ts';

const keyboard = new Keyboard();

// Controls
const controls = {
  thrust: keyboard.key('w'),
  brake: keyboard.key('s'),
  rotateLeft: keyboard.key('ArrowLeft'),
  rotateRight: keyboard.key('ArrowRight'),
};

const pane = new Pane();

const params = {
  speed: 120,
  rotationSpeed: 120,
  friction: 0.9,
  interpolation: true,
};

pane.addBinding(params, 'speed', { min: 0, max: 200, step: 1 });
pane.addBinding(params, 'rotationSpeed', {
  label: 'rot speed',
  min: 0,
  max: 360,
  step: 1,
});
pane.addBinding(params, 'friction', { min: 0, max: 0.99, step: 0.01 });
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

const player = {
  pos: {
    x: GAME_WIDTH / 2 - playerSprite.width / 2,
    y: GAME_HEIGHT / 2 - playerSprite.height / 2,
  },
  prevPos: {
    x: 0,
    y: 0,
  },
  vel: {
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

    // Handle thrust (in the direction the ship is facing)
    // Ship sprite points up, so 0 degrees = up = -Y
    const radians = (player.rotation - 90) * (Math.PI / 180);

    if (controls.thrust.query()) {
      player.vel.x += Math.cos(radians) * params.speed * dt;
      player.vel.y += Math.sin(radians) * params.speed * dt;
    }

    if (controls.brake.query()) {
      player.vel.x -= Math.cos(radians) * params.speed * 0.5 * dt;
      player.vel.y -= Math.sin(radians) * params.speed * 0.5 * dt;
    }

    // Apply friction (0 = frictionless, 1 = instant stop)
    // Frame-rate independent: friction = fraction of velocity lost per second
    const retention = Math.pow(1 - params.friction, dt);
    player.vel.x *= retention;
    player.vel.y *= retention;

    // Update position
    player.pos.x += player.vel.x * dt;
    player.pos.y += player.vel.y * dt;

    // Clamp to bounds
    if (player.pos.x < 0) {
      player.pos.x = 0;
      player.vel.x = 0;
    } else if (player.pos.x + player.sprite.width > GAME_WIDTH) {
      player.pos.x = GAME_WIDTH - player.sprite.width;
      player.vel.x = 0;
    }

    if (player.pos.y < 0) {
      player.pos.y = 0;
      player.vel.y = 0;
    } else if (player.pos.y + player.sprite.height > GAME_HEIGHT) {
      player.pos.y = GAME_HEIGHT - player.sprite.height;
      player.vel.y = 0;
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

  // Calculate sprite center in game coordinates
  const centerX = renderX + player.sprite.width / 2;
  const centerY = renderY + player.sprite.height / 2;

  // Scale to canvas coordinates
  const canvasCenterX = (centerX * GAME_SCALE) | 0;
  const canvasCenterY = (centerY * GAME_SCALE) | 0;

  ctx.save();

  // Translate to sprite center, rotate, then draw offset by half sprite size
  ctx.translate(canvasCenterX, canvasCenterY);
  ctx.rotate((renderRotation * Math.PI) / 180);
  ctx.scale(GAME_SCALE, GAME_SCALE);
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
