# 游戏时钟与显示插值

[English](time-control.en.md)

本页描述 custom 仓库当前源码的接入方式，不代表这些改动已发布为新版安装包。
它是**可复用的源码级时钟与呈现工具**，不是给任意 EXE 自动加速的通用修改器，也不是原 SWF 的播放器外壳。

## 在本游戏中使用

对局工具栏提供 **1 / 2 / 4 / 8×**、显示上限 **30 / 60 / 120 / 240 Hz**，以及全图／跟随观察。
倍率只加速对局的模拟时间；菜单与结算过渡、观察镜头操作使用墙钟时间。
音乐、音效及淡入淡出不随倍率改变播放速度或音调；加速后游戏事件仍可能更密集地触发音效。
当前没有独立的暂停／单步控制，`GameClock` 也没有 `pause()` 或 `singleStep()` API，倍率不接受 0。

本游戏固定 **30 个模拟步 = 1 游戏秒**；不要为提高显示帧率而修改这个规则频率。

| 目标倍率 | 每墙钟秒的目标模拟步数 | 每墙钟秒的目标游戏秒数 |
| --- | ---: | ---: |
| 1× | 30 | 1 |
| 2× | 60 | 2 |
| 4× | 120 | 4 |
| 8× | 240 | 8 |

这是调度目标，不是所有硬件上的吞吐保证。工具栏把目标倍率、实测模拟速率和实测显示速率分开显示。
模拟统计应以实际战斗 `simulation.frame` 为准；时钟的 `gameTimeMs` 只累计已调度的回调，在菜单等无战斗推进阶段不等于战斗时间。

## 模拟与显示分别调度

- **模拟：**每次回调仍执行一个完整原规则步，包括招募、移动、攻击、碰撞及随机数逻辑；不通过跳过这些规则来提速。切换倍率不重缩已经积累的小数余量。
- **显示：**单独选择显示目标，最高 240 Hz；每个 `requestAnimationFrame` 最多呈现一次，错过的显示时隙不补画。显示器刷新率、浏览器调度、GPU／CPU 负载仍限制实际速率；非整除刷新率下，间隔可能不均匀。
- **插值：**在前后两个模拟快照之间混合连续位置和镜头，只生成呈现副本，不写回模拟。保持当前绘制顺序、动作姿态、HP 和可见性；出生、移除、动作切换、死亡等不连续处直接使用当前状态。它不会增加原素材的动作帧，且最多引入一个模拟步的视觉延迟。
- **卡顿：**默认先把一次墙钟增量封顶为 **250 ms**，再乘倍率；超出的墙钟时间丢弃，不无限追赶。接受预算内仍逐步执行，不跳模拟规则。
- **后台：**`advance(now, { hidden: true })` 当次接受的墙钟时间为 0、不绘制，并保留已有小数余量。本游戏适配层在隐藏、恢复两次 `visibilitychange` 时均同步零推进时钟，避免完全暂停 RAF 后把后台时间补进战斗。其他游戏接入时也需处理可见性切换，不能只依赖后台 RAF。

## 代码入口与最小接入

| 入口 | 职责 |
| --- | --- |
| [`src/runtime/index.mjs`](../src/runtime/index.mjs) · [API 说明](../src/runtime/README.md) | 不依赖 DOM 的 `GameClock` 与插值函数；时钟支持其他正有限 `stepHz`，显示目标支持 `(0, 240]` |
| [`src/app/playback-session.mjs`](../src/app/playback-session.mjs) | 本游戏适配器：按步采样输入、调用 controller、保存快照／镜头、换局重置快照 |
| [`src/app/custom-controls.mjs`](../src/app/custom-controls.mjs) | 倍率、显示上限和观察控制 UI |
| [`src/app/main.mjs`](../src/app/main.mjs) | RAF、真实时间音频／观察控制和实际呈现的连接 |

