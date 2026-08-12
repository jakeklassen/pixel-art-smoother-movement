import {
  BOOST_DASH_COST,
  BOOST_DASH_IMPULSE,
  BOOST_DRAIN,
  BOOST_FUEL_MAX,
  BOOST_REFILL,
  BULLET_RADIUS,
  BULLET_SPEED,
  ENEMY_HEALTH,
  ENEMY_HIT_FLASH,
  ENEMY_PATROL_RADIUS,
  ENEMY_RADIUS,
  ENEMY_REPATH_TIME,
  ENEMY_RESPAWN_DELAY,
  ENEMY_SEPARATION,
  ENEMY_SEPARATION_FORCE,
  ENEMY_SIGHT_LOSE_MARGIN,
  ENEMY_STANDOFF,
  ENEMY_THRUST,
  ENEMY_WAYPOINT_REACHED,
  GAME_HEIGHT,
  GAME_WIDTH,
  HOMING_CHARGE_MAX,
  HOMING_CLOSE_DIST,
  HOMING_LOCK_MARGIN,
  HOMING_PROXIMITY,
  HOMING_SEEK_DELAY,
  HOMING_SPEED,
  HOMING_SPREAD_DEG,
  HOMING_STAGGER,
  HOMING_TURN_CLOSE_BOOST,
  MUZZLE_OFFSET,
  SHOT_SPREAD,
  SHIP_BOOST_THRUST,
  SHIP_BRAKE,
  SHIP_FORWARD_DRAG,
  SHIP_LATERAL_DRAG,
  SHIP_MAX_SPEED,
  SHIP_ROTATION_SPEED,
  SHIP_THRUST,
  SHOOT_INTERVAL,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './constants.ts';
import type { Entity } from './entity.ts';
import {
  createBullet,
  createHomingBullet,
  createParticle,
} from './factories.ts';
import { actions } from './input.ts';
import { rndRange, TAU } from './math.ts';
import {
  bullets,
  enemies,
  particles,
  ships,
  pulses,
  world,
  type BulletEntity,
  type EnemyEntity,
  type ShipEntity,
} from './queries.ts';

const DEG_TO_RAD = Math.PI / 180;

// Edge-detect the boost key across fixed steps (for the tap-dash).
let prevBoost = false;

/** Advance the ship one fixed step: input, thrust/boost, grip, integrate. */
export function shipSystem(dt: number) {
  const rotateLeft = actions.rotateLeft();
  const rotateRight = actions.rotateRight();
  const steerHeading = actions.steerHeading();
  const thrust = actions.thrust();
  const brake = actions.brake();
  const boost = actions.boost();

  for (const ship of ships.raw) {
    ship.previous.position.x = ship.transform.position.x;
    ship.previous.position.y = ship.transform.position.y;
    ship.previous.rotation = ship.transform.rotation;

    const st = ship.ship;

    // Steering. The analog stick (steerHeading) sets an absolute target heading
    // and the nose rotates toward it the short way, capped at the turn rate —
    // so sweeping the stick around carries the ship the whole way around. Keys
    // and the D-pad fall back to fixed-rate left/right rotation.
    const maxTurn = SHIP_ROTATION_SPEED * dt;
    if (steerHeading !== null) {
      // Shortest signed angle from current heading to the target, in [-180,180].
      let diff = steerHeading - ship.transform.rotation;
      diff = (((diff + 180) % 360) + 360) % 360 - 180;
      // Add the delta (never snap the absolute value) so interpolation stays
      // smooth and the step never exceeds the turn rate.
      ship.transform.rotation += Math.max(-maxTurn, Math.min(maxTurn, diff));
    } else {
      if (rotateLeft) ship.transform.rotation -= maxTurn;
      if (rotateRight) ship.transform.rotation += maxTurn;
    }

    const rad = ship.transform.rotation * DEG_TO_RAD;
    const hx = Math.sin(rad);
    const hy = -Math.cos(rad);

    // Tap-dash: a punchy forward burst on the boost press-edge, if there's fuel.
    if (boost && !prevBoost && st.fuel >= BOOST_DASH_COST) {
      ship.velocity.x += hx * BOOST_DASH_IMPULSE;
      ship.velocity.y += hy * BOOST_DASH_IMPULSE;
      st.fuel -= BOOST_DASH_COST;
    }

    // Holding boost sustains huge thrust, but only while the tank has fuel.
    const canBoost = boost && st.fuel > 0;

    st.thrusting = false;
    st.boosting = false;
    if (thrust || canBoost) {
      const power = canBoost ? SHIP_BOOST_THRUST : SHIP_THRUST;
      ship.velocity.x += hx * power * dt;
      ship.velocity.y += hy * power * dt;
      st.thrusting = true;
      st.boosting = canBoost;
      emitThrust(ship, hx, hy, canBoost);
    }
    if (brake) {
      ship.velocity.x -= hx * SHIP_THRUST * SHIP_BRAKE * dt;
      ship.velocity.y -= hy * SHIP_THRUST * SHIP_BRAKE * dt;
    }

    // Fuel: boosting drains it; anything else refills it.
    if (canBoost) {
      st.fuel = Math.max(0, st.fuel - BOOST_DRAIN * dt);
    } else {
      st.fuel = Math.min(BOOST_FUEL_MAX, st.fuel + BOOST_REFILL * dt);
    }

    // Grip: split velocity into forward (along the nose) and lateral, drag each
    // separately. Heavy lateral drag makes the ship go where it points.
    const perpX = -hy;
    const perpY = hx;
    const fwd = ship.velocity.x * hx + ship.velocity.y * hy;
    const lat = ship.velocity.x * perpX + ship.velocity.y * perpY;
    const newFwd = fwd * Math.max(0, 1 - SHIP_FORWARD_DRAG * dt);
    const newLat = lat * Math.max(0, 1 - SHIP_LATERAL_DRAG * dt);
    ship.velocity.x = hx * newFwd + perpX * newLat;
    ship.velocity.y = hy * newFwd + perpY * newLat;

    const speedSq =
      ship.velocity.x * ship.velocity.x + ship.velocity.y * ship.velocity.y;
    if (speedSq > SHIP_MAX_SPEED * SHIP_MAX_SPEED) {
      const scale = SHIP_MAX_SPEED / Math.sqrt(speedSq);
      ship.velocity.x *= scale;
      ship.velocity.y *= scale;
    }

    ship.transform.position.x += ship.velocity.x * dt;
    ship.transform.position.y += ship.velocity.y * dt;
  }

  prevBoost = boost;
}

/** Exhaust: a converging cone of short-lived pixels streaming into world space. */
function emitThrust(
  ship: ShipEntity,
  headingX: number,
  headingY: number,
  boost: boolean,
) {
  const pos = ship.transform.position;
  const nozzleX = pos.x - headingX * 5;
  const nozzleY = pos.y - headingY * 5;
  const perpX = -headingY;
  const perpY = headingX;

  const count = boost
    ? Math.random() < 0.5
      ? 7
      : 6
    : Math.random() < 0.5
      ? 4
      : 3;
  for (let i = 0; i < count; i++) {
    const back = boost ? rndRange(26, 64) : rndRange(12, 30);
    const band = rndRange(-2, 2);
    const converge = -band * rndRange(5, 9) + rndRange(-3, 3);
    let life = rndRange(0.08, 0.17);
    if (Math.random() < 0.5) life *= 0.6;
    createParticle(
      world,
      nozzleX + perpX * band,
      nozzleY + perpY * band,
      -headingX * back + perpX * converge + ship.velocity.x * 0.25,
      -headingY * back + perpY * converge + ship.velocity.y * 0.25,
      life,
      'flame',
      1,
    );
  }

  if (Math.random() < 0.2) {
    const back = rndRange(6, 15);
    const band = rndRange(-2, 2);
    const converge = -band * rndRange(3, 6) + rndRange(-2, 2);
    createParticle(
      world,
      nozzleX + perpX * band,
      nozzleY + perpY * band,
      -headingX * back + perpX * converge + ship.velocity.x * 0.12,
      -headingY * back + perpY * converge + ship.velocity.y * 0.12,
      rndRange(0.22, 0.4),
      'smoke',
      1,
    );
  }
}

/** Advance particles, apply light drag, and reap the expired ones. */
export function particleSystem(dt: number) {
  const dead: (typeof particles.raw)[number][] = [];
  const drag = Math.max(0, 1 - 3 * dt);

  for (const p of particles.raw) {
    p.particle.age += dt;
    if (p.particle.age >= p.particle.maxAge) {
      dead.push(p);
      continue;
    }
    p.transform.position.x += p.velocity.x * dt;
    p.transform.position.y += p.velocity.y * dt;
    p.velocity.x *= drag;
    p.velocity.y *= drag;
  }

  for (const p of dead) world.deleteEntity(p);
}

/** Advance every pulse phase (cosmetic — runs on the real frame delta). */
export function pulseSystem(dt: number) {
  for (const entity of pulses.raw) {
    entity.pulse.time += entity.pulse.speed * dt;
  }
}

export function getShip(): ShipEntity {
  return ships.raw[0];
}

// Countdown between shots; reset to 0 on release so the next tap fires at once.
let shootCooldown = 0;

/** Fire on a tap, and stream at SHOOT_INTERVAL while the shoot button is held. */
export function shootSystem(dt: number) {
  shootCooldown -= dt;
  if (!actions.shoot()) {
    shootCooldown = 0; // released → next press fires immediately
    return;
  }
  if (shootCooldown > 0) return;
  shootCooldown = SHOOT_INTERVAL;

  const ship = ships.raw[0];
  if (!ship) return;
  const rad = ship.transform.rotation * DEG_TO_RAD;
  const hx = Math.sin(rad);
  const hy = -Math.cos(rad);
  const perpX = -hy;
  const perpY = hx;
  const muzzleX = ship.transform.position.x + hx * MUZZLE_OFFSET;
  const muzzleY = ship.transform.position.y + hy * MUZZLE_OFFSET;
  // Inherit the ship's velocity so a boosting player can't outrun the shot.
  const vx = ship.velocity.x + hx * BULLET_SPEED;
  const vy = ship.velocity.y + hy * BULLET_SPEED;
  // Double-wide: two parallel bullets offset left/right of the nose line.
  for (const side of [-1, 1]) {
    createBullet(
      world,
      muzzleX + perpX * SHOT_SPREAD * side,
      muzzleY + perpY * SHOT_SPREAD * side,
      ship.transform.rotation,
      vx,
      vy,
    );
  }
}

/** Advance bullets, test them against live enemies, and reap the spent ones. */
export function bulletSystem(dt: number) {
  const dead: BulletEntity[] = [];

  for (const bullet of bullets.raw) {
    bullet.previous.position.x = bullet.transform.position.x;
    bullet.previous.position.y = bullet.transform.position.y;
    bullet.previous.rotation = bullet.transform.rotation;

    bullet.bullet.age += dt;
    if (bullet.bullet.age >= bullet.bullet.maxAge) {
      dead.push(bullet);
      continue;
    }

    // Homing: after a brief straight "launch" phase (so the volley fans out
    // first), steer the velocity toward the target — with the turn rate ramping
    // up as it closes, so it tightens onto the target instead of orbiting it.
    const homing = bullet.homing;
    if (
      homing &&
      bullet.bullet.age >= HOMING_SEEK_DELAY &&
      homing.target.transform &&
      (!homing.target.enemy || homing.target.enemy.respawnTimer <= 0)
    ) {
      const dx = homing.target.transform.position.x - bullet.transform.position.x;
      const dy = homing.target.transform.position.y - bullet.transform.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const closeBoost =
        1 +
        HOMING_TURN_CLOSE_BOOST *
          Math.max(0, (HOMING_CLOSE_DIST - dist) / HOMING_CLOSE_DIST);
      const cur = Math.atan2(bullet.velocity.y, bullet.velocity.x);
      let diff = Math.atan2(dy, dx) - cur;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // wrap to [-π, π]
      const maxStep = homing.turnRate * closeBoost * DEG_TO_RAD * dt;
      const next = cur + Math.max(-maxStep, Math.min(maxStep, diff));
      const speed = Math.sqrt(
        bullet.velocity.x * bullet.velocity.x +
          bullet.velocity.y * bullet.velocity.y,
      );
      bullet.velocity.x = Math.cos(next) * speed;
      bullet.velocity.y = Math.sin(next) * speed;
      // Point the sprite along travel (sprite's "up" is -y).
      bullet.transform.rotation =
        Math.atan2(Math.cos(next), -Math.sin(next)) / DEG_TO_RAD;
    }

    bullet.transform.position.x += bullet.velocity.x * dt;
    bullet.transform.position.y += bullet.velocity.y * dt;

    for (const enemy of enemies.raw) {
      if (enemy.enemy.respawnTimer > 0) continue;
      const dx = enemy.transform.position.x - bullet.transform.position.x;
      const dy = enemy.transform.position.y - bullet.transform.position.y;
      // Homing missiles get a small proximity fuse so a tight pass still lands.
      const hitR =
        ENEMY_RADIUS + BULLET_RADIUS + (bullet.homing ? HOMING_PROXIMITY : 0);
      if (dx * dx + dy * dy <= hitR * hitR) {
        hitEnemy(enemy, bullet.transform.position.x, bullet.transform.position.y);
        dead.push(bullet);
        break;
      }
    }
  }

  for (const bullet of dead) world.deleteEntity(bullet);
}

/** Apply a hit: flash, spark, and on death a burst plus a respawn countdown. */
function hitEnemy(enemy: EnemyEntity, atX: number, atY: number) {
  enemy.enemy.health -= 1;
  enemy.enemy.hitFlash = ENEMY_HIT_FLASH;

  for (let i = 0; i < 6; i++) {
    const angle = rndRange(0, TAU);
    const speed = rndRange(20, 70);
    createParticle(
      world,
      atX,
      atY,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      rndRange(0.1, 0.25),
      'flame',
      1,
    );
  }

  if (enemy.enemy.health <= 0) {
    const ex = enemy.transform.position.x;
    const ey = enemy.transform.position.y;
    for (let i = 0; i < 24; i++) {
      const angle = rndRange(0, TAU);
      const speed = rndRange(30, 120);
      createParticle(
        world,
        ex,
        ey,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        rndRange(0.2, 0.5),
        Math.random() < 0.5 ? 'flame' : 'smoke',
        1,
      );
    }
    enemy.enemy.respawnTimer = ENEMY_RESPAWN_DELAY;
  }
}

/** Decay hit flashes and respawn dead enemies near the ship after the delay. */
export function enemySystem(dt: number) {
  const ship = ships.raw[0];
  for (const enemy of enemies.raw) {
    if (enemy.enemy.hitFlash > 0) {
      enemy.enemy.hitFlash = Math.max(0, enemy.enemy.hitFlash - dt);
    }
    if (enemy.enemy.respawnTimer > 0) {
      enemy.enemy.respawnTimer -= dt;
      if (enemy.enemy.respawnTimer <= 0 && ship) {
        // Respawn out near the sight edge, reset to a fresh patrol.
        const angle = rndRange(0, TAU);
        const dist = rndRange(180, 260);
        const nx = ship.transform.position.x + Math.cos(angle) * dist;
        const ny = ship.transform.position.y + Math.sin(angle) * dist;
        enemy.transform.position.x = nx;
        enemy.transform.position.y = ny;
        // Match previous so interpolation doesn't smear across the teleport.
        enemy.previous.position.x = nx;
        enemy.previous.position.y = ny;
        enemy.previous.rotation = enemy.transform.rotation;
        enemy.velocity.x = 0;
        enemy.velocity.y = 0;
        enemy.enemy.respawnTimer = 0;
        enemy.enemy.health = ENEMY_HEALTH;
        enemy.enemy.state = 'patrol';
        enemy.enemy.waypoint.x =
          nx + rndRange(-ENEMY_PATROL_RADIUS, ENEMY_PATROL_RADIUS);
        enemy.enemy.waypoint.y =
          ny + rndRange(-ENEMY_PATROL_RADIUS, ENEMY_PATROL_RADIUS);
        enemy.enemy.repathTimer = rndRange(1, ENEMY_REPATH_TIME);
      }
    }
  }
}

const clampTo = (v: number, max: number) => Math.max(0, Math.min(max, v));

/**
 * Enemy movement AI. Each live enemy flies with the player's handling (turn the
 * nose toward a goal, thrust along it, grip drags the slide) minus the boost.
 * It patrols random waypoints until the player comes within sight, then pursues
 * to a standoff distance; it drops back to patrol once the player is far again.
 */
export function enemyAiSystem(dt: number) {
  const ship = ships.raw[0];
  for (const enemy of enemies.raw) {
    const e = enemy.enemy;
    if (e.respawnTimer > 0) continue;

    enemy.previous.position.x = enemy.transform.position.x;
    enemy.previous.position.y = enemy.transform.position.y;
    enemy.previous.rotation = enemy.transform.rotation;

    // Sight is tied to the viewport: an enemy only spots the player once it is
    // on screen (within the view around the ship), and disengages once it drops
    // well past the edge — so nothing rushes in from off-screen.
    let playerDist = Infinity;
    if (ship) {
      const px = ship.transform.position.x - enemy.transform.position.x;
      const py = ship.transform.position.y - enemy.transform.position.y;
      playerDist = Math.sqrt(px * px + py * py);
      const halfW = GAME_WIDTH / 2;
      const halfH = GAME_HEIGHT / 2;
      const onScreen = Math.abs(px) <= halfW && Math.abs(py) <= halfH;
      const offScreen =
        Math.abs(px) > halfW + ENEMY_SIGHT_LOSE_MARGIN ||
        Math.abs(py) > halfH + ENEMY_SIGHT_LOSE_MARGIN;
      if (e.state === 'patrol' && onScreen) e.state = 'engage';
      else if (e.state === 'engage' && offScreen) e.state = 'patrol';
    } else if (e.state === 'engage') {
      e.state = 'patrol';
    }

    // Pick a goal point and whether to thrust toward it.
    let goalX: number;
    let goalY: number;
    let wantThrust: boolean;
    if (e.state === 'engage' && ship) {
      goalX = ship.transform.position.x;
      goalY = ship.transform.position.y;
      wantThrust = playerDist > ENEMY_STANDOFF; // hold a standoff, don't ram
    } else {
      e.repathTimer -= dt;
      const wdx = e.waypoint.x - enemy.transform.position.x;
      const wdy = e.waypoint.y - enemy.transform.position.y;
      if (
        wdx * wdx + wdy * wdy <=
          ENEMY_WAYPOINT_REACHED * ENEMY_WAYPOINT_REACHED ||
        e.repathTimer <= 0
      ) {
        e.waypoint.x = clampTo(
          enemy.transform.position.x +
            rndRange(-ENEMY_PATROL_RADIUS, ENEMY_PATROL_RADIUS),
          WORLD_WIDTH,
        );
        e.waypoint.y = clampTo(
          enemy.transform.position.y +
            rndRange(-ENEMY_PATROL_RADIUS, ENEMY_PATROL_RADIUS),
          WORLD_HEIGHT,
        );
        e.repathTimer = ENEMY_REPATH_TIME;
      }
      goalX = e.waypoint.x;
      goalY = e.waypoint.y;
      wantThrust = true;
    }

    // Turn the nose toward the goal, short way, capped at the turn rate.
    const ddx = goalX - enemy.transform.position.x;
    const ddy = goalY - enemy.transform.position.y;
    const targetDeg = Math.atan2(ddx, -ddy) / DEG_TO_RAD;
    let diff = targetDeg - enemy.transform.rotation;
    diff = (((diff + 180) % 360) + 360) % 360 - 180;
    const maxTurn = SHIP_ROTATION_SPEED * dt;
    enemy.transform.rotation += Math.max(-maxTurn, Math.min(maxTurn, diff));

    const rad = enemy.transform.rotation * DEG_TO_RAD;
    const hx = Math.sin(rad);
    const hy = -Math.cos(rad);

    // Thrust only once roughly aimed, so it arcs onto its heading like a ship
    // banking around rather than powering off sideways.
    if (wantThrust && Math.abs(diff) < 70) {
      enemy.velocity.x += hx * ENEMY_THRUST * dt;
      enemy.velocity.y += hy * ENEMY_THRUST * dt;
    }

    // Grip: forward/lateral split dragged separately (same as the ship).
    const perpX = -hy;
    const perpY = hx;
    const fwd = enemy.velocity.x * hx + enemy.velocity.y * hy;
    const lat = enemy.velocity.x * perpX + enemy.velocity.y * perpY;
    const newFwd = fwd * Math.max(0, 1 - SHIP_FORWARD_DRAG * dt);
    const newLat = lat * Math.max(0, 1 - SHIP_LATERAL_DRAG * dt);
    enemy.velocity.x = hx * newFwd + perpX * newLat;
    enemy.velocity.y = hy * newFwd + perpY * newLat;

    // Separation: push apart from other live enemies so they swarm rather than
    // stack on the same point. Applied after grip so it isn't over-damped.
    for (const other of enemies.raw) {
      if (other === enemy || other.enemy.respawnTimer > 0) continue;
      const sx = enemy.transform.position.x - other.transform.position.x;
      const sy = enemy.transform.position.y - other.transform.position.y;
      const d2 = sx * sx + sy * sy;
      if (d2 > 0 && d2 < ENEMY_SEPARATION * ENEMY_SEPARATION) {
        const d = Math.sqrt(d2);
        const push = ((ENEMY_SEPARATION - d) / ENEMY_SEPARATION) *
          ENEMY_SEPARATION_FORCE * dt;
        enemy.velocity.x += (sx / d) * push;
        enemy.velocity.y += (sy / d) * push;
      }
    }

    enemy.transform.position.x += enemy.velocity.x * dt;
    enemy.transform.position.y += enemy.velocity.y * dt;
  }
}

// ── Homing charge shot ──────────────────────────────────────────────────────

/** Projectiles awarded for a charge held `t` seconds (0 below the 1s floor). */
function chargeToCount(t: number): number {
  if (t >= 3) return 8;
  if (t >= 2) return 5;
  if (t >= 1) return 3;
  return 0;
}

/** True if `target` still exists and isn't mid-respawn. */
function targetIsLive(target: Entity | null): target is Entity {
  return (
    target != null &&
    target.transform != null &&
    (!target.enemy || target.enemy.respawnTimer <= 0)
  );
}

/** The nearest live enemy currently on screen, else null. */
function findLockTarget(ship: ShipEntity): Entity | null {
  const halfW = GAME_WIDTH / 2 + HOMING_LOCK_MARGIN;
  const halfH = GAME_HEIGHT / 2 + HOMING_LOCK_MARGIN;
  let best: Entity | null = null;
  let bestDistSq = Infinity;
  for (const enemy of enemies.raw) {
    if (enemy.enemy.respawnTimer > 0) continue;
    const dx = enemy.transform.position.x - ship.transform.position.x;
    const dy = enemy.transform.position.y - ship.transform.position.y;
    if (Math.abs(dx) > halfW || Math.abs(dy) > halfH) continue; // off-screen
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = enemy;
    }
  }
  return best;
}

