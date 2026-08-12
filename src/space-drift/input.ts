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

// Gamepad controls (standard mapping). A / Right Trigger = thrust, B = brake,
// Y = boost, D-pad + left stick = steer.
const pad = {
  dpadLeft: gamepad.button('DpadLeft'),
  dpadRight: gamepad.button('DpadRight'),
  a: gamepad.button('A'),
  rightTrigger: gamepad.button('RT'),
  b: gamepad.button('B'),
  y: gamepad.button('Y'),
  leftStick: gamepad.stick('left'),
};

const stickX = (): number =>
  gamepad.isConnected() ? pad.leftStick.query().x : 0;

/** High-level game actions, true while active on either device. */
export const actions = {
  rotateLeft: (): boolean =>
    key.left.query() ||
    key.a.query() ||
    pad.dpadLeft.query() ||
    stickX() < -STICK_DEADZONE,
  rotateRight: (): boolean =>
    key.right.query() ||
    key.d.query() ||
    pad.dpadRight.query() ||
    stickX() > STICK_DEADZONE,
  thrust: (): boolean =>
    key.up.query() || key.w.query() || pad.a.query() || pad.rightTrigger.query(),
  brake: (): boolean => key.down.query() || key.s.query() || pad.b.query(),
  boost: (): boolean => key.z.query() || pad.y.query(),
};

/** True once a gamepad is connected (for HUD hints). */
export const gamepadConnected = (): boolean => gamepad.isConnected();

/**
 * Rumble the pad for `durationMs`. No-ops when no pad is connected or the pad
 * lacks a dual-rumble actuator (many do), so it's always safe to call.
 * `strong` drives the low-frequency (heavy) motor, `weak` the high-frequency.
 */
export const rumble = (
  durationMs: number,
  strong = 1,
  weak = 0.5,
): void => {
  void gamepad.vibrate(durationMs, {
    strongMagnitude: strong,
    weakMagnitude: weak,
  });
};

/** Register a one-shot handler for a key press (debug toggles, keyboard-only). */
export const onPress = (key: string, handler: () => void): void => {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key.toLowerCase() === key) handler();
  });
};