下面是放在项目根目录入口模块中的 **15 行示例**。`capture`、`simulateOneTick`、`render` 是接入游戏自行提供的函数，不是 SDK 内置 API。
`capture()` 返回符合插值字段约定的实体数组；`simulateOneTick()` 每次只推进一个固定游戏步。

```js
import { GameClock, interpolateSnapshots } from './src/runtime/index.mjs';
let before = capture(), after = before;
const clock = new GameClock({ now: performance.now(),
  stepHz: 30, renderHz: 120, step() {
    before = after; simulateOneTick(); after = capture();
  } });
function frame(now) {
  const state = clock.advance(now, { hidden: document.hidden });
  if (state.render) {
    render(interpolateSnapshots(before, after, state.alpha));
  }
  requestAnimationFrame(frame);
}
clock.setSpeed(2);
requestAnimationFrame(frame);
```

`setSpeed(1|2|4|8)` 只改变后续游戏时间积累；`setRenderHz(rate)` 只改变显示节奏；`invalidate()` 请求更新画面，但不绕过显示上限。
`step(wallNow)` 收到的是墙钟时间戳而非 `dt`；同一次 RAF 追赶的多个步收到相同时间戳。
需要镜头插值时使用 `interpolateRenderState`；主动切镜可传 `cameraCut: true`。新对局／UID 重用时必须重置两份快照；结束或停止推进时应合并前后快照，避免末尾位置反复插值。

## 接到其他游戏／引擎

1. 找到唯一的固定步入口，确认单位与原始规则频率。不要同时保留引擎自己的模拟循环又由本时钟再推进一遍，也不要同时加速 `dt` 和步数。
2. 写该游戏的 adapter：输入采样、单步模拟、稳定实体 ID、位置快照、镜头和场景切换重置。当前插值器使用 `uid`、`px/py/pz` 及动作等连续性字段，不是任意引擎对象的通用插值器；其他字段结构需转换或另写呈现插值。
3. 明确分开游戏计时、菜单／网络计时和音频策略。已有 Phaser／其他引擎时优先接它的官方时钟接口，并分别核对动画、物理、计时器；服务端权威时间不会被本地倍率改变。
4. 在目标游戏中实测输入、换局、死亡、卡顿、后台恢复与目标／实际速率。源码接入点可复用，具体适配和验证不可省略。

## 现成项目如何取舍

以下仅作方案对照，当前工具不依赖它们，也不提供进程注入或反作弊绕过实现。

| 项目／官方依据 | 能解决什么 | 本项目选择与许可 |
| --- | --- | --- |
| [Cheat Engine Speedhack 源码](https://github.com/cheat-engine/cheat-engine/blob/master/Cheat%20Engine/bin/autorun/SpeedhackV3.lua) | 对部分系统时间 API 的读数进行缩放，不等于提升计算／渲染性能，也不保证所有游戏可用 | 不引为依赖、不复制实现。[官方 FAQ](https://www.cheatengine.org/faq.php) 将其描述为源码可见，但不授予公开发布自改版本的许可；不能笼统标为 GPL |
| [libTAS 原理](https://clementgallet.github.io/libTAS/guides/how/) | GNU/Linux 上的确定性时间、逐帧与回放控制；不是通用 Windows 游戏运行库 | 适合作研究／测试参考，不引入当前 Electron 运行时；[GPL-3.0-or-later 源文件声明](https://github.com/clementgallet/libTAS/blob/v1.4.8/src/library/DeterministicTimer.cpp) |
| [Phaser `Time.Clock`](https://docs.phaser.io/api-documentation/class/time-clock) | `timeScale` 缩放该 Clock 的 TimerEvents，不自动加速整套物理／动画／音频 | 已用 Phaser 的游戏优先适配官方接口；本项目不为一个时钟引入整套引擎；[MIT](https://github.com/phaserjs/phaser/blob/v4.2.1/LICENSE.md) |

本仓库各部分的授权范围见 [`NOTICE.txt`](../NOTICE.txt)，不因这份时钟说明而改变。
