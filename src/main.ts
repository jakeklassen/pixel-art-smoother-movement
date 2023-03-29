import playerShipUrl from './assets/player-ship.png';
import { loadImage } from './lib/asset-loader.ts';

const playerSprite = await loadImage(playerShipUrl);

// Game running at 4x scale of the game assets (128x128)
{
  const scaleByFactor = (factor: number) => (value: number) => value * factor;

  const GAME_WIDTH = 128;
  const GAME_HEIGHT = 128;
  const CANVAS_WIDTH = GAME_WIDTH * 4;
  const CANVAS_HEIGHT = GAME_HEIGHT * 4;
  const GAME_SCALE = CANVAS_WIDTH / GAME_WIDTH;

  const scale4x = scaleByFactor(GAME_SCALE);

  const canvas = document.querySelector<HTMLCanvasElement>('#canvas-4x')!;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  ctx.imageSmoothingEnabled = false;
  canvas.style.width = `${CANVAS_WIDTH}px`;
  canvas.style.height = `${CANVAS_HEIGHT}px`;

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
      x: canvas.width * 0.25 - scale4x(playerSprite.width) / 2,
      y: canvas.height / 2 - scale4x(playerSprite.height) / 2,
    },
    dir: {
      x: 1,
      y: 1,
    },
    vel: {
      x: 60,
      y: 30,
    },
    sprite: playerSprite as HTMLImageElement,
  };

  const TARGET_FPS = 60;
  const STEP = 1000 / TARGET_FPS;
  const dt = STEP / 1000;
  let last = performance.now();
  let deltaTimeAccumulator = 0;

  function frame(hrt: DOMHighResTimeStamp) {
    deltaTimeAccumulator += Math.min(1000, hrt - last);

    while (deltaTimeAccumulator >= STEP) {
      player.pos.x += scale4x(player.vel.x) * dt * player.dir.x;
      player.pos.y += scale4x(player.vel.y) * dt * player.dir.y;

      if (player.pos.x + scale4x(player.sprite.width) >= CANVAS_WIDTH) {
        player.pos.x = CANVAS_WIDTH - scale4x(player.sprite.width);
        player.dir.x *= -1;
      } else if (player.pos.x <= 0) {
        player.pos.x = 0;
        player.dir.x *= -1;
      }

      if (player.pos.y + scale4x(player.sprite.height) >= CANVAS_HEIGHT) {
        player.pos.y = CANVAS_HEIGHT - scale4x(player.sprite.height);
        player.dir.y *= -1;
      } else if (player.pos.y <= 0) {
        player.pos.y = 0;
        player.dir.y *= -1;
      }

      deltaTimeAccumulator -= STEP;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(IDENTITY_MATRIX);

    ctx.fillStyle = 'white';
    ctx.font = '10px Visitor';

    ctx.setTransform(
      GAME_SCALE,
      0,
      0,
      GAME_SCALE,
      player.pos.x | 0,
      player.pos.y | 0,
    );

    ctx.drawImage(player.sprite, 0, 0);

    ctx.setTransform(IDENTITY_MATRIX);

    last = hrt;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// Game scaled via CSS only
{
  const GAME_WIDTH = 128;
  const GAME_HEIGHT = 128;

  const canvas = document.querySelector<HTMLCanvasElement>('#canvas-scaled')!;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  canvas.width = GAME_WIDTH;
  canvas.height = GAME_HEIGHT;
  ctx.imageSmoothingEnabled = false;
  canvas.style.width = `${GAME_WIDTH * 4}px`;
  canvas.style.height = `${GAME_HEIGHT * 4}px`;

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
      x: canvas.width * 0.25 - playerSprite.width / 2,
      y: canvas.height / 2 - playerSprite.height / 2,
    },
    dir: {
      x: 1,
      y: 1,
    },
    vel: {
      x: 60,
      y: 30,
    },
    sprite: playerSprite as HTMLImageElement,
  };

  const TARGET_FPS = 60;
  const STEP = 1000 / TARGET_FPS;
  const dt = STEP / 1000;
  let last = performance.now();
  let deltaTimeAccumulator = 0;

  function frame(hrt: DOMHighResTimeStamp) {
    deltaTimeAccumulator += Math.min(1000, hrt - last);

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

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(IDENTITY_MATRIX);

    ctx.fillStyle = 'white';
    ctx.font = '10px Visitor';

    ctx.setTransform(1, 0, 0, 1, player.pos.x | 0, player.pos.y | 0);

    ctx.drawImage(player.sprite, 0, 0);

    ctx.setTransform(IDENTITY_MATRIX);

    last = hrt;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
