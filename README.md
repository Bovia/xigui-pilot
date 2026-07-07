# 系规助手 (xigui-pilot)

macOS 菜单栏视频资料库：**动态扫描文件夹 → 播放 → 续播**。

> **分支**：`feature/dynamic-catalog`（实验版）。稳定计划版见 `main`。

> **平台**：仅 macOS。Tauri 2 + React，从菜单栏图标打开面板。

## 功能（本分支）

- 选择一个资料库根目录，**递归扫描** mp4 / mkv / mov 等视频
- 按**子文件夹**分组展示，无需 `plan.json`
- 内置播放 mp4，续播、倍速；其他格式 → 系统播放器
- 观看进度按**相对路径**写入 `progress.json`（换目录后路径变了进度不继承）
- 固定窗口、织物质感、护眼提醒

**不含**：16 周计划、今日任务、教材跳页、刷题。

## 日常使用

1. 打开 App → 设置 → **选择资料目录**
2. 在列表中点 **播放**
3. 资料有变动时：设置 → **重新扫描**

## 开发

```bash
cd ~/Projects/xigui-pilot
git checkout feature/dynamic-catalog
pnpm install
pnpm tauri dev
```

打包：

```bash
./scripts/update-desktop-app.sh
```

## 数据

| 文件 | 说明 |
|------|------|
| `settings.json` | 资料根目录、窗口固定、织物质感 |
| `progress.json` | 键为相对路径，如 `01：基础课/[01]--….mp4` |

扫描规则：跳过隐藏文件；视频按所在文件夹分组；标题从文件名解析（去掉 `[01]--` 前缀）。

## 技术栈

React 19 · Tailwind 4 · Tauri 2 · ArtPlayer
