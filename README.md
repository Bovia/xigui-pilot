# 系规助手 (xigui-pilot)

macOS 菜单栏备考助手：今日任务 + 内置视频续播。

## 开发

```bash
cd ~/Projects/xigui-pilot
pnpm install
pnpm gen:plan          # 从 ~/Desktop/系规 扫描视频，生成 public/plan.json
pnpm tauri dev         # 启动开发模式（热更新）
```

首次运行：点菜单栏图标 → 选择资料根目录（如 `~/Desktop/系规`）→ 点击任务播放。

## 数据

- `public/plan.json` — 16 周计划（脚本生成，随 app 打包）
- `~/Library/Application Support/com.bovia.xigui-pilot/settings.json` — 资料根目录
- `~/Library/Application Support/com.bovia.xigui-pilot/progress.json` — 播放进度

## v0.1 范围

- 菜单栏 tray + 320×480 面板
- 今日看课任务 + 本周进度
- ArtPlayer 内置播放（mp4）+ 续播 + 倍速
- mkv / 未下载视频 → 系统播放器或提示
