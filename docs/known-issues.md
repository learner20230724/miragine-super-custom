# Verification boundaries / 已知验证边界

This is a runnable **preview**, not a claim of exact Flash parity.
当前是可运行预览版，不宣称已与 Flash 逐帧、逐像素完全一致。

## Original behavior / 原版行为

- The 16 units, four difficulty profiles, economy, movement, targeting, attacks,
  deaths and victories are ported from the recovered Super-version AS3, with
  source hashes and a port map. Four unmodified, seeded headless matches finish
  naturally. A constant-RNG instrumented AS3 normal match also matches 6,842
  frames in Ruffle; this does not prove all Adobe Flash runtime behavior.
- 原数值与逻辑来自超级版恢复代码；四难度默认模拟均自然结束，未强制胜负。
  固定 RNG 的普通难度插桩 AS3 对照已在 Ruffle 中完成 6,842 帧整局匹配；
  这不是所有 Adobe Flash 对局一致性的证明。
- The observed equal-depth ordering difference was fixed using AVM2 QuickSort.
  Flash Dictionary ties and cross-runtime Math.random sequences remain broader
  verification gates.
  已按 AVM2 QuickSort 修复观察到的同深度排序差异；Flash 字典并列枚举
  和跨运行时随机流仍需更广泛验证。

## Rendering and UI / 画面与界面

- The original Matrix3D projection and perspective-correct ground are ported;
  extracted animation PNGs are not redrawn or resampled on disk. FFDec bounds,
  Flash MovieClip.getRect, 0.9-scale BitmapData rasterization/cropping, filtering
  and edge pixels have not been shown to match pixel-for-pixel.
- 使用原投影与原素材，但 Flash 边界、裁切、栅格化和边缘像素尚未逐像素验收。
- Native menus, help, HUD, sound and local two-player controls run. Remaining
  visual/UI checks include the Perlin-displaced result flag, Flash filter
  rasterization and exact pixel-level event hit boundaries.
- 原版菜单、帮助、HUD、声音与本地双人已接通；结果页波旗、滤镜栅格化及像素级
  事件命中边界尚有未完成的保真项，具体状态以当前验证报告为准。
- Browser audio requires a user gesture. Canvas readback performance warnings
  from the exported graphics helper are observed; they are not game exceptions.
  浏览器需点击后解锁声音；导出绘图 helper 的性能警告不等同于运行错误。

## Development / 开发

- The Windows preview is not code-signed (`NotSigned` in local Authenticode
  inspection). Windows may identify it as an unknown publisher.
  Windows 预览包未做代码签名，本机检查为 `NotSigned`；系统可能提示未知发布者。
- Extract to a short directory path. Deep Windows paths can prevent Chromium
  runtime-data initialization. The portable package bundles its runtime and
  does not require a Node.js, Python or Flash installation.
  请解压到较短目录；过深的 Windows 路径可能影响 Chromium 本机数据初始化。
  启动包自带运行环境，不需要另装 Node.js、Python 或 Flash。

- Original FLA/editor files were not recovered. The editable production project
  is native JavaScript, not a promise that the decompiled AS3 can be recompiled
  unchanged. No network multiplayer is added to the original local modes.
- 未恢复原作者 FLA；可开发运行工程是本项目原生 JavaScript。未添加联网对战。
- New gameplay systems absent from the original must be explicit extensions,
  not invented defaults. Custom files remain separate from generated files.
- 不存在于原版的关卡/波次/主动技能/建筑升级不虚构成默认机制。