let homingCharge = 0;
let homingHeld = false;
let lockTarget: Entity | null = null;
// The target latched while charging, so a brief loss at release still fires.
let latchedTarget: Entity | null = null;
// Pending staggered volley emitted over subsequent steps.
let volleyRemaining = 0;
let volleyTotal = 0;
let volleyTimer = 0;
let volleyTarget: Entity | null = null;

/** Charge while the homing button is held; on release fire a homing volley at
 *  the locked target, then emit that volley staggered over the next steps. */
export function homingSystem(dt: number) {
  const ship = ships.raw[0];
  // Recompute the lock every step so the reticle tracks whatever we're facing.
  lockTarget = ship ? findLockTarget(ship) : null;

  const held = actions.homing();
  if (held) {
    homingCharge = Math.min(HOMING_CHARGE_MAX, homingCharge + dt);
    // Latch the most recent lock so a momentary loss on release still fires.
    if (lockTarget) latchedTarget = lockTarget;
  } else if (homingHeld) {
    // Released: commit a volley if we charged enough and had a target.
    const count = chargeToCount(homingCharge);
    const target = targetIsLive(latchedTarget) ? latchedTarget : lockTarget;
    if (count > 0 && target) {
      volleyRemaining = count;
      volleyTotal = count;
      volleyTimer = 0;
      volleyTarget = target;
    }
    homingCharge = 0;
    latchedTarget = null;
  }
  homingHeld = held;

  // Emit the queued volley: the centre (or innermost pair) first, then each
  // symmetric pair launched TOGETHER on the next tick, so the spread blooms
  // outward like a bulb rather than sweeping across from one side.
  if (volleyRemaining > 0 && volleyTarget && ship) {
    volleyTimer -= dt;
    while (volleyRemaining > 0 && volleyTimer <= 0) {
      const i0 = volleyTotal - volleyRemaining;
      const offset0 = fanOffsetDeg(i0, volleyTotal);
      launchHomingMissile(ship, volleyTarget, i0);
      volleyRemaining -= 1;
      // Fire the mirror partner in the same tick (skips the lone centre).
      if (
        volleyRemaining > 0 &&
        Math.abs(fanOffsetDeg(volleyTotal - volleyRemaining, volleyTotal) + offset0) <
          1e-6
      ) {
        launchHomingMissile(ship, volleyTarget, volleyTotal - volleyRemaining);
        volleyRemaining -= 1;
      }
      volleyTimer += HOMING_STAGGER;
    }
    if (volleyRemaining <= 0) volleyTarget = null;
  }
}

