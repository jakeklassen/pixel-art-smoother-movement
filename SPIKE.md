# SNES fidelity spike

Branch: `spike/snes-fidelity` · tracks [snesgine#17](https://github.com/jakeklassen/snesgine/issues/17)

**The question:** does space-drift still _feel_ right under the SNES's actual
display constraints? If it doesn't, the whole snesgine premise is in trouble —
and this branch answers it in an afternoon instead of after a month of engine
work.

## Run it

```bash
pnpm dev     # then open space-drift.html
```

## Controls

| Key             | Does                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `n`             | **SNES mode** on/off. Master switch — also forces whole-pixel and no interpolation, because those aren't preferences on hardware. |
| `k`             | Cycle rotation frames: continuous → 32 → 16 → 8                                                                                   |
| `o`             | Cycle fit mode: `8-clip` → `8-fit` → `16-pad` → `16-2x`                                                                           |
| `i` `p` `c` `m` | Existing toggles (interpolation, sub-pixel, CRT, minimap)                                                                         |

The yellow HUD line shows the current mode.

## What the fit modes mean

The ship art is one 8×8 tile. These are the four ways to rotate it.

| Mode     | Output | Source                     | VRAM per frame | Slivers/line | Trade                                                        |
| -------- | ------ | -------------------------- | -------------- | ------------ | ------------------------------------------------------------ |
| `8-clip` | 8×8    | full size                  | 32 B           | 1            | Cheapest. Corners _would_ clip on diagonals — but see below. |
| `8-fit`  | 8×8    | shrunk to inscribed circle | 32 B           | 1            | No clipping, but loses over half the pixels.                 |
| `16-pad` | 16×16  | 8×8 centred                | 128 B          | 2            | Same on-screen size, no clipping, 4× the VRAM.               |
| `16-2x`  | 16×16  | scaled 2×                  | 128 B          | 2            | Ship twice as large. Stands in for redrawing at 16×16.       |

## Finding: the clipping worry was wrong for this art

I flagged corner-clipping as a reason to prefer 16×16. Measured, it doesn't
happen: `8-clip` keeps **all 42 opaque pixels at every angle**. The ship's
widest row sits at the vertical centre, and an 8-pixel span rotated 45° still
fits inside an 8×8 box (whose diagonal is 11.3). The tile corners are empty, so
nothing is lost.

So `8-clip` is viable and cheap. What's genuinely degraded at 8×8 is _legibility_
— at 45° the shape reads more like a blob than a ship — and that's a human
judgement, which is the point of playing it.

`8-fit` drops from 42 opaque pixels to 20. It's almost certainly the wrong
answer; it's included so you can see how wrong.

## Methodology note

Rotation frames are **pre-rendered with nearest-neighbour sampling**, exactly as
the asset pipeline will, and then blitted. We deliberately do _not_ quantise
`sprite.rotation` — a live rotate happens at display resolution and looks far
smoother than genuine pre-rendered 8×8 pixel art. Testing the easy version would
flatter the result and we'd discover the truth on hardware two months later.

Other constraints simulated in SNES mode:

- Whole-pixel positions, no sub-pixel camera offset
- No render interpolation, one sim step per frame
- Bank-frame cross-fade replaced by a hard swap (no per-sprite alpha on hardware)
- Planet light-wash overlay hidden (per-sprite additive tint has no equivalent;
  on hardware it'd be a palette swap)

The internal heading stays at **full precision**. Only the displayed frame
quantises, so physics, aim and homing remain smooth. This is a visual fidelity
test, not a control test.

## What it does not test

Sprite dropouts, the 15-colour palette limit, VRAM pressure, cycle budget.
Those need real hardware or the engine.

## What to decide

1. Is 16 frames acceptable, or do we need 32?
2. Which fit mode — i.e. does the ship stay 8×8 or become a 16×16 sprite?
3. Does losing sub-pixel and interpolation hurt as much as feared?

The nearest-neighbour rotation pre-renderer in `src/space-drift/snes-mode.ts`
is not throwaway — it's what snesgine#9 needs.
