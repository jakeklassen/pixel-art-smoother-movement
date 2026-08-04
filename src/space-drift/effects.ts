import { AdvancedBloomFilter, CRTFilter } from 'pixi-filters';
import type { Container } from 'pixi.js';

let bloom: AdvancedBloomFilter;
let crt: CRTFilter;

export function initEffects() {
  bloom = new AdvancedBloomFilter({
    threshold: 0.5,
    bloomScale: 1.0,
    brightness: 1.0,
    blur: 6,
    quality: 4,
  });

  crt = new CRTFilter({
    curvature: 3,
    lineWidth: 1.2,
    lineContrast: 0.25,
    noise: 0.08,
    noiseSize: 1,
    vignetting: 0.5,
    vignettingAlpha: 0.5,
    vignettingBlur: 0.3,
    time: 0,
  });
}

/** Enable/disable the CRT + bloom chain on the scene container. */
export function setCrt(scene: Container, on: boolean) {
  scene.filters = on ? [bloom, crt] : [];
}

/** Advance animated CRT time (scanline/noise drift). */
export function updateEffects(dt: number) {
  crt.time += dt * 10;
}
