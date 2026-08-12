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
  HOMING_CHARGE_MAX,
  MAX_FRAME_TIME,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './constants.ts';
import { initEffects, setCrt, updateEffects } from './effects.ts';
import type { Entity } from './entity.ts';
import { createEnemy, createShip, populateWorld } from './factories.ts';
import { actions, gamepadConnected, onPress, rumble } from './input.ts';
import { SPACE_COLOR, toHex } from './palette.ts';
import { initQueries } from './queries.ts';
import { initRender, renderFrame } from './render.ts';
import {
  bulletSystem,
  enemySystem,
  getHomingCharge,
  getShip,
  homingSystem,
  particleSystem,
  pulseSystem,
  shipSystem,
  shootSystem,
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
  // 8x8 tiles addressed by (column, row) from the top-left of the sheet.
  const frameAt = (col: number, row: number) =>
    new Texture({
      source: sheet.source,
      frame: new Rectangle(col * 8, row * 8, 8, 8),
    });
  // Top row: col 1 = bank left, 2 = standard, 3 = bank right.
  const shipTextures = {
    standard: frameAt(2, 0),
    bankLeft: frameAt(1, 0),
    bankRight: frameAt(3, 0),
  };
  const bulletTexture = frameAt(6, 0); // shot: top-row frame 6
  const enemyTexture = frameAt(11, 8); // dummy enemy: tile (11,8)

  const world = new World<Entity>();
  createShip(world, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  createEnemy(world, WORLD_WIDTH / 2 + 70, WORLD_HEIGHT / 2 - 45);
  populateWorld(world);
  initQueries(world);

  const state = initRender(
    app.renderer,
    shipTextures,
    bulletTexture,
    enemyTexture,
  );
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

  const mkLabel = (text: string, y: number) => {
    const t = new Text({
      text,
      style: { fontFamily: 'monospace', fontSize: 12, fill: 0xffffff },
    });
    t.position.set(6, y);
    hud.addChild(t);
    return t;
  };

  // Homing charge meter: fills over HOMING_CHARGE_MAX with ticks at the tier
  // boundaries, and a "xN" count of the volley the current charge would fire.
  mkLabel('charge', 42);
  const CHARGE_BAR_X = 52;
  const CHARGE_BAR_Y = 44;
  const CHARGE_BAR_W = 120;
  const CHARGE_BAR_H = 6;
  const chargeBar = new Graphics();
  hud.addChild(chargeBar);
  const chargeCountText = new Text({
    text: '',
    style: { fontFamily: 'monospace', fontSize: 12, fill: 0xffec27 },
  });
  chargeCountText.position.set(CHARGE_BAR_X + CHARGE_BAR_W + 8, 42);
  hud.addChild(chargeCountText);

  // Boost fuel meter: a labelled bar that drains on boost and refills otherwise.
  mkLabel('boost', 58);
  const FUEL_BAR_X = 52;
  const FUEL_BAR_Y = 60;
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
      shootSystem(FIXED_DT);
      homingSystem(FIXED_DT);
      bulletSystem(FIXED_DT);
      enemySystem(FIXED_DT);
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
      dt,
    );

    const speed = Math.round(
      Math.sqrt(
        ship.velocity.x * ship.velocity.x + ship.velocity.y * ship.velocity.y,
      ),
    );
    fpsText.text = `fps ${Math.round(ticker.FPS)}`;
    spdText.text = `spd ${speed}`;

    // Charge bar: fills over the charge window with ticks at the tier lines, so
    // you can read the pending volley size (xN) without an enemy on screen.
    const charge = getHomingCharge();
    const chargeFrac = Math.min(1, charge.seconds / HOMING_CHARGE_MAX);
    const chargeColor =
      charge.count >= 8
        ? 0xff004d
        : charge.count >= 5
          ? 0xffa300
          : charge.count >= 3
            ? 0xffec27
            : 0x5f6773;
    chargeBar.clear();
    chargeBar
      .rect(CHARGE_BAR_X, CHARGE_BAR_Y, CHARGE_BAR_W, CHARGE_BAR_H)
      .fill({ color: 0x1d2b53, alpha: 0.85 });
    if (chargeFrac > 0) {
      chargeBar
        .rect(
          CHARGE_BAR_X,
          CHARGE_BAR_Y,
          Math.floor(CHARGE_BAR_W * chargeFrac),
          CHARGE_BAR_H,
        )
        .fill(chargeColor);
    }
    // Tier ticks at 1s and 2s (thirds of the window).
    for (const t of [1 / 3, 2 / 3]) {
      chargeBar
        .rect(CHARGE_BAR_X + Math.floor(CHARGE_BAR_W * t), CHARGE_BAR_Y - 1, 1, CHARGE_BAR_H + 2)
        .fill({ color: 0xc2c3c7, alpha: 0.9 });
    }
    chargeBar
      .rect(CHARGE_BAR_X, CHARGE_BAR_Y, CHARGE_BAR_W, CHARGE_BAR_H)
      .stroke({ width: 1, color: 0xc2c3c7, alpha: 0.8 });
    chargeCountText.text = charge.count > 0 ? `x${charge.count}` : '';

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