/**
 * Fan offset (deg) for the `i`-th missile launched in a volley of `total`.
 * Slots are evenly spaced across the fan, but launched CENTRE-OUT (centre
 * first, then symmetric pairs fanning outward) so the volley blooms like a bulb
 * from the ship instead of wiping across from one side to the other.
 */
function fanOffsetDeg(i: number, total: number): number {
  if (total <= 1) return 0;
  const fracs: number[] = [];
  for (let k = 0; k < total; k++) fracs.push(k / (total - 1) - 0.5);
  fracs.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
  return fracs[i] * HOMING_SPREAD_DEG;
}

function launchHomingMissile(
  ship: ShipEntity,
  target: Entity,
  index: number,
) {
  const spread = fanOffsetDeg(index, volleyTotal);
  const angle = (ship.transform.rotation + spread) * DEG_TO_RAD;
  const hx = Math.sin(angle);
  const hy = -Math.cos(angle);
  createHomingBullet(
    world,
    ship.transform.position.x + hx * MUZZLE_OFFSET,
    ship.transform.position.y + hy * MUZZLE_OFFSET,
    ship.transform.rotation + spread,
    // Constant cruise speed (not ship-relative) keeps the turn radius — and so
    // the seeking behaviour — predictable regardless of how fast the ship moves.
    hx * HOMING_SPEED,
    hy * HOMING_SPEED,
    target,
  );
}

/** The currently locked enemy (for the reticle), or null. */
export function getLockTarget(): Entity | null {
  return lockTarget;
}

/** Charge readout for the HUD/reticle: pip count, seconds held, and hold state. */
export function getHomingCharge(): {
  count: number;
  seconds: number;
  charging: boolean;
} {
  return { count: chargeToCount(homingCharge), seconds: homingCharge, charging: homingHeld };
}
