import {
  ColorMatrixFilter,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  Texture,
  type Renderer,
} from 'pixi.js';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  LIGHT_DIR_X,
  LIGHT_DIR_Y,
  SCALE,
  SHAKE_MAX,
  SHAKE_THRESHOLD,
  STREAK_K,
  STREAK_MAX,
  STREAK_THRESHOLD,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from './constants.ts';
import { lerp, wrap } from './math.ts';
import { Pico8, toHex } from './palette.ts';
import { particles, planets, ships, stars } from './queries.ts';

const DEG_TO_RAD = Math.PI / 180;
const STAR_WRAP_W = (GAME_WIDTH + 2) * SCALE;
const STAR_WRAP_H = (GAME_HEIGHT + 2) * SCALE;

// Precomputed particle ramp colors (stepped, to stay "pixely").
const FLAME = [
  toHex(Pico8.yellow),
  toHex(Pico8.orange),
  toHex(Pico8.red),
  toHex(Pico8.darkPurple),
];
const SMOKE = [
  toHex(Pico8.lightGray),
  toHex(Pico8.darkGray),
  toHex(Pico8.darkBlue),
];

function flameColor(t: number): number {
  if (t > 0.75) return FLAME[0];
  if (t > 0.5) return FLAME[1];
  if (t > 0.25) return FLAME[2];
  return FLAME[3];
}
function smokeColor(t: number): number {
  if (t > 0.6) return SMOKE[0];
  if (t > 0.3) return SMOKE[1];
  return SMOKE[2];
}

export type RenderState = {
  scene: Container; // everything post-processed by CRT/bloom
  worldRT: RenderTexture;
  worldContainer: Container;
  worldGfx: Graphics;
  worldSprite: Sprite;
  starsGfx: Graphics;
  shipSprite: Sprite;
  lightSprite: Sprite;
};

export function initRender(
  renderer: Renderer,
  shipTexture: Texture,
): RenderState {
  const scene = new Container();

  // Parallax stars (screen space), behind the world.
  const starsGfx = new Graphics();
  scene.addChild(starsGfx);

  // Low-res world (planets + exhaust) → render texture, blitted up crisply.
  const worldRT = RenderTexture.create({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  });
  worldRT.source.scaleMode = 'nearest';
  const worldGfx = new Graphics();
  const worldContainer = new Container();
  worldContainer.addChild(worldGfx);
  const worldSprite = new Sprite(worldRT);
  worldSprite.scale.set(SCALE);
  scene.addChild(worldSprite);

  // Ship, pinned to the exact view center.
  const shipSprite = new Sprite(shipTexture);
  shipSprite.anchor.set(0.5);
  shipSprite.scale.set(SCALE);
  shipSprite.position.set(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2);
  scene.addChild(shipSprite);

  // Planet light: a white silhouette of the ship, tinted per-frame and added
  // over the hull so a planet's hue washes the whole silhouette.
  const whiteRT = RenderTexture.create({
    width: shipTexture.frame.width,
    height: shipTexture.frame.height,
  });
  whiteRT.source.scaleMode = 'nearest';
  const whiten = new Sprite(shipTexture);
  const cm = new ColorMatrixFilter();
  cm.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];
  whiten.filters = [cm];
  renderer.render({ container: whiten, target: whiteRT, clear: true });

  const lightSprite = new Sprite(whiteRT);
  lightSprite.anchor.set(0.5);
  lightSprite.scale.set(SCALE);
  lightSprite.blendMode = 'add';
  lightSprite.visible = false;
  scene.addChild(lightSprite);

  return {
    scene,
    worldRT,
    worldContainer,
    worldGfx,
    worldSprite,
    starsGfx,
    shipSprite,
    lightSprite,
  };
}

