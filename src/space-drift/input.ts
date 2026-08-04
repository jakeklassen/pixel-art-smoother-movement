// Minimal keyboard state, mirroring love.keyboard.isDown. Keys are stored
// lowercased; arrow keys arrive as "arrowleft" etc.
const held = new Set<string>();

window.addEventListener('keydown', (e) => {
  held.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e) => {
  held.delete(e.key.toLowerCase());
});
window.addEventListener('blur', () => {
  held.clear();
});

/** True if any of the given keys is currently held. */
export const isDown = (...keys: string[]): boolean => keys.some((k) => held.has(k));

/** Register a one-shot handler for a key press (for toggles). */
export const onPress = (key: string, handler: () => void): void => {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key.toLowerCase() === key) handler();
  });
};
