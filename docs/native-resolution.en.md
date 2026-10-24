# Native-window-resolution rendering

[中文](native-resolution.zh-CN.md) · [Time control](time-control.en.md) · [Settings](custom-settings.en.md)

This guide describes the native-resolution source work for `0.5.0-preview.1`, not a claim that this version is published or faster. Verification and release status belong to their corresponding records.

## What changes—and what does not

The visible game canvas now renders at the fitted window size multiplied by the display's device-pixel ratio (DPR). It no longer finishes a whole frame in a fixed 640 × 480 bitmap and then enlarges that bitmap to fill the window.

**640 × 480 remains the logical coordinate system**, not a fixed rendering resolution. The battlefield still occupies its original logical 640 × 400 area. Simulation remains **30 logic steps per game second**; resolution changes do not alter unit values, collision coordinates, camera rules, animation timing or speed controls. The original oblique projection is retained.

Original PNG files are unchanged. Characters/effects sample their preserved source pixels directly; ground and background textures also retain their original content. There is no AI enhancement, invented high-definition artwork or extra animation detail. A larger output target avoids one whole-frame enlargement stage, but cannot restore details absent from an original bitmap. Large zoom levels may still reveal pixels or soft resampling.

## Logical size, CSS size and physical pixels

The viewport adapter fits the 4:3 game stage inside the available game area without cropping. Opening the settings dock changes that available area; fullscreen and resizing recalculate the fit. Any unused space remains letterboxed.

For a fitted CSS size `W × H`:

```text
backingWidth  = max(1, round(W × devicePixelRatio))
backingHeight = max(1, round(H × devicePixelRatio))
renderScaleX  = backingWidth / 640
renderScaleY  = backingHeight / 480
```

The visible canvas uses those integer backing dimensions. Drawing commands continue to use logical coordinates through the corresponding transform. The actual rounded dimensions determine the transform, avoiding errors from assuming that `CSS scale × DPR` is always exact.

For example, a fitted 1280 × 960 CSS-pixel stage at DPR 1.5 uses a 1920 × 1440 backing canvas while game coordinates remain 640 × 480. These dimensions refer to the **fitted game stage**, not necessarily the entire monitor or window, which may also contain the dock or letterbox bars.

The app responds to window/stage changes, fullscreen changes and DPR changes when moving between monitors. Resizing invalidates presentation, including while paused; it does not step or resume the simulation.

## Battlefield and ground

Sprites and backgrounds draw into the transformed destination context rather than a completed low-resolution stage. Source sprite placement still preserves logical dimensions, clipping and foot anchors.

The WebGL ground renderer separates its logical **640 × 400 projection** from its physical drawing buffer. Its output density follows the destination canvas. Fractional ground pixel coverage rounds upward, except for floating-point noise around an exact integer. This avoids leaving an uncovered edge without changing world geometry, UV coordinates or the perspective calculation.

Both follow mode and free/overview observation use **one current ground cache entry**, not an ever-growing cache for every camera position:

1. An exact key includes render dimensions, camera/view values, terrain identity and geometry.
2. On a miss, the ground is rendered once and copied at the same pixel dimensions into the owned cache surface.
3. On a hit, that surface is reused without repainting the ground. Unit movement is not part of the terrain key.
4. A size change resizes and invalidates the existing cache. Camera/zoom or terrain changes produce a new revision rather than accumulating old images.

The existing WebGL program and texture objects are reused across size changes. Unsupported render dimensions or original texture sizes produce an error rather than silently falling back to a smaller, enlarged render target. Browser/GPU limits still apply.

## HUD and cache memory

HUD drawing uses the same physical-pixel density as the destination. Static HUD regions, changing numbers and health bars use cropped cache surfaces instead of allocating a full high-resolution stage for every small item. Cache bounds align to physical pixels, and composition maps them back into logical coordinates at matching density.

When the output size changes or a screen transition invalidates raster caches, old buffers are explicitly released and rebuilt as needed. This avoids retaining obsolete large menu/results/HUD images after resizing. The clear pause/help/quit controls remain DOM text rather than part of a stretched bitmap.

