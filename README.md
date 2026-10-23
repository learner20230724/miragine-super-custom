# 超级米拉奇战记 · 自定义改版工程

[English](README.en.md)

独立改版仓库，基于 [原版重建工程](https://github.com/learner20230724/miragine-super-rebuild) 的 `8554d89713456368378738744bfeb32ec41c2689` 提交建立，原仓库及其 Release 不动。新增 **1／2／4／8 倍速、独立最高 240 FPS 显示目标、斜视角滚轮缩放、拖动、一键全图与恢复跟随**；原始核心逻辑、数值和素材保留。旧验证记录属于继承的 preview.2 基线，改版验证另行记录。

以 **Flash 超级版**为基准的可修改 JavaScript 工程，保留恢复源码、原始素材及数据来源。不是 JKS 重制版，也不是 C++ 网络对战版。

**可运行预览版**：战斗逻辑从恢复的 AS3 手工移植到 JavaScript，使用 Canvas / WebGL 渲染，不需要 Flash 或 SWF 播放器。原版插桩对照的一局普通难度共 6,842 帧逻辑状态匹配；这不代表全部 Adobe Flash 场景或逐像素一致。具体交付状态见[验证记录](docs/verification.json)。

## Windows 启动包

在 **[改版 Releases](https://github.com/learner20230724/miragine-super-custom/releases)** 下载 Windows x64 预览包，完整解压后双击 `Start-Game.cmd` 或 `MiragineSuper.exe`。启动包自带运行环境，不需要安装 Node.js、Python 或 Flash；请勿将改版覆盖到原版目录。

包外的 `config/custom.json` 可直接编辑，重启生效；升级前请备份此文件。`ui-helper/` 提供可替换的绘图源码及说明。`build-info.json` 标明对应源码提交。改版见 [改版验证记录](docs/custom-verification.json)，继承的原版保真结果见 [基线验证](docs/verification.json)，尚存差异见 [已知问题](docs/known-issues.md)。

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
| I / J / K / L | 移动视角 |
| 战场滚轮 | 以鼠标位置为锚点缩放，边界处优先保持镜头范围 |
| 战场鼠标右键／中键拖动 | 拖动观察镜头，不影响战斗判定 |
| 游戏内 1×／2×／4×／8× | 整体游戏时间倍速，双方同时生效 |
| 游戏内「全图」／「跟随」 | 全景显示整张战场／恢复原版跟随视角 |
| 游戏内「显示上限」 | 选择 30／60／120／240 FPS 目标，不改变逻辑步长 |
| Esc | 打开退出对局确认 |
| F11 | 全屏 / 退出全屏 |

菜单提供单人四档难度与同机双人；本项目目前没有网络对战。

### 性能

**改版：**每个游戏秒仍是 30 个原版逻辑步；2×／4×／8×分别在每个真实秒尝试执行 60／120／240 步。画面独立刷新并对位置和镜头插值；原动画姿势仍来自有限张原素材。工具条分别显示目标倍率、实际模拟步数和实际画面提交频率；240 是上限目标，受显示器、硬件及兵力影响，不保证锁定。菜单、观察操作和音乐仍按真实时间运行。

可复用模块及其他游戏的接入方法见 [时间控制工具](docs/time-control.zh-CN.md)；它是源码层 SDK＋适配器，不是任意 EXE 的免适配加速器。下方 preview.2 性能数字仅属于原版重建基线。

**preview.2** 修复进入对局后的持续卡顿。同机最大化、DPI 1.5 实测：普通战场 **4.77 → 28.74 FPS**，兵种提示 **5.05 → 28.44 FPS**（最终画布提交频率）。仍有少量迟帧，不保证所有硬件锁定 30 帧；完整条件见 [性能报告](https://github.com/learner20230724/miragine-super-rebuild/releases/download/v0.1.0-preview.2/performance-comparison.json)。

战斗逻辑保持原版 **30 Hz**；静态按钮阴影、未变化的血条与结果页按需缓存，不再每次屏幕刷新都重新做整屏滤镜。数字、鼠标提示、选兵脉冲和过渡动画仍更新，不降低素材分辨率。性能剖析可在独立解压的测试副本上运行：

```sh
node tools/profile-desktop.mjs --dir <测试副本目录> --out .local/performance.json
```

工具通过实际菜单进入对局，分别记录普通战场与兵种提示场景；浏览器回调频率、最终画布提交频率与 30 Hz 模拟帧率单独记录，不能混为一谈。

## 修改数值

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
| `src/runtime/` | 可复用固定步长时钟、显示调度与呈现插值；游戏接线在 `src/app/playback-session.mjs` |
| `src/render/` | 战场、透视投影、地面与人物渲染 |
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
