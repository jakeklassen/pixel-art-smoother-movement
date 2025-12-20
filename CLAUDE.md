# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript + Vite educational project demonstrating smoother pixel art movement on HTML5 Canvas. It compares two rendering approaches:

- **4x Upscaled Canvas**: Uses a 512x512 canvas for 128x128 game resolution, enabling sub-pixel positioning for smoother movement
- **CSS Scaled Canvas**: Uses native 128x128 canvas scaled via CSS, resulting in jittery movement

## Commands

```bash
pnpm dev       # Start Vite dev server with hot reload
pnpm build     # TypeScript check + Vite production build
pnpm preview   # Preview production build locally
```

## Architecture

### Game Loop Pattern

The game uses a fixed timestep loop (60 FPS, 16.67ms per frame) with a delta time accumulator for frame-rate independence. Position updates use bitwise OR (`| 0`) for integer conversion when rendering to maintain pixel-perfect alignment.

### Canvas Rendering Strategy

Two IIFE-wrapped game instances run in parallel for visual comparison. Key techniques:

- `imageSmoothingEnabled = false` for crisp pixel art
- Custom DOMMatrix2DInit identity matrices for transform control
- The 4x upscale approach allows fractional positions to create smoother apparent movement while still rendering to integer pixels

### Source Structure

- `src/main.ts` - Main game loop, canvas setup, and rendering logic
- `src/lib/asset-loader.ts` - Promise-based image loading utility
- `src/lib/screen.ts` - Screen resolution scaling calculations
- `src/assets/` - Sprite images and fonts

### Key Dependencies

- **Tweakpane** - UI controls for runtime parameter adjustment
- **Vite** - Build tool and dev server (handles TypeScript transpilation)
