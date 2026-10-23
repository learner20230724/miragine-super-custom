# Verification boundaries / 已知验证边界

This is a runnable **preview**, not a claim of exact Flash parity.
当前是可运行预览版，不宣称已与 Flash 逐帧、逐像素完全一致。

## Settings preview — v0.3.0-preview.1 / 设置预览版

These notes describe the new source boundaries. Package verification must be
recorded for its actual commit and archive; old baseline/v0.2.0 reports are not
proof that this version's new controls, persistence or portable build passed.
以下描述新源码的边界；安装包须对实际提交及压缩包验证。旧基线／v0.2.0 报告
不是本次新增设置、持久化或独立包已通过测试的证明。

- **Speed is a target:** 0–20× retains 30 complete original steps per game
  second. 20× requests 600 steps per real second; army size and CPU/scheduling
  limits can reduce actual speed. It does not promise 600 FPS, 240 FPS or better
  computational performance. The panel reports measured simulation/display rates.
  **倍率是目标：**0～20 倍仍保留每游戏秒 30 个完整原步；20 倍目标为每真实秒
  600 步。兵量、CPU 和调度限制可能降低实际倍速，不保证 600 FPS 或 240 FPS，
  也不是增加机器算力。面板分别显示实测模拟和显示速率。
- **Responsive catch-up, not unlimited debt:** above 1×, accelerated batches
  stop after 24 complete steps or an 8 ms between-step work budget. Excess
  whole-step time demand is discarded, not replayed later; game frames and RNG
  only advance through actual complete steps. One slow step cannot be preempted.
  Original 1× behavior is unchanged by this added guard.
  **有限追赶，不无限积债：**大于 1 倍时，单批最多 24 完整步，或到步间检查的
  8 ms 软预算后停止。过期整步时间需求丢弃，不留待补算；战斗帧与 RNG 只随实际
  完整步推进，不跳到未来状态。单个慢逻辑步不能中断；1 倍不受新增预算改变。
- **Explicit custom mode:** edits/load/import are drafts until explicitly
  applied. Live application preserves current resources, countdown and existing
  cooldowns; some fields take effect only on a new round/recruit/match. It also
  sets subsequent-match rules for this run. Saved presets are not match saves.
  **明确自定义：**修改／载入／导入先进入草稿，须主动应用。应用本局不重置当前
  资源、倒计时和已有冷却；部分字段等到新轮次／招募／新局，同时设置本次运行的
  后续新局规则。保存的预设不是战斗进度存档。
- **Custom safety limit:** once custom rules or sandbox actions are enabled,
  troop generation is capped at 500 entities including remaining death animations;
  each manual spawn is limited to 100. This is an explicit customization, not a
  recovered original army limit. Untouched original matches do not gain this cap.
  **自定义安全限制：**主动应用自定义或执行沙盒操作后，生成上限为 500 个兵种
  实体（含未移除的死亡动画），单次手动最多 100。这是改版保护，不是原版军队
  上限；未启用自定义的原版对局不添加该限制。
- **Draft persistence, not automatic activation:** desktop drafts/presets use
  `userdata/custom-settings.json`; browser storage is origin-scoped. Restored
  drafts never automatically become active rules. Speed, display cap, pause and
  camera are not stored in rule presets; startup uses 1×. Save failures show a
  warning, keep the in-memory draft exportable and must not be treated as success.
  **保存草稿，不自动启用：**桌面使用 `userdata/custom-settings.json`，浏览器按
  站点来源保存。重启载入草稿不自动应用；规则预设不包含速度、显示上限、暂停或
  镜头，启动使用 1 倍。保存失败显示警告，内存草稿仍可导出，不能视为已落盘。
- **Compact overview:** full crystal sprites are framed close to opposite
  edges, retaining the original oblique view. Exterior decoration or near map
  corners can fall outside this framing. Wheel zoom-out and the development
  `fitMap()` API remain available; F11 fullscreen is a separate action.
  **紧凑全景：**完整水晶图片靠近两端，保留原斜视角，外围装饰或近侧地图角点
  可能在画外。可滚轮继续缩小，开发接口 `fitMap()` 仍保留；F11 全屏是另一操作。
- **Sound is presentation:** music keeps wall-time playback. Dense effects can
  be coalesced/dropped under the concurrency and deduplication bounds, never
  queued for replay. Pausing stops current effects, not music. These choices do
  not change combat events or RNG.
  **音效属于呈现：**音乐按真实时间；密集音效会因并发／去重限制合并或丢弃，
  不排队补播。暂停停止当前音效，不暂停音乐；不改变战斗事件或随机数。

See the [settings guide](custom-settings.en.md) /
[设置说明](custom-settings.zh-CN.md) for application timing and backup locations.

## Historical custom preview — v0.2.0-preview.1 / 历史改版预览

The following boundaries concern the custom source changes; the historical
baseline verification notes below do not automatically validate new features.
以下是 custom 改动的边界；下方保留的历史基线验证不自动覆盖新增功能。

- **Display target, not a lock:** 240 Hz is the selectable upper target, not a
  measured guarantee of 240 presentations per second. Actual cadence depends on
  the monitor, browser scheduling and CPU/GPU load. The original finite PNG
  animation poses remain; position/camera interpolation does not create new poses.
  **显示目标而非锁帧：**240 Hz 是可选上限，不代表实测锁定 240 帧。实际节奏受
  显示器、浏览器调度及 CPU/GPU 负载限制；仍使用原素材有限的 PNG 动作姿势，
  位置／镜头插值不会增加动作姿势。
- **Numeric UI cache:** across 23 UI fixtures compared with direct drawing,
  RGB differences reached 2/255 in some cases; alpha, interaction hotspots and
  simulation frame were exact. This is consistent with 8-bit compositing
  rounding, but that cause has not been proved. Neither strict RGBA equality
  (allowance 0) nor the previous allowance of 1/255 passed. The custom check uses
  an explicit 2/255 RGB allowance, not a pass of, or a relaxation to, the old
  baseline gate. This fixture check is not a full-game Flash pixel-parity claim.
  **数字 UI 缓存：**23 个 UI 测例相对直接绘制，部分 RGB 通道最多相差 2/255；
  alpha、交互热点与模拟帧完全相同。现象与 8 位合成舍入相符，但原因尚未证明。
  严格 RGBA 一致（容差 0）及旧 1/255 容差均未通过；custom 使用显式 2/255
  RGB 容差，不冒称旧基线通过，也不据此放宽旧基线门槛。这不是全游戏 Flash
  逐像素一致性的证明。
- **Source-level integration:** the runtime clock is connected through this
  game's adapter. Other games need their own step/input/snapshot/audio adapters;
  it is not a universal accelerator for arbitrary EXEs. See the
  [time-control guide](time-control.en.md).
  **源码级接入：**当前时钟通过本游戏适配层连接；其他游戏仍需适配单步、输入、
  快照和音频，不是任意 EXE 的万能加速器。见[时钟说明](time-control.zh-CN.md)。
- **Wall-time presentation:** menu/result transitions, observation controls and
  audio playback/fades use real time rather than the selected match multiplier.
  Faster game events can nevertheless trigger sounds more frequently.
  **真实时间呈现：**菜单／结算过渡、观察控制及音频播放／淡入淡出按墙钟运行，
  不跟随对局倍率变速；更密集的游戏事件仍可能更频繁地触发音效。

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