function drawWorld(
  s: RenderState,
  flooredCamX: number,
  flooredCamY: number,
  viewLeft: number,
  viewTop: number,
  viewRight: number,
  viewBottom: number,
) {
  const g = s.worldGfx;
  g.clear();

  for (const planet of planets.raw) {
    const p = planet.transform.position;
    const pl = planet.planet;
    const r = pl.radius;
    if (
      p.x < viewLeft - r - 4 ||
      p.x > viewRight + r + 4 ||
      p.y < viewTop - r - 4 ||
      p.y > viewBottom + r + 4
    ) {
      continue;
    }
    const cx = Math.floor(p.x) - flooredCamX;
    const cy = Math.floor(p.y) - flooredCamY;
    const pulse = 0.5 + 0.5 * Math.sin(planet.pulse.time);

    g.circle(cx, cy, r + 2 + pulse).fill({
      color: toHex(pl.light),
      alpha: 0.05 + 0.05 * pulse,
    });
    g.circle(cx, cy, r).fill(toHex(pl.dark));
    g.circle(
      cx + LIGHT_DIR_X * r * 0.18,
      cy + LIGHT_DIR_Y * r * 0.18,
      r * 0.92,
    ).fill(toHex(pl.base));
    g.circle(
      cx + LIGHT_DIR_X * r * 0.4,
      cy + LIGHT_DIR_Y * r * 0.4,
      r * 0.5,
    ).fill(toHex(pl.light));
    g.circle(
      cx + LIGHT_DIR_X * r * 0.55,
      cy + LIGHT_DIR_Y * r * 0.55,
      Math.max(1, r * 0.14),
    ).fill({ color: 0xffffff, alpha: 0.9 });
  }

  for (const particle of particles.raw) {
    const pos = particle.transform.position;
    if (
      pos.x < viewLeft - 2 ||
      pos.x > viewRight + 2 ||
      pos.y < viewTop - 2 ||
      pos.y > viewBottom + 2
    ) {
      continue;
    }
    const t = 1 - particle.particle.age / particle.particle.maxAge;
    const color =
      particle.particle.kind === 'smoke' ? smokeColor(t) : flameColor(t);
    g.rect(
      Math.floor(pos.x) - flooredCamX,
      Math.floor(pos.y) - flooredCamY,
      particle.particle.size,
      particle.particle.size,
    ).fill(color);
  }
}

function drawStars(
  s: RenderState,
  camX: number,
  camY: number,
  subpixel: boolean,
  velX: number,
  velY: number,
) {
  const g = s.starsGfx;
  g.clear();

  const speed = Math.sqrt(velX * velX + velY * velY);
  const streaking = speed > STREAK_THRESHOLD;
  const dirX = streaking ? velX / speed : 0;
  const dirY = streaking ? velY / speed : 0;
  const baseLen = streaking
    ? Math.min((speed - STREAK_THRESHOLD) * STREAK_K, STREAK_MAX)
    : 0;

  for (const star of stars.raw) {
    const st = star.star;
    const worldX = star.transform.position.x - camX * st.depth;
    const worldY = star.transform.position.y - camY * st.depth;
    const rawX = subpixel
      ? Math.floor(worldX * SCALE)
      : Math.floor(worldX) * SCALE;
    const rawY = subpixel
      ? Math.floor(worldY * SCALE)
      : Math.floor(worldY) * SCALE;
    const sx = wrap(rawX, STAR_WRAP_W) - SCALE;
    const sy = wrap(rawY, STAR_WRAP_H) - SCALE;

    const brightness =
      1 - star.pulse.amplitude * (0.5 + 0.5 * Math.sin(star.pulse.time));
    const hex = toHex(st.color, brightness);
    const size = st.size * SCALE;

    if (streaking) {
      const len = baseLen * st.depth * SCALE;
      const cx = sx + size * 0.5;
      const cy = sy + size * 0.5;
      g.moveTo(cx, cy)
        .lineTo(cx + dirX * len, cy + dirY * len)
        .stroke({ width: size, color: hex, cap: 'butt' });
    } else {
      g.rect(sx, sy, size, size).fill(hex);
    }
  }
}

