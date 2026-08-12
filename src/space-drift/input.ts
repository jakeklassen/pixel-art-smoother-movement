// Unified keyboard + gamepad input via `contro`. The rest of the game reads
// high-level actions (rotateLeft, thrust, boost, ...) so it never cares which
// device produced them. An 8bitdo SN30 Pro (standard mapping) works out of the
// box; contro auto-selects the first standard-mapped pad and ignores the rest.
import { Gamepad, Keyboard } from 'contro';

const keyboard = new Keyboard();
const gamepad = new Gamepad();

// contro doesn't preventDefault, so Space/arrows would still scroll the page.
const SCROLL_KEYS = new Set([
  ' ',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
window.addEventListener('keydown', (e) => {
  if (SCROLL_KEYS.has(e.key)) e.preventDefault();
});

// Left-stick magnitude past this counts as a digital press.
const STICK_DEADZONE = 0.4;

// Keyboard controls (contro resolves aliases: 'Left' → ArrowLeft, 'W' → w).
const key = {
  left: keyboard.key('Left'),
  a: keyboard.key('A'),
  right: keyboard.key('Right'),
  d: keyboard.key('D'),
  up: keyboard.key('Up'),
  w: keyboard.key('W'),
  down: keyboard.key('Down'),
  s: keyboard.key('S'),
  z: keyboard.key('Z'),
};

// Gamepad controls (standard mapping). Locomotion lives on the triggers and the
// left stick so the face buttons stay free for actions (boost=X, shoot=B soon):
//   forward/gas = stick (any direction) or Right Trigger   (the "W / Up" of the pad)
//   brake       = Left Trigger
//   steer       = stick left/right or D-pad
//   boost       = X (left face button)
const pad = {
  dpadLeft: gamepad.button('DpadLeft'),
  dpadRight: gamepad.button('DpadRight'),
  rightTrigger: gamepad.button('RT'),
  leftTrigger: gamepad.button('LT'),
  x: gamepad.button('X'),
  leftStick: gamepad.stick('left'),
};

// Left-stick vector (up is -y in the standard mapping). Zeroed when no pad.
const stick = (): { x: number; y: number } =>
  gamepad.isConnected() ? pad.leftStick.query() : { x: 0, y: 0 };

// Any stick deflection past the deadzone counts as "gas". The ship thrusts
// along its nose, not toward the stick, so pushing the stick in ANY direction
// means forward: a hard left/right turn keeps the throttle open instead of
// cutting out, and pulling down never becomes an accidental reverse.
const stickGas = (): boolean => {
  const s = stick();
  return s.x * s.x + s.y * s.y > STICK_DEADZONE * STICK_DEADZONE;
};

/** High-level game actions, true while active on either device. */
export const actions = {
  rotateLeft: (): boolean =>
    key.left.query() ||
    key.a.query() ||
    pad.dpadLeft.query() ||
    stick().x < -STICK_DEADZONE,
  rotateRight: (): boolean =>
    key.right.query() ||
    key.d.query() ||
    pad.dpadRight.query() ||
    stick().x > STICK_DEADZONE,
  thrust: (): boolean =>
    key.up.query() || key.w.query() || pad.rightTrigger.query() || stickGas(),
  brake: (): boolean =>
    key.down.query() || key.s.query() || pad.leftTrigger.query(),
  boost: (): boolean => key.z.query() || pad.x.query(),
};

/** True once a gamepad is connected (for HUD hints). */
export const gamepadConnected = (): boolean => gamepad.isConnected();

type RumbleActuator = {
  playEffect?: (
    type: string,
    params: {
      duration: number;
      strongMagnitude: number;
      weakMagnitude: number;
    },
  ) => Promise<unknown>;
};

/**
 * Rumble every connected pad that exposes a dual-rumble actuator. This reads
 * navigator.getGamepads() directly rather than going through contro, so it
 * fires even when the last input came from the keyboard (contro only counts a
 * pad as "connected" once it has sent input, which would otherwise gate this).
 * Safe no-op on pads without a haptic actuator.
 */
export const rumble = (durationMs: number, strong = 1, weak = 0.5): void => {
  const pads = navigator.getGamepads?.() ?? [];
  for (const p of pads) {
    const actuator = (p as { vibrationActuator?: RumbleActuator } | null)
      ?.vibrationActuator;
    if (!actuator?.playEffect) continue;
    actuator
      .playEffect('dual-rumble', {
        duration: durationMs,
        strongMagnitude: strong,
        weakMagnitude: weak,
      })
      .catch(() => {});
  }
};

/** Register a one-shot handler for a key press (debug toggles, keyboard-only). */
export const onPress = (key: string, handler: () => void): void => {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key.toLowerCase() === key) handler();
  });
};
