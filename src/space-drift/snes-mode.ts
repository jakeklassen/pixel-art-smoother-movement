/**
 * SNES fidelity spike — snesgine issue #17.
 *
 * The question: does space-drift still *feel* right under the SNES's actual
 * display constraints? Specifically whether an 8x8 ship quantised to a handful
 * of rotation frames, at whole-pixel positions with no interpolation, is
 * acceptable — or whether the ship has to grow to a 16x16 sprite.
 *
 * Everything here simulates a constraint. Nothing here is a rendering
 * improvement.
 *
 * The important methodological point: we pre-render rotation frames with
 * nearest-neighbour sampling, exactly as the asset pipeline will, and then blit
 * those frames. We deliberately do NOT quantise `sprite.rotation` — a live
 * rotate happens at display resolution and looks far smoother than genuine
 * pre-rendered 8x8 pixel art. Testing the easy version would flatter the result
 * and we would find out the truth on hardware two months later.
 *
 * Note the internal heading stays at full precision. Only the *displayed frame*
 * quantises, so physics, aim and homing remain smooth. This is a visual
 * fidelity test, not a control test.
 */
import { Texture, TextureSource } from 'pixi.js';

/** Source tile size in the sheet. Every sprite in this game is one 8x8 tile. */
const SRC_TILE = 8;

/**
 * How the source tile is fitted into the output frame before rotation.
 *
 * The ship art fills its 8x8 tile edge to edge, so rotating it inside an 8x8
 * output necessarily clips the corners. These are the four ways out, and
 * choosing between them is the point of the spike.
 */
export type FitMode =
  /** 8x8 out, source at full size. Corners clip on the diagonals. Cheapest. */
  | '8-clip'
  /** 8x8 out, source shrunk to the inscribed circle. No clip, less detail. */
  | '8-fit'
  /** 16x16 out, 8x8 source centred. No clip, same on-screen size, but costs a
   *  16x16 sprite: 128 bytes of VRAM instead of 32, and 2 slivers per scanline
   *  instead of 1. */
  | '16-pad'
  /** 16x16 out, source scaled 2x. No clip, ship is twice as large on screen.
   *  Stands in for redrawing the art at 16x16. */
  | '16-2x';

export const FIT_MODES: FitMode[] = ['8-clip', '8-fit', '16-pad', '16-2x'];

/** 0 means "continuous" — use Pixi's live rotation, i.e. no SNES constraint. */
export type FrameCount = 0 | 8 | 16 | 32;

export const FRAME_COUNTS: FrameCount[] = [0, 32, 16, 8];

export interface SnesModeState {
  /** Master toggle. When on, forces whole-pixel + no interpolation too. */
  enabled: boolean;
  frames: FrameCount;
  fit: FitMode;
}

export const snesMode: SnesModeState = {
  enabled: false,
  frames: 16,
  fit: '16-pad',
};

export function cycleFrames(): void {
  const i = FRAME_COUNTS.indexOf(snesMode.frames);
  snesMode.frames = FRAME_COUNTS[(i + 1) % FRAME_COUNTS.length];
}

export function cycleFit(): void {
  const i = FIT_MODES.indexOf(snesMode.fit);
  snesMode.fit = FIT_MODES[(i + 1) % FIT_MODES.length];
}

/** Output frame size in pixels for a fit mode. */
export function outSizeFor(fit: FitMode): number {
  return fit === '8-clip' || fit === '8-fit' ? 8 : 16;
}

/** Scale applied to the source tile before rotation, for a fit mode. */
function sourceScaleFor(fit: FitMode): number {
  switch (fit) {
    // Shrink so the tile's diagonal fits inside 8 pixels: 8 / (8 * sqrt(2)).
    case '8-fit':
      return Math.SQRT1_2;
    case '16-2x':
      return 2;
    default:
      return 1;
  }
}

/**
 * Rotate one source tile into an output canvas with nearest-neighbour sampling,
 * by inverse-mapping each destination pixel back into the source. This is the
 * same operation the build-time pipeline will perform.
 */
