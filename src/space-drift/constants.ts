// 16:9 low-res viewport, upscaled ×SCALE (256×144 → 1280×720). Same zoom as
// before, just a larger play area.
export const GAME_WIDTH = 256;
export const GAME_HEIGHT = 144;
export const SCALE = 5;

// The render texture is one pixel larger than the view so the sub-pixel blit
// offset (up to one low-res pixel) never reveals an uncovered edge.
export const CANVAS_WIDTH = GAME_WIDTH + 1;
export const CANVAS_HEIGHT = GAME_HEIGHT + 1;

export const WINDOW_WIDTH = GAME_WIDTH * SCALE;
export const WINDOW_HEIGHT = GAME_HEIGHT * SCALE;

// A large area to drift around in, dotted with landmarks.
export const WORLD_WIDTH = 1536;
export const WORLD_HEIGHT = 1536;

// Fixed-timestep simulation; rendering interpolates between steps.
export const FIXED_DT = 1 / 60;
export const MAX_FRAME_TIME = 0.25;

// Ship tuning — a deliberately "tight" asteroids feel.
export const SHIP_ROTATION_SPEED = 210; // degrees / second
export const SHIP_THRUST = 280; // pixels / second^2
export const SHIP_BRAKE = 0.6; // reverse-thrust fraction on the brake key

// Grip handling: velocity is split into forward (along the nose) and lateral
// (sideways) components each step and dragged separately. High lateral drag =
// the ship "grips" and goes where it points; forward drag sets cruise speed
// (~SHIP_THRUST / SHIP_FORWARD_DRAG).
export const SHIP_FORWARD_DRAG = 2.5;
export const SHIP_LATERAL_DRAG = 9; // strong grip → go where you point

// Absolute speed clamp — only the Z boost reaches it.
export const SHIP_MAX_SPEED = 520;

// Boost (Z): huge forward thrust, gated by a fuel meter. Tapping fires a punchy
// dash; holding sustains until the meter drains, then it refills when released.
export const SHIP_BOOST_THRUST = 1500;
export const BOOST_FUEL_MAX = 1; // full tank (arbitrary units)
export const BOOST_DRAIN = 0.6; // fuel/sec while boosting (~1.7s from full)
export const BOOST_REFILL = 0.32; // fuel/sec while not boosting (~3s to refill)
export const BOOST_DASH_COST = 0.18; // fuel spent on a tap-dash
export const BOOST_DASH_IMPULSE = 170; // forward px/s from a tap-dash

// Star streaking during high-speed flight.
export const STREAK_THRESHOLD = 140;
export const STREAK_K = 0.07;
export const STREAK_MAX = 46;

// Screen shake ramps in above this speed. (Currently unused — boost drives the
// whole-frame shake below.)
export const SHAKE_THRESHOLD = 200;
export const SHAKE_MAX = 1.2;

// Whole-frame boost shake: nothing until BOOST_SHAKE_DELAY into boost, then it
// eases up over BOOST_SHAKE_RAMP to BOOST_SHAKE_AMP (game px) and holds. Applied
// as a scene-wide translate, so the whole frame (ship included) shakes as one.
export const BOOST_SHAKE_DELAY = 0.25; // seconds into boost before it starts
export const BOOST_SHAKE_RAMP = 0.12; // ease-in time so it doesn't pop
export const BOOST_SHAKE_AMP = 1.0; // sustained amplitude, game px

// Shooting. Bullets inherit the ship's velocity so you can never outrun your
// own fire (BULLET_SPEED is added on top of it, along the nose). A tap fires
// once; holding streams at SHOOT_INTERVAL.
export const BULLET_SPEED = 320; // px/s added on top of the ship's velocity
export const BULLET_LIFETIME = 1.1; // seconds before a bullet expires
export const BULLET_RADIUS = 2; // px, for hit tests
export const SHOOT_INTERVAL = 0.13; // seconds between shots while held
export const MUZZLE_OFFSET = 5; // px ahead of the ship centre to spawn bullets

// Homing charge shot (hold the right face button / X key). The lock-on picks
// the nearest on-screen enemy; the longer you hold, the bigger the volley:
//   >=1s -> 3, >=2s -> 5, >=3s -> 8. Release fires a staggered, homing spread.
export const HOMING_CHARGE_MAX = 3; // seconds to full charge
export const HOMING_LOCK_MARGIN = 6; // px past the view edge still counts as on-screen
export const HOMING_SPEED = 300; // px/s baseline (added to the ship velocity)
export const HOMING_TURN_RATE = 380; // deg/s the missiles can steer to track
export const HOMING_SPREAD_DEG = 30; // initial fan-out across the volley
export const HOMING_STAGGER = 0.06; // seconds between launches in a volley
export const HOMING_LIFETIME = 2.4; // seconds before a homing missile expires

// Dummy enemy: a stationary target that takes ENEMY_HEALTH hits, then bursts
// and respawns nearby after a short delay so testing keeps flowing.
export const ENEMY_HEALTH = 3;
export const ENEMY_RADIUS = 5; // px, hit-test radius
export const ENEMY_HIT_FLASH = 0.08; // seconds of hit flash
export const ENEMY_RESPAWN_DELAY = 1.2; // seconds dead before respawn

export const PLANET_COUNT = 7;

// Shared light direction for all planets (up-and-to-the-left). Pre-normalized.
export const LIGHT_DIR_X = -0.7071;
export const LIGHT_DIR_Y = -0.7071;
