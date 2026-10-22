# Original-SWF oracle / 原版运行时对照工具

**Reference testing only. Production does not execute Ruffle or an SWF.**

本目录用于把恢复出的 AS3 游戏逻辑放回一个明确标记的测试 SWF 副本，在现代 Ruffle 中记录状态，再与独立 JavaScript 引擎逐帧对比。不是用播放器包装冒充重建，也不把模拟器验证称为 Adobe Flash 完全一致。

## What changes / 插桩改了什么

- `reference/super-original.swf` stays byte-identical to SHA-256 `6cd4a86045d828517c5eaabacfa04ae16719733778f8b20b3c855e5f03df7149`.
- `instrument_original.py` recompiles only the recovered `DragonForce` class in a **local test copy**. All 23 `Math.random()` call sites return the explicit test value `0.5`; an observer serializes state after each original simulation step.
- No unit stats, health, damage, money, population, attack timings, AI choices, winning conditions, or reinforcements are changed or forced. The same constant random input is supplied to the independent core.
- The optional Ruffle frame-rate override accelerates execution only; original simulation parameters remain in their original frame units. This test does not establish real-time rendering or audio parity.
- Original files, the modified SWF, downloaded runtime, browser profile, screenshots, raw JSONL traces, and local reports are never published by this workflow. Generated test artifacts stay under ignored `.local/oracle/`.

原文件不变；仅测试副本的 23 处随机输入固定为 0.5，并加后置观察器。没有改兵种属性，没有强制胜负。加速执行不是游戏加速功能或流畅度证明。

## Reproduce / 复查

Prerequisites: project dependencies, Node.js, Python 3, Java 8+, and the project's pinned portable FFDec (`python tools/prepare_ffdec.py`). No obsolete Adobe browser plugin, global installation, account, or credential is needed.

```text
python -B tools/oracle/prepare_runtime.py
python -B tools/oracle/instrument_original.py --max-frames 20000
node tools/oracle/serve.mjs
```

1. Open `http://127.0.0.1:61981/` to inspect the **unmodified** baseline. Take reference screenshots separately from instrumented observations.
2. For a streamed normal-difficulty match, open `http://127.0.0.1:61981/stream/normal-rng05-rate240-v1/240` in an independent browser context. Use a fresh session name for another run: the server refuses to overwrite an existing trace file.
3. Choose single-player, choose **Normal**, dismiss the tutorial, and leave the default recruit selection unchanged. The match must reach its own winning condition.
4. The server writes `<session>.trace.jsonl` and `<session>.comparison.json` in `.local/oracle/`. It holds only bounded diagnostic samples in memory. Browser trace arrays are also bounded in streaming mode.
5. Replay the retained source trace in a fresh Node process after any core fix. This captures current core hashes rather than accidentally reusing a long-running server's cached JavaScript modules:

```text
node tools/oracle/replay_stream.mjs .local/oracle/normal-rng05-rate240-v1.trace.jsonl
```

The authoritative replay report is `.local/oracle/<session>.replay.comparison.json`. It records matching-frame counts, the first divergence, terminal health/winner, the source JSONL digest, the fixture digest, the default-config digest, and individual core-file digests. A missing terminal result is **not** a completed-match validation.

The legacy `compare_trace.mjs` reads an array-form trace captured by the initial 2,400-frame experiment. It is optional; use streamed JSONL for long runs. All comparators use the production core, not an injected alternate sorting implementation.

服务仅绑定 `127.0.0.1:61981`，与生产页面使用不同端口、进程和浏览器上下文。不要用全局 `kill-all` 或按进程名批量结束浏览器；只关闭自己启动的 oracle 会话。

## Compared state / 比较范围

- Frame/countdown, pause flag, difficulty/mode, both selection arrays.
- Gold, income, manpower budgets, victory countdown, and crystal health.
- Ordered live Scene children: kind, side, unit ID, world position/height, facing/scales, action, animation progress, HP/maxHP, and attack delay/lifetime/visibility.
- Camera coordinates. Numeric tolerance is an explicit absolute `1e-7`.

AS3 `JSON.stringify` turns nonfinite numbers into `null` and omits `undefined`; JavaScript observations use the same serialization representation. Private fields are not directly observed, although their consequences are tested over successive frames.

## Findings and limits / 已知结论与边界

The first experiment found a real difference at frame **1,038**: JavaScript's stable sort did not reproduce AVM2 `Array.sortOn` equal-depth ordering. The original P-code confirmed numeric-descending sorting followed by reverse `addChild` traversal. Replacing the stable sort with the source-backed AVM2 QuickSort made all **2,400 / 2,400** observed frames match, including **640** frames containing attacks and up to **79** Scene objects. The production fix carries its upstream license/attribution separately.

A subsequent **natural complete match** on Normal difficulty reached a source-side victory at frame **6,842**, with red crystal HP **3,500** and blue HP **0**. Replaying those observations against the fixed production core matched **6,842 / 6,842** frames, including **5,342** frames containing attacks and up to **250** Scene objects. No health, unit, or economy values were edited to force that result. This run used the explicitly instrumented constant-0.5 random fixture and Ruffle's 240-FPS execution override; original simulation constants retained their 30-FPS frame units. The raw UTF-8 JSONL trace contains **110,923,193 bytes** and has SHA-256 `8614744bc59827642052ea8a1828d3ae1f49380d2d049c0ef8893d885e267f5c`.

随后普通难度的自然整局在第 **6,842** 帧自行结束，红方基地 **3,500 HP**、蓝方 **0 HP**；生产核心回放 **6,842 帧全部相符**。这是一场固定随机输入、加速执行的 Ruffle 观察结果，不是未插桩原文件的全随机整局证明。完整机器可读摘要见 [verification.generated.json](verification.generated.json)。

This finite observation is not proof of all inputs, every difficulty, Adobe VM equality, bitmap/Perlin-noise filtering, audio timing, UI tweening, or all random sequences. A single constant-random fixture is a controlled test vector, not the original random distribution. Compact shareable evidence is separate from local raw traces.

## Primary sources / 官方依据

- [Pinned Ruffle 0.7.1 release](https://github.com/ruffle-rs/ruffle/releases/tag/v0.7.1), web archive SHA-256 `ef12edbee135d581a9cd523837d746da30a07a64dbf1cf472d2e472c656f4b5e`.
- [Ruffle public player API](https://ruffle.rs/js-docs/master/interfaces/Player.PlayerV1.html): set `traceObserver` after `load()` resolves. No generic MovieClip inspection API is assumed.
- [Load options](https://ruffle.rs/js-docs/master/interfaces/Config.BaseLoadOptions.html): `frameRate` explicitly overrides and locks emulator execution pacing.
- [Ruffle 0.7.1 AVM2 array implementation](https://github.com/ruffle-rs/ruffle/blob/v0.7.1/core/src/avm2/globals/array.rs): original-compatible QuickSort, with upstream Adobe avmplus reference.
- [FFDec CLI](https://github.com/jindrapetrik/jpexs-decompiler/wiki/Commandline-arguments): script import into an explicitly separate output file.
