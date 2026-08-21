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
  BOOST_SHAKE_AMP,
  BOOST_SHAKE_DELAY,
  BOOST_SHAKE_RAMP,
  LIGHT_DIR_X,
  LIGHT_DIR_Y,
  SCALE,
  STREAK_K,
  STREAK_MAX,
  STREAK_THRESHOLD,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from './constants.ts';
import { lerp, wrap } from './math.ts';
import { Pico8, toHex } from './palette.ts';
import {
  bullets,
  enemies,
  particles,
  planets,
  ships,
  stars,
} from './queries.ts';
import { getHomingCharge, getLockTarget } from './sim.ts';
import { snesMode, textureFor, type RotationSet } from './snes-mode.ts';

const DEG_TO_RAD = Math.PI / 180;
const STAR_WRAP_W = (GAME_WIDTH + 2) * SCALE;
const STAR_WRAP_H = (GAME_HEIGHT + 2) * SCALE;

// Minimap geometry, in game (low-res) pixels — drawn into its own buffer and
// blitted up ×SCALE, so it shares the pixel grid with the world.
const MINIMAP_RADIUS = 14;
const MINIMAP_MARGIN = 4;
const MINIMAP_D = MINIMAP_RADIUS * 2 + 1; // 29
const MINIMAP_ZOOM = 1 / 32; // minimap pixels per world pixel (~900px span)
const MINIMAP_TICK_SWEEP = 0.6; // heading-tick arc width, radians (~34°)

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

export type ShipTextures = {
  standard: Texture;
  bankLeft: Texture;
  bankRight: Texture;
};

export type RenderState = {
  scene: Container; // everything post-processed by CRT/bloom
  shipTextures: ShipTextures;
  bulletTexture: Texture;
  enemyTexture: Texture;
  worldRT: RenderTexture;
  worldContainer: Container;
  worldGfx: Graphics;
  entityLayer: Container; // bullets + enemies, drawn into the world RT
  spritePool: Sprite[]; // reused sprites for the entity layer
  reticleGfx: Graphics; // lock-on brackets + charge pips, drawn into the RT
  worldSprite: Sprite;
  starsGfx: Graphics;
  shipSprite: Sprite;
  bankFadeSprite: Sprite; // outgoing bank frame, cross-fading out over a swap
  lightSprite: Sprite;
  minimapRT: RenderTexture;
  minimapContent: Container;
  minimapGfx: Graphics;
  minimapSprite: Sprite;
  // SNES fidelity spike: pre-rendered rotation frames, one set per bank pose
  // and one each for the other rotating sprites. Undefined until installed.
  shipRotations?: {
    standard: RotationSet;
    bankLeft: RotationSet;
    bankRight: RotationSet;
  };
  enemyRotations?: RotationSet;
  bulletRotations?: RotationSet;
};

