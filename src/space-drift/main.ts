import { World } from 'objecs';
import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Text,
  Texture,
  TextureSource,
  type Ticker,
} from 'pixi.js';
import shmupUrl from '../assets/shmup.png';
import {
  BOOST_FUEL_MAX,
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
import { actions, gamepadConnected, onPress, rumble } from './input.ts';
import { SPACE_COLOR, toHex } from './palette.ts';
import { initQueries } from './queries.ts';
import { initRender, renderFrame } from './render.ts';
import {
  getShip,
  particleSystem,
  pulseSystem,
  shipSystem,
} from './sim.ts';

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
  // Top row of the sheet (8x8): frame 1 = bank left, 2 = standard, 3 = bank right.
  const frame = (x: number) =>
    new Texture({ source: sheet.source, frame: new Rectangle(x, 0, 8, 8) });
  const shipTextures = {
    standard: frame(16),
    bankLeft: frame(8),
    bankRight: frame(24),
  };

  const world = new World<Entity>();
  createShip(world, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  populateWorld(world);
  initQueries(world);

  const state = initRender(app.renderer, shipTextures);
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

  // Boost fuel meter: a labelled bar that drains on boost and refills otherwise.
  const fuelLabel = new Text({
    text: 'boost',
    style: { fontFamily: 'monospace', fontSize: 12, fill: 0xffffff },
  });
  fuelLabel.position.set(6, 42);
  hud.addChild(fuelLabel);
  const FUEL_BAR_X = 52;
  const FUEL_BAR_Y = 44;
  const FUEL_BAR_W = 120;
  const FUEL_BAR_H = 10;
  const fuelBar = new Graphics();
  hud.addChild(fuelBar);

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
  // Manual rumble test (independent of boost) to sanity-check the hardware.
  onPress('v', () => rumble(400, 1, 1));

  let accumulator = 0;
  let boostHeldTime = 0;
  // Rumble state: a punchy kick on the boost edge, then a sustained buzz. Each
  // sustain pulse is longer than the refresh interval so pulses OVERLAP — the
  // motor never stops between them, which is what actually reads as continuous
  // rumble instead of an imperceptible stutter.
  let wasBoosting = false;
  let rumbleTimer = 0;
  const RUMBLE_REFRESH = 0.2; // seconds between sustain pulses
  const RUMBLE_PULSE_MS = 320; // pulse length (> refresh, so they overlap)

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

    const ship = getShip();

    // Shake ramps only while actually boosting (Z held AND fuel remaining).
    const boosting = ship.ship.boosting;
    boostHeldTime = boosting ? boostHeldTime + dt : 0;

    // Controller rumble: hard kick on the boost edge, then a lighter sustained
    // buzz re-issued periodically. A short empty-tank blip when boost cuts out.
    if (boosting) {
      if (!wasBoosting) {
        rumble(RUMBLE_PULSE_MS, 1, 1); // kick — both motors, full strength
        rumbleTimer = RUMBLE_REFRESH;
      } else {
        rumbleTimer -= dt;
        if (rumbleTimer <= 0) {
          rumble(RUMBLE_PULSE_MS, 0.9, 0.6); // sustain — overlaps the previous
          rumbleTimer = RUMBLE_REFRESH;
        }
      }
    } else if (wasBoosting) {
      if (ship.ship.fuel <= 0) rumble(140, 0.3, 0.8); // ran dry
      rumbleTimer = 0;
    }
    wasBoosting = boosting;

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

    const speed = Math.round(
      Math.sqrt(
        ship.velocity.x * ship.velocity.x + ship.velocity.y * ship.velocity.y,
      ),
    );
    fpsText.text = `fps ${Math.round(ticker.FPS)}`;
    spdText.text = `spd ${speed}`;

    // Fuel bar: fill scales with the tank; amber while boosting, cyan otherwise,
    // red when nearly empty. Filled width floored to whole pixels to stay crisp.
    const fuel = Math.max(0, Math.min(1, ship.ship.fuel / BOOST_FUEL_MAX));
    const fillColor = ship.ship.boosting
      ? 0xffa300
      : fuel < 0.25
        ? 0xff004d
        : 0x29adff;
    fuelBar.clear();
    fuelBar
      .rect(FUEL_BAR_X, FUEL_BAR_Y, FUEL_BAR_W, FUEL_BAR_H)
      .fill({ color: 0x1d2b53, alpha: 0.85 });
    if (fuel > 0) {
      fuelBar
        .rect(FUEL_BAR_X, FUEL_BAR_Y, Math.floor(FUEL_BAR_W * fuel), FUEL_BAR_H)
        .fill(fillColor);
    }
    fuelBar
      .rect(FUEL_BAR_X, FUEL_BAR_Y, FUEL_BAR_W, FUEL_BAR_H)
      .stroke({ width: 1, color: 0xc2c3c7, alpha: 0.8 });

    const pad = gamepadConnected() ? '   gamepad' : '';
    statusText.text = `interp ${box(interpolation)} [i]   subpix ${box(subpixel)} [p]   crt ${box(crt)} [c]   map ${box(minimap)} [m]   boost ${box(actions.boost())} [z]${pad}`;
  });
}

main();
