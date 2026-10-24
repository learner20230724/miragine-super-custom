# Verification boundaries / 已知验证边界

This is a runnable **preview**, not a claim of exact Flash parity.
当前是可运行预览版，不宣称已与 Flash 逐帧、逐像素完全一致。

## Native-resolution source — v0.5.0-preview.1 / 原生分辨率源码

This section describes implementation, not a completed release or performance
claim. v0.4 and earlier reports below remain historical evidence for their versions.
本节描述源码实现，不代表新版已经发布或性能验收通过；下方 v0.4 等旧报告仅证明各自版本。

- **Logical versus physical:** stage layout remains 640×480 logically; combat remains 30 Hz.
  Visible backing pixels follow the fitted CSS viewport and DPR. Ground keeps
  its original 640×400 logical projection but rasterizes at the matching density;
  the complete low-resolution stage is no longer enlarged as a final bitmap.
  **逻辑与实际像素分离：**舞台 640×480 坐标、战斗 30 Hz 不变，实际绘图尺寸随视口与 DPR；
  地面逻辑投影仍是 640×400，但以对应密度绘制，不再放大完整低分辨率舞台位图。
- **Finite source detail:** original PNGs, animation poses, scenery and rules
  are unchanged. Native rasterization avoids an intermediate resolution ceiling,
  not the original artwork's finite detail; it is neither AI upscaling nor proof
  of exact Flash pixels. Large sprite magnification can still look pixelated.
  **原素材细节有限：**PNG、动画姿势、背景与规则不改；移除中间画布分辨率瓶颈
  不等于恢复原图没有的细节，不是 AI 放大或 Flash 像素一致。角色极度放大仍可能模糊／像素化。
- **Native-path edge differences:** local transparent cursor layers and Canvas
  sampling can differ slightly in edge antialiasing from the unoptimized native
  trial. Static icons/cards can also show small raster differences; this is not
  changed source art or proof of numeric-text deformation. That trial is not a
  Flash oracle, and exact per-pixel identity is not claimed.
  **原生路径边缘差异：**局部透明光标层与 Canvas 采样可能相对未优化原生试验版
  产生细微抗锯齿差异，静态图标／卡片也可能有少量栅格差；不是原素材更换，不能
  据此称数字变形。试验版不是 Flash 对照，不宣称逐像素完全一致。
- **Work and memory:** native targets cost more pixels. Ground uses one cached
  revision, not an accumulating camera cache; cropped HUD caches release obsolete
  pixel buffers on resize/screen transitions. These bounds do not guarantee lower
  process memory or faster FPS. GPU/browser maximum surface sizes remain limits;
  unsupported native ground allocation fails instead of silently lowering quality.
  **成本与边界：**原生目标像素更多；地面只缓存一个版本，HUD 用紧凑区域并在尺寸／
  页面变化时释放旧像素缓冲，不保证进程总内存下降或 FPS 增加。仍受 GPU／浏览器
  画布尺寸限制；无法分配原生地面时明确失败，不偷偷降分辨率。
- **Input and timing:** mouse hit testing remains CSS-to-logical, without an
  extra DPR factor. Resize invalidates presentation even during pause, never
  changing rules or advancing a paused simulation. 240 FPS remains a target.
  **输入与计时：**鼠标按 CSS→逻辑转换，不再乘 DPR；暂停时 resize 只重绘不推进逻辑。
  240 FPS 仍是目标，不能把提交频率、RAF 回调或 CPU 耗时当作物理显示帧率。

See [implementation / 开发说明](native-resolution.zh-CN.md) and
[English](native-resolution.en.md). Final artifacts require their own browser,
portable, source-integrity, privacy and same-runtime performance evidence.
最终包需独立的浏览器、便携版、源码一致性、隐私与同运行时性能证据。

## Settings reorganization — v0.4 source / 设置重组源码

- **No automatic editor pause:** F2 is the only settings entry; opening/closing
  does not pause/resume. Pause lives beside speed, with view/fullscreen below;
  crisp clickable HUD text replaces the lower-left bitmap controls.
  **不自动暂停：**F2 是唯一设置入口，开关面板不改变暂停；倍速与暂停同区，
  视角／全屏在下方，左下角改用清晰可点击文字。
