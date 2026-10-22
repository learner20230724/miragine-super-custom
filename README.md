# 超级米拉奇战记 · 源码重建

[English](README.en.md)

以 **Flash 超级版**为基准的可修改 JavaScript 工程，保留恢复源码、原始素材及数据来源。不是 JKS 重制版，也不是 C++ 网络对战版。

**开发中（WIP）**：战斗逻辑手工移植到原生 JavaScript，使用 Canvas / WebGL 渲染；运行游戏不需要 Flash 插件或 SWF 播放器。完整对局逐帧一致性、Windows 成品包安装及发布验收仍需分别验证，不宣称已完成一比一复刻。

## 本地运行

需要 Git、**Node.js 22.12 或更新版本**及 npm；重新生成数据与素材还需要 Python 3。首次安装依赖和 Electron 需要联网。

```sh
git clone https://github.com/learner20230724/miragine-super-rebuild.git
cd miragine-super-rebuild
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
| Esc | 打开退出对局确认 |
| F11 | 全屏 / 退出全屏 |

菜单提供单人四档难度与同机双人；本项目目前没有网络对战。

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

Windows x64 本地打包命令为 `npm run build:windows`，输出到 `dist/` 下独立的构建目录。**命令存在不代表已发布或通过安装验收**；发布包与对应测试结果应以仓库后续记录为准。

## 归属与许可

原游戏内容、第三方组件与本项目代码的许可边界见 **[NOTICE.txt](NOTICE.txt)**。这是独立源码重建项目，不是原作者发布的开源工程；不要将整个仓库中的素材和恢复代码视作统一 MIT 授权。