export function initRender(
  renderer: Renderer,
  shipTextures: ShipTextures,
  bulletTexture: Texture,
  enemyTexture: Texture,
): RenderState {
  const shipTexture = shipTextures.standard;
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
  // Bullets + enemies live above the planets/exhaust in the same low-res RT so
  // they share the pixel grid and camera. Sprites are pooled on demand.
  const entityLayer = new Container();
  worldContainer.addChild(entityLayer);
  const spritePool: Sprite[] = [];
  // Lock-on reticle sits above the entities, still inside the low-res RT.
  const reticleGfx = new Graphics();
  worldContainer.addChild(reticleGfx);
  const worldSprite = new Sprite(worldRT);
  worldSprite.scale.set(SCALE);
  scene.addChild(worldSprite);

  // Ship, pinned to the exact view center.
  const shipSprite = new Sprite(shipTexture);
  shipSprite.anchor.set(0.5);
  shipSprite.scale.set(SCALE);
  shipSprite.position.set(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2);
  scene.addChild(shipSprite);

  // Cross-fade layer: shows the outgoing frame on top of the ship and fades it
  // out over a few frames so a bank swap dissolves instead of popping.
  const bankFadeSprite = new Sprite(shipTexture);
  bankFadeSprite.anchor.set(0.5);
  bankFadeSprite.scale.set(SCALE);
  bankFadeSprite.position.set(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2);
  bankFadeSprite.visible = false;
  scene.addChild(bankFadeSprite);

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

  // Minimap: drawn into a low-res circular buffer, blitted ×SCALE, top-right.
  const minimapRT = RenderTexture.create({
    width: MINIMAP_D,
    height: MINIMAP_D,
  });
  minimapRT.source.scaleMode = 'nearest';
  const minimapGfx = new Graphics();
  const minimapContent = new Container();
  minimapContent.addChild(minimapGfx);
  // Circular clip so planet dots never spill outside the disc.
  const minimapMask = new Graphics()
    .circle(MINIMAP_RADIUS, MINIMAP_RADIUS, MINIMAP_RADIUS)
    .fill(0xffffff);
  minimapContent.addChild(minimapMask);
  minimapContent.mask = minimapMask;
  const minimapSprite = new Sprite(minimapRT);
  minimapSprite.scale.set(SCALE);
  minimapSprite.position.set(
    (GAME_WIDTH - MINIMAP_MARGIN - MINIMAP_D) * SCALE,
    MINIMAP_MARGIN * SCALE,
  );
  scene.addChild(minimapSprite);

  return {
    scene,
    shipTextures,
    bulletTexture,
    enemyTexture,
    worldRT,
    worldContainer,
    worldGfx,
    entityLayer,
    spritePool,
    reticleGfx,
    worldSprite,
    starsGfx,
    shipSprite,
    bankFadeSprite,
    lightSprite,
    minimapRT,
    minimapContent,
    minimapGfx,
    minimapSprite,
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

// Fetch (or lazily create) pooled sprite `i`, made visible for this frame.
function poolSprite(s: RenderState, i: number): Sprite {
  let sprite = s.spritePool[i];
  if (!sprite) {
    sprite = new Sprite();
    sprite.anchor.set(0.5);
    s.entityLayer.addChild(sprite);
    s.spritePool[i] = sprite;
  }
  sprite.visible = true;
  return sprite;
}

/** Place bullet + enemy sprites into the low-res world layer (whole pixels). */
function drawEntities(
  s: RenderState,
  flooredCamX: number,
  flooredCamY: number,
  interpolate: boolean,
  alpha: number,
) {
  let i = 0;

  for (const enemy of enemies.raw) {
    if (enemy.enemy.respawnTimer > 0) continue;
    let ex = enemy.transform.position.x;
    let ey = enemy.transform.position.y;
    let er = enemy.transform.rotation;
    if (interpolate) {
      ex = lerp(enemy.previous.position.x, ex, alpha);
      ey = lerp(enemy.previous.position.y, ey, alpha);
      er = lerp(enemy.previous.rotation, er, alpha);
    }
    const sprite = poolSprite(s, i++);
    const enemyFrame =
      s.enemyRotations === undefined
        ? undefined
        : textureFor(s.enemyRotations, er);
    sprite.texture = enemyFrame ?? s.enemyTexture;
    sprite.tint = 0xffffff;
    // Pre-rendered frames already carry the heading, so the sprite must not
    // also be rotated — that is the whole point of the constraint.
    sprite.rotation = enemyFrame === undefined ? er * DEG_TO_RAD : 0;
    // Hit flash reads as a quick scale pop (tint can't brighten a sprite).
    sprite.scale.set(enemy.enemy.hitFlash > 0 ? 1.4 : 1);
    sprite.position.set(
      Math.floor(ex) - flooredCamX,
      Math.floor(ey) - flooredCamY,
    );
  }

  for (const bullet of bullets.raw) {
    let bx = bullet.transform.position.x;
    let by = bullet.transform.position.y;
    let br = bullet.transform.rotation;
    if (interpolate) {
      bx = lerp(bullet.previous.position.x, bx, alpha);
      by = lerp(bullet.previous.position.y, by, alpha);
      br = lerp(bullet.previous.rotation, br, alpha);
    }
    const sprite = poolSprite(s, i++);
    const bulletFrame =
      s.bulletRotations === undefined
        ? undefined
        : textureFor(s.bulletRotations, br);
    sprite.texture = bulletFrame ?? s.bulletTexture;
    // Homing missiles read orange so they're distinct from the straight shots.
    // (On hardware this would be a palette swap, not a tint — see snesgine
    // docs/learning/03-sprites-oam.)
    sprite.tint = bullet.homing ? toHex(Pico8.orange) : 0xffffff;
    sprite.scale.set(1);
    sprite.rotation = bulletFrame === undefined ? br * DEG_TO_RAD : 0;
    sprite.position.set(
      Math.floor(bx) - flooredCamX,
      Math.floor(by) - flooredCamY,
    );
  }

  // Hide any sprites left over from a busier frame.
  for (; i < s.spritePool.length; i++) s.spritePool[i].visible = false;
}

let reticleAnim = 0;

/** Lock-on brackets around the targeted enemy, plus charge pips above it. */
function drawReticle(
  s: RenderState,
  flooredCamX: number,
  flooredCamY: number,
  dt: number,
) {
  const g = s.reticleGfx;
  g.clear();
  const target = getLockTarget();
  if (!target || !target.transform) return;

  reticleAnim += dt;
  const cx = Math.floor(target.transform.position.x) - flooredCamX;
  const cy = Math.floor(target.transform.position.y) - flooredCamY;
  const { charging } = getHomingCharge();

  // Brackets breathe by a pixel and glow orange while charging, red when idle.
  // (Charge level is shown on the HUD meter, not here.)
  const half = 6 + (Math.sin(reticleAnim * 7) > 0.4 ? 1 : 0);
  const arm = 2;
  const color = charging ? toHex(Pico8.orange) : toHex(Pico8.red);
  const corner = (px: number, py: number, dx: number, dy: number) => {
    g.rect(dx < 0 ? px : px - arm + 1, py, arm, 1).fill(color);
    g.rect(px, dy < 0 ? py : py - arm + 1, 1, arm).fill(color);
  };
  corner(cx - half, cy - half, -1, -1);
  corner(cx + half, cy - half, 1, -1);
  corner(cx - half, cy + half, -1, 1);
  corner(cx + half, cy + half, 1, 1);
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

// A circular, ship-centred minimap: planets as dots, the ship as the single
// white centre pixel, and a compass tick on the rim for heading. Drawn at
// low-res into minimapGfx (blitted ×SCALE by minimapSprite).
function drawMinimap(
  s: RenderState,
  shipX: number,
  shipY: number,
  rotationDeg: number,
) {
  const g = s.minimapGfx;
  const r = MINIMAP_RADIUS;
  const zoom = MINIMAP_ZOOM;
  g.clear();

  // Backdrop lifted just above the space colour so the disc reads as a panel.
  g.circle(r, r, r).fill({ color: toHex(Pico8.darkBlue, 0.45), alpha: 0.85 });

  for (const planet of planets.raw) {
    const pl = planet.planet;
    const dx = (planet.transform.position.x - shipX) * zoom;
    const dy = (planet.transform.position.y - shipY) * zoom;
    const dotR = Math.max(1, pl.radius * zoom);
    if (dx * dx + dy * dy > (r + dotR) * (r + dotR)) continue;

    // Floored to whole minimap pixels, matching the low-res world pass.
    const ax = Math.floor(r + dx);
    const ay = Math.floor(r + dy);
    g.circle(ax, ay, dotR).fill(toHex(pl.base));
    if (dotR > 1.5) {
      g.circle(
        ax + LIGHT_DIR_X * dotR * 0.4,
        ay + LIGHT_DIR_Y * dotR * 0.4,
        Math.max(1, dotR * 0.35),
      ).fill(toHex(pl.light));
    }
  }

  // Enemies: a red blip each (radar contact), clamped to the rim if off-disc.
  for (const enemy of enemies.raw) {
    if (enemy.enemy.respawnTimer > 0) continue;
    let dx = (enemy.transform.position.x - shipX) * zoom;
    let dy = (enemy.transform.position.y - shipY) * zoom;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const max = r - 1;
    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }
    g.rect(Math.floor(r + dx), Math.floor(r + dy), 1, 1).fill(toHex(Pico8.red));
  }

  // The ship: the only white pixel on the map.
  g.rect(r, r, 1, 1).fill(toHex(Pico8.white));

  // Heading reads as a compass tick riding the rim, not a vector out of the pip.
  const rad = rotationDeg * DEG_TO_RAD;
  const headingAngle = Math.atan2(-Math.cos(rad), Math.sin(rad));
  const tickR = r - 1;
  const startA = headingAngle - MINIMAP_TICK_SWEEP / 2;
  const endA = headingAngle + MINIMAP_TICK_SWEEP / 2;
  // moveTo the arc's start first: Pixi's Graphics accumulates one path, and
  // arc() otherwise draws a leader line from the previous point (the ship pixel
  // at the centre) to the arc start — a spurious radius that swings with heading.
  g.moveTo(r + tickR * Math.cos(startA), r + tickR * Math.sin(startA));
  g.arc(r, r, tickR, startA, endA).stroke({
    width: 2,
    color: toHex(Pico8.blue),
  });

  // Rim.
  g.circle(r, r, r - 0.5).stroke({
    width: 1,
    color: toHex(Pico8.lavender, 0.8),
  });
}

// Bank-sprite state, smoothed to avoid flicker. `bankTurn` is an EMA of the
// per-step turn rate (a raw stick settles with tiny alternating deltas that
// would otherwise flip the sprite every frame); `bankState` latches the chosen
// bank with hysteresis so it only engages on a clear turn and only releases
// once the turn has clearly stopped.
let bankTurn = 0;
let bankState = 0; // -1 left, 0 level, 1 right
const BANK_SMOOTH = 0.15; // EMA weight for the new sample (heavier smoothing)
const BANK_ENTER = 1.3; // deg/step (of ~3.5 max) to start banking
const BANK_EXIT = 0.4; // deg/step to return to level

// Cross-fade the outgoing frame out over BANK_FADE seconds on each swap.
let bankFade = 0; // remaining fade, 0..1
const BANK_FADE = 0.09; // seconds

export function renderFrame(
  renderer: Renderer,
  s: RenderState,
  interpolate: boolean,
  subpixel: boolean,
  minimap: boolean,
  boostHeldTime: number,
  alpha: number,
  dt: number,
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

  // Camera stays smooth — shake is applied to the whole frame below.
  const camX = shipX - GAME_WIDTH / 2;
  const camY = shipY - GAME_HEIGHT / 2;

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

  drawWorld(
    s,
    flooredCamX,
    flooredCamY,
    viewLeft,
    viewTop,
    viewRight,
    viewBottom,
  );
  drawEntities(s, flooredCamX, flooredCamY, interpolate, alpha);
  drawReticle(s, flooredCamX, flooredCamY, dt);
  renderer.render({
    container: s.worldContainer,
    target: s.worldRT,
    clear: true,
  });

  drawStars(s, camX, camY, subpixel, ship.velocity.x, ship.velocity.y);

  s.worldSprite.position.set(blitX, blitY);
  s.shipSprite.rotation = shipRot * DEG_TO_RAD;
  // Bank sprite follows the actual turn taken this step, so it works the same
  // for keys, D-pad, and analog stick-aim: rotation increasing = clockwise =
  // bank right. Smoothed + hysteresis so a settled stick doesn't flicker it.
  const turnDelta = ship.transform.rotation - ship.previous.rotation;
  bankTurn = bankTurn * (1 - BANK_SMOOTH) + turnDelta * BANK_SMOOTH;
  if (bankTurn > BANK_ENTER) bankState = 1;
  else if (bankTurn < -BANK_ENTER) bankState = -1;
  else if (Math.abs(bankTurn) < BANK_EXIT) bankState = 0;
  // SNES fidelity spike: when active, the ship's heading comes from a
  // pre-rendered frame instead of a live rotation, and the bank cross-fade is
  // gone — there is no per-sprite alpha on the hardware, so a bank change can
  // only ever be a hard swap.
  const shipSet =
    s.shipRotations === undefined
      ? undefined
      : bankState < 0
        ? s.shipRotations.bankLeft
        : bankState > 0
          ? s.shipRotations.bankRight
          : s.shipRotations.standard;
  const shipFrame =
    shipSet === undefined ? undefined : textureFor(shipSet, shipRot);

  if (shipFrame !== undefined) {
    s.shipSprite.rotation = 0;
    s.shipSprite.texture = shipFrame;
    s.bankFadeSprite.visible = false;
    bankFade = 0;
  } else {
    const nextTexture =
      bankState < 0
        ? s.shipTextures.bankLeft
        : bankState > 0
          ? s.shipTextures.bankRight
          : s.shipTextures.standard;
    // On a swap, park the outgoing frame on the fade layer and dissolve it out
    // so the change reads as a soft cross-fade rather than an abrupt pop.
    if (nextTexture !== s.shipSprite.texture) {
      s.bankFadeSprite.texture = s.shipSprite.texture;
      bankFade = 1;
      s.shipSprite.texture = nextTexture;
    }
    bankFade = Math.max(0, bankFade - dt / BANK_FADE);
    s.bankFadeSprite.visible = bankFade > 0;
    s.bankFadeSprite.alpha = bankFade;
    s.bankFadeSprite.rotation = s.shipSprite.rotation;
  }
  // Per-sprite additive tint has no hardware equivalent; on the SNES this would
  // be a palette swap. Hidden in SNES mode so the comparison stays honest.
  if (snesMode.enabled) {
    s.lightSprite.visible = false;
  } else {
    updatePlanetLight(s, shipX, shipY, shipRot);
  }

  s.minimapSprite.visible = minimap;
  if (minimap) {
    drawMinimap(s, shipX, shipY, shipRot);
    renderer.render({
      container: s.minimapContent,
      target: s.minimapRT,
      clear: true,
    });
  }

  // Whole-frame screen shake (shmup-style): translate the entire scene by a
  // whole-pixel random offset — everything, ship included, shakes together.
  // Kicks in 250ms into boost, eases up, and holds while boost is held.
  let shakeAmp = 0;
  if (boostHeldTime > BOOST_SHAKE_DELAY) {
    const ease = Math.min(
      (boostHeldTime - BOOST_SHAKE_DELAY) / BOOST_SHAKE_RAMP,
      1,
    );
    shakeAmp = BOOST_SHAKE_AMP * ease;
  }
  // Rounded to whole screen pixels so the pixel-perfect grid stays crisp.
  s.scene.position.set(
    Math.round((Math.random() * 2 - 1) * shakeAmp * SCALE),
    Math.round((Math.random() * 2 - 1) * shakeAmp * SCALE),
  );
}