- **Live versus draft:** home-page resources are current-state edits; home-page
  rule edits apply only that field. Unit/AI pages remain explicit drafts. Starting
  values and automatic behaviors on the starting page affect only new matches.
  **实时与草稿分开：**首页资源改当前状态，规则只应用对应字段；兵种／AI 仍需
  明确应用，开局页数值和自动行为只对新局生效。
- **Numeric boundaries, not balancing caps:** custom integer resources use
  0–9,007,199,254,740,991 with saturated arithmetic. Excess complete numeric input
  clamps before confirmation; JSON import stays strict. Probability, valid IDs,
  positive timers and finite floating-point bounds remain meaningful constraints.
  Extreme floats are finite but not infinitely precise or guaranteed useful.
  **数值边界而非平衡额度：**整数资源扩至安全整数上限，运算饱和不回绕；输入
  超上限即时收束，JSON 仍严格验证。概率、合法 ID、正计时与有限浮点边界保留；
  极端浮点值不代表无限精度或有意义玩法。每轮收入上限不是持有金币余额上限。
- **No 100/500 troop cap:** batched spawning is cancellable, but original combat
  includes roughly quadratic scans. Huge armies can still stall or exhaust memory;
  neither a batch scheduler nor an 8 ms between-step budget can preempt one slow
  complete simulation step. This is not unlimited-capacity or 20× performance proof.
  **取消单次 100／总量 500 限制：**分批生成可取消，但战斗含近似二次增长扫描，
  巨量军队仍可能卡顿／耗尽内存；分批与 8 ms 步间预算无法打断一个慢逻辑步。
- **AI is a configurable table, not learning:** each difficulty has independent
  thresholds/candidates. Changing stats does not relearn counters. Original strict
  comparisons and counter-only elite counting remain defaults, not fixed limits.
  **AI 是可调规则表：**每档阈值与候选独立，改数值不会自动学克制；原严格比较
  和仅反制分支统计精英保留为默认，不再是不可修改限制。
- **Compatibility and evidence:** v1 presets migrate to v2 side-specific profiles
  without auto-activation; the original core/evidence remain separate. Old reports
  below verify their named historical versions, not this source or a future archive.
  **兼容与证据：**旧 v1 预设迁移为 v2 双方配置但不自动启用，原核心／证据分离；
  下方旧报告仅证明各自版本，不替代本源码及新包验证。

## Historical original-pixel sampling — v0.3.0-preview.2 / 历史原始素材轻量采样

- One-pass sprite sampling and the original larger effect bitmaps improve how
  retained pixels are used, not their original artistic detail. Sampling differs
  from the legacy intermediate-raster path; no Flash pixel equivalence is claimed.
  单次角色采样及原始较大特效位图只改善已有像素的利用，不恢复不存在的美术细节；
  与原中间栅格路径采样不同，不宣称 Flash 逐像素一致。
- In that release, stage/ground buffers remained 640×480 / 640×400. Mountains, trees and grass are
  unchanged; their source resolution and fullscreen scaling remain limitations.
  No AI, new renderer, model runtime or 2×/4× texture pack is introduced.
  该历史版本舞台／地面缓冲为 640×480／640×400，山、树、草地未更换；原图分辨率及全屏
  拉伸仍有限制。未引入 AI、新引擎、模型运行时或 2×／4×贴图包。
- Twenty-five byte-identical source images add 46,676 compressed bytes and
  about 2.37 MiB for one decoded RGBA copy, excluding browser/GPU duplication.
  Source mode removes sprite raster canvases, but does not promise lower total
  memory, increased FPS or a zero-cost improvement. Submission microbenchmarks
  are not end-to-end game or GPU/display performance measurements.
  新增原样图片压缩共 46,676 字节，单份 RGBA 解码约 2.37 MiB，未计浏览器／GPU
  副本；不再建立角色栅格画布，但不承诺总内存一定下降、帧率提高或零额外开销。
  绘制命令提交微测不是整局、GPU 或屏幕性能证明。

## Historical settings preview — v0.3.0-preview.1 / 历史设置预览版

These notes describe that historical source, including its now-removed troop caps. Package verification must be
recorded for its actual commit and archive; old baseline/v0.2.0 reports are not
proof that this version's new controls, persistence or portable build passed.
以下描述历史源码的边界，含现已取消的兵量限制；安装包须对实际提交及压缩包验证。旧基线／v0.2.0 报告
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
