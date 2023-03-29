# Pixel Art Smoother Canvas

This repo demonstrates _a_ method to achieve smoother movement on a canvas.

When you can afford to have a 4x larger canvas when compared to the size of the assets, you have finer movement granularity. You're _assets_ are scaled up to appear low-res on a higher definition canvas resolution.

You'll typically notice really jittery movement at lower speeds. These game loops are locked at 60 fps. Each ship is moving at 60 pixels per second in x and 30 pixels per second in y.

There are two canvases in this demo:

- Left: 512x512 canvas width/height, 512x512 canvas DOM element width/height
  - Smoother movement
- Right: 128x128 canvas width/height, 512x512 canvas DOM element width/height
  - This is CSS scaling
