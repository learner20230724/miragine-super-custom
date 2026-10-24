# 超级米拉奇战记 · 自定义改版工程

[English](README.en.md)

独立改版仓库，基于 [原版重建工程](https://github.com/learner20230724/miragine-super-rebuild) 的 `8554d89713456368378738744bfeb32ec41c2689` 提交建立，原仓库及其 Release 不动。提供 **0～20 倍速、手动暂停、F2 设置、红蓝独立兵种／水晶编辑、实时资源修改、可取消的分批刷兵、四难度 AI 参数和预设**，以及独立最高 240 FPS 显示目标和原斜视角紧凑战场全景。原始规则、默认参数和素材保留；自定义行为由明确操作启用。旧验证记录只覆盖各自版本。

以 **Flash 超级版**为基准的可修改 JavaScript 工程，保留恢复源码、原始素材及数据来源。不是 JKS 重制版，也不是 C++ 网络对战版。

**可运行预览版**：战斗逻辑从恢复的 AS3 手工移植到 JavaScript，使用 Canvas / WebGL 渲染，不需要 Flash 或 SWF 播放器。原版插桩对照的一局普通难度共 6,842 帧逻辑状态匹配；这不代表全部 Adobe Flash 场景或逐像素一致。具体交付状态见[验证记录](docs/verification.json)。

**当前版本：v0.5.0-preview.1 原生窗口分辨率绘制。** 舞台布局仍用 640×480 逻辑坐标，战斗逻辑保持 30 Hz，画布实际像素按游戏视口及屏幕 DPR 绘制，不再先画完整 640×480 位图再放大。原 PNG 与规则不变；[实现与开发入口](docs/native-resolution.zh-CN.md)。

## Windows 启动包

在 **[改版 Releases](https://github.com/learner20230724/miragine-super-custom/releases)** 下载 Windows x64 预览包，完整解压后双击 `Start-Game.cmd` 或 `MiragineSuper.exe`。启动包自带运行环境，不需要安装 Node.js、Python 或 Flash；请勿将改版覆盖到原版目录。

当前已发布 **[v0.5.0-preview.1](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.5.0-preview.1)**，对应运行源码 `c6e8185d`。**663 项源码测试、96 项正式 EXE 交互、41 项原生绘制交互和 9 项原 PNG 独立采样对照通过**，[Windows／Linux CI](https://github.com/learner20230724/miragine-super-custom/actions/runs/40067660803) 通过。便携包实际启动两次，设置、输入、预设保留和原生画布已检查，0 运行异常；ZIP 全新解压、源码逐字节比对和隐私审计通过。远端 21 个附件的 API 大小与 SHA-256 均与本地一致，未另做完整远端重下载。详见 [本版交付记录](docs/releases/v0.5.0-preview.1.json) 与 Release 附件。包内 README 保留运行源码提交时的发布状态；后续验收工具提交 `820c7728` 的 665 项测试单独记录，不改变或重新打包运行代码。

历史 **[v0.4.0-preview.2](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.4.0-preview.2)** 的单行底栏、统一应用及 606／93／94 项检查保留于 [该版交付记录](docs/releases/v0.4.0-preview.2.json)，不替代新版验收。

历史 **[v0.4.0-preview.1](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.4.0-preview.1)** 的设置重组及 597／75／76 项检查保留于 [该版交付记录](docs/releases/v0.4.0-preview.1.json)，不替代新版验收。

历史 **[v0.3.0-preview.2](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.3.0-preview.2)** 对应 `c1dcb85`，原始图片采样及旧设置交互验证保留在 [该版交付记录](docs/releases/v0.3.0-preview.2.json)，不替代新版验证。

历史 **[v0.3.0-preview.1](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.3.0-preview.1)** 对应 `75e4c6f`，471 项源码测试、97 项 EXE 交互和额外 10 轮暂停／继续记录保留于 [该版交付记录](docs/releases/v0.3.0-preview.1.json)，不用于替代新版验证。

包外的 `config/custom.json` 可直接编辑，重启生效，设置面板不会改写它。桌面草稿与预设保存在 `userdata/custom-settings.json`，恢复后仍须明确应用；升级前请备份这两个文件。`ui-helper/` 提供可替换绘图源码；`build-info.json` 标明对应源码提交。继承的原版保真结果见 [基线验证](docs/verification.json)，尚存差异见 [已知问题](docs/known-issues.md)。

v0.5.0-preview.1 运行提交的源码约 **66.09 MB**（含 **11.97 MB** 运行素材），Windows ZIP **170.59 MB**，解压 **402.25 MB**；按十进制 MB 计，不含开发依赖、Git 历史和运行后用户数据。20 倍与 240 FPS 都是目标，不是性能保证。

建议解压到较短的目录；过深的 Windows 路径可能使 Chromium 的本地运行数据初始化失败。运行后产生的 `userdata/` 和 `.tmp/` 是本机数据，不属于发布内容。“从此不再显示帮助”保存在 `userdata/preferences.json`，跨重启保留；删除此文件即可恢复初始帮助。

## 本地运行

需要 Git、**Node.js 22.12 或更新版本**及 npm；重新生成数据与素材还需要 Python 3.10 或更新版本。首次安装依赖和 Electron 需要联网。

```sh
git clone https://github.com/learner20230724/miragine-super-custom.git
cd miragine-super-custom
npm ci --ignore-scripts
npm run setup:electron
npm start
```

Windows PowerShell 如遇 npm 脚本执行策略限制，可将 `npm` 换成 `npm.cmd`。

只在浏览器中开发时，无需安装 Electron 二进制：

```sh
npm run dev
```

打开终端显示的地址，默认是 **http://127.0.0.1:51286/**。更换端口可用 `npm run dev -- --port 51287`；不要直接双击 `index.html`。停止开发服务器按 `Ctrl+C`。浏览器可能需要第一次点击或按键后才播放声音。

### 操作

| 操作 | 功能 |
|---|---|
| 鼠标点击兵种 | 选择兵种 |
| W / A / S / D | 左方选择兵种 |
| 空格 | 左方切换自动招募 |
| 方向键、Enter | 同机双人模式中右方选兵、切换招募 |
| 拖动小地图 | 移动视角 |
| I / J / K / L | 按世界距离移动；默认横跨红蓝水晶约 4 个真实秒，与缩放和倍率无关 |
| 战场滚轮 | 以鼠标位置为锚点缩放，边界处优先保持镜头范围 |
| 战场鼠标右键／中键拖动 | 拖动观察镜头，不影响战斗判定 |
| F2 | 唯一设置入口；展开／收起都不改变暂停状态，宽窗口并排、窄窗口上下排列 |
| 左下角文字「暂停游戏／继续游戏」 | 手动暂停／继续；与下方「游戏帮助」「退出游戏」一样是清晰可点击文字 |
| 设置中的速度滑块／数值框 | 0～20 倍，步进 0.1；0 暂停，1 原速，0.1～0.9 慢动作 |
| 设置中的时间区 | 倍速与横向「暂停游戏／继续游戏」按钮放在一起 |
| 下方视角区「自由观察」／「全图」／「跟随」 | 手动观察／紧凑战场全景／恢复原版跟随视角 |
| 设置中的「显示上限」 | 选择 30／60／120／240 FPS 目标，不改变逻辑步长 |
| Esc | 设置展开时先收起设置；否则打开退出对局确认 |
| F11／视角区「全屏」 | 全屏 / 退出全屏，与「全图」调整镜头不同 |

菜单提供单人四档难度与同机双人；本项目目前没有网络对战。

### 性能

**当前源码按窗口原生像素绘制**：640×480 只是逻辑坐标，实际主画布尺寸按游戏视口的 CSS 大小 × DPR 取整；地面保留 640×400 逻辑投影，但使用对应密度的 WebGL 画布和单项缓存。HUD 使用按实际像素对齐的紧凑缓存，窗口／DPR 改变时释放旧缓冲。鼠标继续由 CSS 坐标转换到逻辑坐标，不再额外乘 DPR；暂停时改变窗口也会重绘，不推进逻辑。

本轮同机、同 Electron 44.4.3、相同 3273×2455 画布与 128 名士兵加两座水晶的五场景短测（各约 4 秒）：旧 v0.4.0-preview.2 约 **4.26～5.30 次画面提交／秒**，本轮冻结源码约 **48.99～49.60 次／秒**，动态 1 倍场景逻辑约 **29.88 步／秒**。这是短时源码对照，不是显示器实测 FPS、正式包持续性能或所有机器保证；随机种子和外部桌面负载未锁定。9 项冻结角色对照与同原图的一次直接采样参考一致，不等于整个 UI／Flash 逐像素一致；[条件与边界](docs/releases/v0.5.0-preview.1.json)完整保留。

原素材没有新增细节，极度放大的角色和背景仍受原 PNG 分辨率限制；这不是 AI 高清化。像素面积增加也会增加绘制和显存成本，不保证 FPS 提升或锁定 240 FPS。缓存只避免重复工作，不代表没有内存开销。验证方法与代码入口见 [原生分辨率说明](docs/native-resolution.zh-CN.md)。

**保留原始素材采样**：角色仍直接从原 PNG 投影，跳过一次 0.9 倍中间画布重采样，但保留原逻辑尺寸、脚点、裁切和动画时序。此前雷球、风暴接入的 25 张 SWF 原有较大位图仍原样保留，共 46,676 字节，风暴最后的透明空帧也保留。本轮只改变绘制目标密度，不重画、AI 放大或覆盖山景、草地、角色帧及人工配置。显示增强不等于 Flash 逐像素一致，渲染器仍保留 `spriteRasterMode: 'legacy'` 对照路径。原素材生成检查用 `python -B tools/build_source_effects.py --check`。

设置默认收起，没有常驻的「设置 F2」按钮。F2 展开后可边打边调，开关面板都不会暂停／继续战斗；暂停完全由玩家操作。「全图」让完整红蓝水晶图片靠近画面两侧，减少外围空地，不保证所有地图角点可见；仍可滚轮继续缩小。

每个游戏秒仍是 **30 个完整原版逻辑步**；20 倍目标是每真实秒 **600 步**，不是 600 FPS，也不保证各种兵量和机器都能达到。画面独立刷新并对位置和镜头插值；原动画姿势数量不变。设置中分别显示目标倍率、实际模拟步数和实际画面提交频率；240 是显示上限目标。菜单、观察操作和音乐按真实时间运行；密集音效限流合并，不排队补播。

本游戏的实现与边界见 [时间控制](docs/time-control.zh-CN.md)；当前只做游戏内控制，不提供其他游戏的通用外置加速器。下方 preview.2 性能数字仅属于原版重建基线。

**preview.2** 修复进入对局后的持续卡顿。同机最大化、DPI 1.5 实测：普通战场 **4.77 → 28.74 FPS**，兵种提示 **5.05 → 28.44 FPS**（最终画布提交频率）。仍有少量迟帧，不保证所有硬件锁定 30 帧；完整条件见 [性能报告](https://github.com/learner20230724/miragine-super-rebuild/releases/download/v0.1.0-preview.2/performance-comparison.json)。

战斗逻辑保持原版 **30 Hz**；静态按钮阴影、未变化的血条与结果页按需缓存，不再每次屏幕刷新都重新做整屏滤镜。数字、鼠标提示、选兵脉冲和过渡动画仍更新，不降低素材分辨率。性能剖析可在独立解压的测试副本上运行：

```sh
node tools/profile-desktop.mjs --dir <测试副本目录> --out .local/performance.json
```

工具通过实际菜单进入对局，分别记录普通战场与兵种提示场景；浏览器回调频率、最终画布提交频率与 30 Hz 模拟帧率单独记录，不能混为一谈。

## 修改数值

当前版本保留 v0.4.0-preview.2 引入的单一应用按钮。

**推荐先用 F2 面板**：

- **当前战局／基础**：红蓝状态并列；金币、每轮收入、剩余人口、水晶当前生命／上限／攻击属性和通用上限可直接修改，按 Enter 或离开输入框生效。清场直接选红方、蓝方或双方。
- **兵种**：同一兵种的红蓝参数并列独立编辑，随后明确应用；不会改一方就连另一方一起改。
- **开局设置**：开局金币、收入、首轮人口与等待等集中在此，当前资源不被重置。
- **难度／AI**：四档直接展开，可改反制概率、收入／金币／兵量阈值、候选集合、克制表与强制选兵规则。
- **预设／文件**：命名预设、撤销、默认草稿、JSON 导入／导出；载入、保存、导入都不自动应用。

整数资源上限为 **9,007,199,254,740,991**（JavaScript 安全整数）；输入超上限时直接收束到最大值，不等确认时再报超限。「每轮收入上限」限制招募带来的每轮收入，不是手持余额上限。取消旧的单次 100／总数 500 刷兵限制，改为分批生成、显示进度、可取消；这不代表机器能承受任意兵量。详细范围与生效时机见 **[自定义设置](docs/custom-settings.zh-CN.md)**。

底部将「撤销」「恢复原版默认」「应用设置」放在一排，只有一个应用按钮：有对局时立即应用可生效的草稿规则，开局项留到下局；没有对局时设置下局规则，不自动开始游戏。首页字段仍即时生效，底部应用可提交其他未应用草稿。生命上限修改统一保持生命比例，不再显示生命策略选择；已有冷却、当前倒计时与现有资源不重置。原游戏没有建筑建造、主动技能、固定波次或条件增援，不虚构对应控制。

### 电脑为什么这样选兵？

单人局每轮发钱后，蓝方按难度概率进入「反制」或「普通随机」分支。反制分支统计红方主力，查固定候选表随机选兵；普通分支按收入选择随机候选集合。最后再检查金币或精英数量阈值，满足时强制覆盖为指定兵种。原默认为蓝方金币 **>15030**，或本次反制分支统计到红方 14／15 号兵总数 **>2**，强制选大领主；不是“超过两万”。阈值、候选表和开关现在都可按难度调整。它不会自动根据改过的兵种伤害／护甲重新学习克制关系；[算法、默认值与比较边界](docs/custom-settings.zh-CN.md#ai-选兵逻辑与可调参数)有完整说明。

面板导出的 JSON 是另一种草稿格式，**不要直接覆盖 `config/custom.json`**。已有手工配置方式仍然保留：

编辑 **[`config/custom.json`](config/custom.json)**，刷新页面或重启桌面游戏生效；不要直接修改自动生成的默认配置。

```json
{
  "schemaVersion": 1,
  "profile": "custom",
  "overrides": {
    "units": {"0": {"cost": 15, "hp": 60}},
    "rules": {"incomeLimit": 10000},
    "difficulties": {"3": {"rightStartingIncome": 650}}
  }
}
```

兵种键为菜单 ID `"0"`—`"15"`，不是动画编号 `ss`。对象递归合并，数组整体替换；保留空 `overrides` 可使用原始默认数值。完整的兵种、经济、人力、攻速换算、动画及难度参数见 **[中文参数表](docs/parameters.zh-CN.md)** / [English reference](docs/parameters.en.md)。

## 从哪里改

| 入口 | 用途 |
|---|---|
| `src/core/` | 可无界面测试的模拟、单位、攻击物、场景及 AS3 数值语义 |
| `src/app/` | 菜单、输入、对局流程、声音与界面 |
| `src/runtime/` | 固定步长时钟、显示调度与呈现插值；本游戏暂停／倍速适配在 `src/app/playback-session.mjs` |
| `src/customization/` | 字段／草稿／预设；`runtime.mjs` 为独立改版运行适配，`numeric.mjs` 为安全整数与有限数运算，不改恢复核心 |
| `src/app/settings-panel.mjs`、`custom-storage.mjs`、`game-text-controls.mjs` | 设置面板、持久化、原生清晰文字按钮 |
| `src/render/` | 战场、透视投影、原生像素地面和单项缓存；逻辑投影不随 DPR 改变 |
| `src/platform/`、`desktop/` | 缩放与坐标转换、Electron 桌面适配 |
| `src/config/` | 配置加载、校验与覆盖合并 |
| `config/defaults.generated.json` | 从恢复代码提取的默认参数；自动生成 |
| `config/custom.json` | 自定义覆盖；重新生成不会覆盖此文件 |
| `src/extensions/custom.mjs` | 保留的自定义扩展入口；目前为空，尚无自动挂接的插件系统 |
| `assets/generated/`、`generated/` | 运行素材、素材清单、UI 与配置来源映射；自动生成 |
| `recovered/`、`reference/` | 反编译 AS3、导出资料及校验过的原版 SWF；用于追溯与对照 |
| `tools/`、`tests/` | 提取、生成、打包、公开文件检查与测试 |

原版 SWF 是参考证据，**不是生产版的游戏引擎**；恢复 AS3 也不等于原作者完整的编辑器工程。生产逻辑在 `src/` 中，原版图片、声音、字体及 UI 图形通过生成流程接入。默认配置以超级版为准，新增玩法应与默认规则分开。

## 开发与检查

```sh
npm test
npm run check:data
npm run check:public
```

修改恢复数据后，可重新生成运行数据与素材：

```sh
python -B tools/extract_game_config.py
python -B tools/build_assets.py
python -B tools/build_ui.py
```

上述生成入口只更新约定的生成目录，不应覆盖 `config/custom.json` 或 `src/extensions/`。FFDec 的重新导出入口是 `tools/prepare_ffdec.py` 与 `tools/export_reference.py`，日常改数值和运行无需重新导出。

Windows x64 本地打包命令为 `npm run build:windows`，要求公开源码已提交，输出到 `dist/` 下独立的构建目录。公开包的对应提交、校验值和独立运行测试见 Release 附件及仓库验证记录；本地构建不自动上传。

## 归属与许可

原游戏内容、第三方组件与本项目代码的许可边界见 **[NOTICE.txt](NOTICE.txt)**。这是独立源码重建项目，不是原作者发布的开源工程；不要将整个仓库中的素材和恢复代码视作统一 MIT 授权。
