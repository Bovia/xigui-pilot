# 系规助手 (xigui-pilot)

macOS 菜单栏备考助手：16 周看课计划、内置视频续播、教材与刷题快捷入口。

> **平台**：仅 macOS。Tauri 2 + React，不出现在 Dock，从菜单栏图标打开面板。

## 日常使用

1. 双击桌面 **「系规助手」** 快捷方式（或打开 `src-tauri/target/release/bundle/macos/系规助手.app`）
2. 点菜单栏图标打开面板
3. 首次使用：设置 → **选择资料目录**（如 `~/Desktop/系规`）
4. 点击课节 **播放** 按钮看课；**题** / **书** 打开刷题小程序说明与官方教材

安装包 `*.dmg` 仅用于分发；本机开发更新请直接用桌面快捷方式，**不必**拖进「应用程序」，否则会和构建产物产生两份 App。

## 功能

- 菜单栏托盘 + 420×540 圆角面板，可 **固定窗口**（失焦不隐藏）
- **今日任务**、本周进度、距考试天数
- 课表分组：**基础课** / **案例·论文专题**（专题课仅播放，无题/书）
- ArtPlayer 内置播放 mp4，续播、倍速；mkv 或缺失文件 → 系统播放器
- **题**：复制郑房新一点通小程序链接；**书**：Preview 打开教材并跳转到书签页码
- 护眼提醒（20-20-20，localStorage）
- **织物质感** 可选 UI 主题（设置内开关，写入 settings）
- 设置内 **使用说明**

### macOS 权限

教材跳页需在 **系统设置 → 隐私与安全性 → 辅助功能** 中授权 **系规助手**（用于模拟 Preview ⌥⌘G 跳页）。

## 开发

```bash
cd ~/Projects/xigui-pilot
pnpm install
pnpm gen:plan          # 扫描 ~/Desktop/系规 视频，生成 public/plan.json
pnpm tauri dev         # 开发模式（前端热更新）
```

更新本机桌面 App（改代码后）：

```bash
source ~/.cargo/env    # 若 cargo 不在 PATH
./scripts/update-desktop-app.sh
```

脚本会 `pnpm tauri build` 并更新桌面 alias，指向 `src-tauri/target/release/bundle/macos/系规助手.app`。改完需 **完全退出** 再打开 App。

### 其他脚本

```bash
python3 scripts/generate_textbook_map.py   # 从教材 PDF 书签生成 public/textbook.json
```

## 数据从哪来

当前为 **静态 plan + 本地文件夹**，没有 database，也没有运行时扫描整个资料库。

| 文件 | 说明 |
|------|------|
| `public/plan.json` | 课表、16 周计划、课节元数据（`pnpm gen:plan` 生成，随 App 打包） |
| `public/textbook.json` | 课节 → 教材页码映射 |
| `public/quiz.json` | 刷题小程序名称等 |
| `~/Library/Application Support/com.bovia.xigui-pilot/settings.json` | 资料根目录、教材 PDF 路径、窗口固定、织物质感等 |
| `~/Library/Application Support/com.bovia.xigui-pilot/progress.json` | 按课节编号存的观看进度 |

播放时 Rust 用 `settings.rootDir` + `lesson.videoSubdir` + `lesson.filename` 在磁盘上找 mp4。更新视频文件后需重新 `pnpm gen:plan` 并打包；课节编号不变则进度保留。

资料目录结构示例：

```
~/Desktop/系规/
├── 01：基础课视频（已完结）/     # [01]…mp4 按文件名编号
├── 02：案例、论文专题（26.10录播课）/  # 内部编号 901–905，界面显示 专01–专05
└── 03：官方教材/                 # PDF 教材
```

## 技术栈

- 前端：React 19、Tailwind CSS 4、Vite
- 桌面：Tauri 2（托盘、无边框透明窗口、系统对话框）
- 播放：ArtPlayer

## 平台说明

Windows **未适配**。部分逻辑依赖 macOS Preview、菜单栏托盘与辅助功能；非 mac 代码路径尚未完整实现。主体 UI 与视频逻辑可复用，但需要单独开一轮适配才能发布 Windows 版。