function updatePlanetLight(
  s: RenderState,
  shipX: number,
  shipY: number,
  rotationDeg: number,
) {
  let r = 0;
  let g = 0;
  let b = 0;
  let dirX = 0;
  let dirY = 0;
  let total = 0;

  for (const planet of planets.raw) {
    const pl = planet.planet;
    const dx = planet.transform.position.x - shipX;
    const dy = planet.transform.position.y - shipY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const range = pl.radius * 5 + 30;
    const surface = dist - pl.radius;
    if (surface >= range) continue;
    let i = 1 - surface / range;
    if (i <= 0) continue;
    i = i * i;
    r += pl.base[0] * i;
    g += pl.base[1] * i;
    b += pl.base[2] * i;
    const inv = i / Math.max(dist, 0.001);
    dirX += dx * inv;
    dirY += dy * inv;
    total += i;
  }

  if (total <= 0) {
    s.lightSprite.visible = false;
    return;
  }

  const dlen = Math.sqrt(dirX * dirX + dirY * dirY);
  let ox = 0;
  let oy = 0;
  if (dlen > 0) {
    const push = SCALE * 0.5 * Math.min(total, 1);
    ox = (dirX / dlen) * push;
    oy = (dirY / dlen) * push;
  }

  s.lightSprite.visible = true;
  s.lightSprite.tint = toHex([Math.min(r, 1), Math.min(g, 1), Math.min(b, 1)]);
  s.lightSprite.alpha = Math.min(total, 1) * 0.6;
  s.lightSprite.rotation = rotationDeg * DEG_TO_RAD;
  s.lightSprite.position.set(WINDOW_WIDTH / 2 + ox, WINDOW_HEIGHT / 2 + oy);
}

export function renderFrame(
  renderer: Renderer,
  s: RenderState,
  interpolate: boolean,
  subpixel: boolean,
  alpha: number,
) {
  const ship = ships.raw[0];

  let shipX = ship.transform.position.x;
  let shipY = ship.transform.position.y;
  let shipRot = ship.transform.rotation;
  if (interpolate) {
    shipX = lerp(ship.previous.position.x, shipX, alpha);
    shipY = lerp(ship.previous.position.y, shipY, alpha);
    shipRot = lerp(ship.previous.rotation, shipRot, alpha);
  }

  let camX = shipX - GAME_WIDTH / 2;
  let camY = shipY - GAME_HEIGHT / 2;

  const speed = Math.sqrt(
    ship.velocity.x * ship.velocity.x + ship.velocity.y * ship.velocity.y,
  );
  if (speed > SHAKE_THRESHOLD) {
    const amp = Math.min((speed - SHAKE_THRESHOLD) / 300, 1) * SHAKE_MAX;
    camX += (Math.random() * 2 - 1) * amp;
    camY += (Math.random() * 2 - 1) * amp;
  }

  const flooredCamX = Math.floor(camX);
  const flooredCamY = Math.floor(camY);
  const fracX = subpixel ? camX - flooredCamX : 0;
  const fracY = subpixel ? camY - flooredCamY : 0;
  const blitX = -Math.round(fracX * SCALE);
  const blitY = -Math.round(fracY * SCALE);

  const viewLeft = flooredCamX;
  const viewTop = flooredCamY;
  const viewRight = flooredCamX + GAME_WIDTH + 1;
  const viewBottom = flooredCamY + GAME_HEIGHT + 1;

  drawWorld(s, flooredCamX, flooredCamY, viewLeft, viewTop, viewRight, viewBottom);
  renderer.render({ container: s.worldContainer, target: s.worldRT, clear: true });

  drawStars(s, camX, camY, subpixel, ship.velocity.x, ship.velocity.y);

  s.worldSprite.position.set(blitX, blitY);
  s.shipSprite.rotation = shipRot * DEG_TO_RAD;
  updatePlanetLight(s, shipX, shipY, shipRot);
}