Additional changes reduce unnecessary native-density work without lowering resolution:

- **Component-sized title filters:** original parent shadows, color transforms, sliding and masks remain, but filtering runs on cropped component canvases. Toggling music affects only its small component cache, not the entire title screen.
- **Original static HUD placements:** static symbols draw in their recovered order and full placement matrices, avoiding the parent's empty full-canvas filter passes for already-hidden numeric children.
- **Two local selection-cursor slots:** one per side, drawing the complete original `sprite209` at the same native pixel density as the main canvas, with its original time, scale pulse and child transparency. An unchanged revision is reused; changed state redraws the slot, rather than accumulating per-frame canvases or enlarging a low-resolution finished cursor.
- **Visible original background tiles only:** finite repeated `drawImage` submissions replace a heavily transformed `CanvasPattern`, retaining the original PNG, repeat period, translation anchor, clipping rectangle and nearest-neighbor sampling. No enlarged source image or low-resolution background cache is created. This describes the implementation, not proof of exact pixels across native drawing paths.

These changes stay in handwritten runtime adapters; generated drawing files, original assets, core rules and 30 Hz simulation are unchanged. Actual performance differences require this version's same-condition measurements, not an inferred speedup from the cache design.

Local transparent-layer compositing and Canvas sampling can introduce small edge-antialiasing differences relative to the unoptimized native-rendering trial. This does not mean original assets changed, and pixel-identical before/after output is not claimed.

Native-resolution targets still cost memory: doubling both physical dimensions gives four times as many pixels. Compact caches and ground reuse reduce unnecessary work; they do not make larger output buffers free.

## Why clicking still aligns

Pointer events provide **CSS-pixel** client coordinates. Input conversion subtracts the fitted stage's client origin, then scales into the logical 640 × 480 area. It **does not multiply input coordinates by DPR**.

Clicks outside the fitted stage return no game coordinate instead of being clamped onto an edge button. Wheel zoom, drag input, minimap interaction and logical HUD hit areas therefore share the same viewport mapping regardless of backing resolution. Resolution is a rendering concern, not a new game-coordinate system.

## Performance and inspection

30/60/120/240 FPS settings remain **presentation targets, not guaranteed rates**. Monitor refresh, browser scheduling, output size, DPR, army size and GPU/CPU load all affect achieved performance. Native output may require more rendering work than the old fixed-size target; no performance improvement follows merely from its larger dimensions.

Keep requested speed, actual simulation steps/second and presentation submissions/second separate. For development inspection, the read-only `window.__MIRAGINE__.getState()` includes `viewport`, `presentationStats` and rendering statistics. The presentation fields report logical/backing dimensions and UI cache pixels. Submission counts and CPU submission time are not interchangeable with GPU completion or measured on-screen refresh rate.

Compare the same scene, camera, window size, DPR, display target and game speed when evaluating changes. A screenshot alone establishes neither frame pacing nor simulation parity; release verification must cover those separately.

## Source entry points

| File | Responsibility |
|---|---|
| [`src/platform/viewport.mjs`](../src/platform/viewport.mjs) | Aspect-preserving CSS fit, rounded backing dimensions and CSS-to-logical pointer conversion |
| [`src/app/main.mjs`](../src/app/main.mjs) | Visible native-resolution canvas, resize/DPR handling and presentation measurements |
| [`src/app/view.mjs`](../src/app/view.mjs) | Logical HUD drawing, density-aware cropped caches and buffer release |
| [`src/render/battlefield.mjs`](../src/render/battlefield.mjs) | Source sprites, backgrounds and destination-density ground integration |
| [`src/render/ground-webgl.mjs`](../src/render/ground-webgl.mjs) | Unchanged logical projection with a physical-resolution WebGL drawing buffer |
| [`src/render/ground-layer-cache.mjs`](../src/render/ground-layer-cache.mjs) | Exact, single-entry projected-ground cache and same-size copying |

The recovered core, generated defaults and original assets remain separate from these presentation changes.
