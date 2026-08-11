import {
  BOOST_DASH_COST,
  BOOST_DASH_IMPULSE,
  BOOST_DRAIN,
  BOOST_FUEL_MAX,
  BOOST_REFILL,
  SHIP_BOOST_THRUST,
  SHIP_BRAKE,
  SHIP_FORWARD_DRAG,
  SHIP_LATERAL_DRAG,
  SHIP_MAX_SPEED,
  SHIP_ROTATION_SPEED,
  SHIP_THRUST,
} from './constants.ts';
import { createParticle } from './factories.ts';
import { isDown } from './input.ts';
import { rndRange } from './math.ts';
import { particles, ships, pulses, world, type ShipEntity } from './queries.ts';

const DEG_TO_RAD = Math.PI / 180;

// Edge-detect the boost key across fixed steps (for the tap-dash).
let prevBoost = false;

/** Advance the ship one fixed step: input, thrust/boost, grip, integrate. */
export function shipSystem(dt: number) {
  const rotateLeft = isDown('arrowleft', 'a');
  const rotateRight = isDown('arrowright', 'd');
  const thrust = isDown('arrowup', 'w');
  const brake = isDown('arrowdown', 's');
  const boost = isDown('z');

  for (const ship of ships.raw) {
    ship.previous.position.x = ship.transform.position.x;
    ship.previous.position.y = ship.transform.position.y;
    ship.previous.rotation = ship.transform.rotation;

    const st = ship.ship;

    // A/D (or arrows) turn the nose.
    if (rotateLeft) ship.transform.rotation -= SHIP_ROTATION_SPEED * dt;
    if (rotateRight) ship.transform.rotation += SHIP_ROTATION_SPEED * dt;

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