function rotateTile(
  src: ImageData,
  sheetWidth: number,
  tileCol: number,
  tileRow: number,
  angleDeg: number,
  fit: FitMode,
): HTMLCanvasElement {
  const out = outSizeFor(fit);
  const scale = sourceScaleFor(fit);

  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (ctx == null) return canvas;

  const dst = ctx.createImageData(out, out);

  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const outCentre = out / 2;
  const srcCentre = SRC_TILE / 2;

  for (let oy = 0; oy < out; oy++) {
    for (let ox = 0; ox < out; ox++) {
      // Destination pixel centre, relative to the output centre.
      const dx = ox - outCentre + 0.5;
      const dy = oy - outCentre + 0.5;

      // Inverse-rotate, then undo the fit scale, to land in source space.
      const rx = (dx * cos + dy * sin) / scale;
      const ry = (-dx * sin + dy * cos) / scale;

      const sx = Math.floor(rx + srcCentre);
      const sy = Math.floor(ry + srcCentre);

      const di = (oy * out + ox) * 4;

      if (sx < 0 || sx >= SRC_TILE || sy < 0 || sy >= SRC_TILE) {
        dst.data[di + 3] = 0;
        continue;
      }

      const si =
        ((tileRow * SRC_TILE + sy) * sheetWidth + (tileCol * SRC_TILE + sx)) *
        4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }

  ctx.putImageData(dst, 0, 0);
  return canvas;
}

/** One pre-rendered rotation set: `frames[fit][frameCount][frameIndex]`. */
export type RotationSet = Map<FitMode, Map<FrameCount, Texture[]>>;

function textureFromCanvas(canvas: HTMLCanvasElement): Texture {
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  return texture;
}

/**
 * Pre-render every (fit mode x frame count) combination for one source tile, so
 * the spike can A/B between them live without a rebuild.
 */
export function prerenderRotations(
  sheet: ImageData,
  sheetWidth: number,
  tileCol: number,
  tileRow: number,
): RotationSet {
  const byFit: RotationSet = new Map();

  for (const fit of FIT_MODES) {
    const byCount = new Map<FrameCount, Texture[]>();

    for (const count of FRAME_COUNTS) {
      if (count === 0) continue;

      const textures: Texture[] = [];
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * 360;
        textures.push(
          textureFromCanvas(
            rotateTile(sheet, sheetWidth, tileCol, tileRow, angle, fit),
          ),
        );
      }
      byCount.set(count, textures);
    }

    byFit.set(fit, byCount);
  }

  return byFit;
}

/**
 * Pick the frame for a heading, quantising display only.
 *
 * With 256-unit byte angles on hardware this is a shift; here the source is
 * degrees, so it's a round and a mask.
 */
export function frameFor(rotationDeg: number, count: FrameCount): number {
  const turns = rotationDeg / 360;
  const i = Math.round(turns * count) % count;
  return i < 0 ? i + count : i;
}

/** Resolve the texture for a heading under the current mode, if one applies. */
export function textureFor(
  set: RotationSet,
  rotationDeg: number,
): Texture | undefined {
  if (!snesMode.enabled || snesMode.frames === 0) return undefined;
  const textures = set.get(snesMode.fit)?.get(snesMode.frames);
  if (textures === undefined) return undefined;
  return textures[frameFor(rotationDeg, snesMode.frames)];
}

/** Read the sheet's pixels once, so rotation can sample them directly. */
export async function loadSheetPixels(
  url: string,
): Promise<{ data: ImageData; width: number }> {
  const image = new Image();
  image.src = url;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx == null) throw new Error('2D context unavailable');

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);

  return {
    data: ctx.getImageData(0, 0, image.width, image.height),
    width: image.width,
  };
}

/** Keeps TextureSource defaults honest if something re-registers them. */
export function enforceNearest(): void {
  TextureSource.defaultOptions.scaleMode = 'nearest';
}

/** Human-readable summary for the HUD. */
export function describe(): string {
  if (!snesMode.enabled) return 'snes [ ] off';
  const frames = snesMode.frames === 0 ? 'cont' : String(snesMode.frames);
  return `snes [x] ${frames}f ${snesMode.fit}`;
}
