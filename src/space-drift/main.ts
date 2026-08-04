import { World } from 'objecs';
import {
  Application,
  Assets,
  Container,
  Rectangle,
  Text,
  Texture,
  TextureSource,
  type Ticker,
} from 'pixi.js';
import shmupUrl from '../assets/shmup.png';
import {
  FIXED_DT,
  MAX_FRAME_TIME,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './constants.ts';
import { initEffects, setCrt, updateEffects } from './effects.ts';
import type { Entity } from './entity.ts';
import { createShip, populateWorld } from './factories.ts';
import { isDown, onPress } from './input.ts';
import { SPACE_COLOR, toHex } from './palette.ts';
import { initQueries } from './queries.ts';
import { initRender, renderFrame } from './render.ts';
import { getShip, particleSystem, pulseSystem, shipSystem } from './sim.ts';

async function main() {
  // Crisp pixels everywhere.
  TextureSource.defaultOptions.scaleMode = 'nearest';

  const app = new Application();
  await app.init({
    canvas: document.querySelector<HTMLCanvasElement>('#canvas')!,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    background: toHex(SPACE_COLOR),
    antialias: false,
    resolution: 1,
    preference: 'webgl',
  });

  const sheet: Texture = await Assets.load(shmupUrl);
  sheet.source.scaleMode = 'nearest';
  const shipTexture = new Texture({
    source: sheet.source,
    frame: new Rectangle(16, 0, 8, 8),
  });

  const world = new World<Entity>();
  createShip(world, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  populateWorld(world);
  initQueries(world);

  const state = initRender(app.renderer, shipTexture);
  initEffects();
  app.stage.addChild(state.scene);

  // HUD (inside the scene so the CRT pass covers it).
  const hud = new Container();
  state.scene.addChild(hud);
  const mkText = (y: number) => {
    const t = new Text({
      text: '',
      style: { fontFamily: 'monospace', fontSize: 14, fill: 0xffffff },
    });
    t.position.set(6, y);
    hud.addChild(t);
    return t;
  };
  const fpsText = mkText(4);
  const spdText = mkText(22);
  const statusText = new Text({
    text: '',
    style: { fontFamily: 'monospace', fontSize: 12, fill: 0xffffff },
  });
  statusText.position.set(6, WINDOW_HEIGHT - 20);
  hud.addChild(statusText);
  const box = (on: boolean) => (on ? '[x]' : '[ ]');

  let interpolation = true;
  let subpixel = true;
  let crt = false;
  let minimap = true;
  setCrt(state.scene, crt);

  onPress('i', () => (interpolation = !interpolation));
  onPress('p', () => (subpixel = !subpixel));
  onPress('c', () => {
    crt = !crt;
    setCrt(state.scene, crt);
  });
  onPress('m', () => (minimap = !minimap));

  let accumulator = 0;
  let boostHeldTime = 0;

  app.ticker.add((ticker: Ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_TIME);
    accumulator += dt;

    while (accumulator >= FIXED_DT) {
      shipSystem(FIXED_DT);
      particleSystem(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    pulseSystem(dt);
    updateEffects(dt);

    boostHeldTime = isDown('z') ? boostHeldTime + dt : 0;

    const alpha = interpolation ? accumulator / FIXED_DT : 1;
    renderFrame(
      app.renderer,
      state,
      interpolation,
      subpixel,
      minimap,
      boostHeldTime,
      alpha,
    );

    const ship = getShip();
    const speed = Math.round(
      Math.sqrt(
        ship.velocity.x * ship.velocity.x + ship.velocity.y * ship.velocity.y,
      ),
    );
    fpsText.text = `fps ${Math.round(ticker.FPS)}`;
    spdText.text = `spd ${speed}`;
    statusText.text = `interp ${box(interpolation)} [i]   subpix ${box(subpixel)} [p]   crt ${box(crt)} [c]   map ${box(minimap)} [m]   boost ${box(isDown('z'))} [z]`;
  });
}

main();
