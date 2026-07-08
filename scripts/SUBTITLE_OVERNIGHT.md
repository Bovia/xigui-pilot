# 过夜字幕批量任务计划（M1 Mac）

## 当前状态（2026-07-07）

| 项目 | 数量 |
|------|------|
| 基础课 mp4 | 82 |
| 专题课 mp4 | 5 |
| 已有完整 .srt | 1（第 1 节，全片约 7 分钟生成） |
| **待生成** | **约 86 节** |

M1 + `base` 模型：全片约 **7～15 分钟/节** → 全部跑完约 **10～20 小时**（建议分 1～2 晚）。

---

## 下班前 3 分钟检查

1. **插电**
2. **系统设置 → 电池 → 电源适配器**  
   - 打开「接电源时防止电脑自动进入睡眠」
3. 确认已安装依赖（只需一次）：
   ```bash
   python3 -m pip install --user faster-whisper static-ffmpeg
   ```
4. 终端执行下面「一键命令」
5. **可以锁屏**；尽量不要让 Mac **睡眠**（合盖未接电常会睡）

---

## 一键命令（复制到终端）

```bash
cd ~/Projects/xigui-pilot && chmod +x scripts/overnight_subtitles.sh && ./scripts/overnight_subtitles.sh
```

- 自动 `caffeinate` 防睡眠  
- 跳过已有**完整**字幕（第 1 节会跳过）  
- 日志：`~/Desktop/系规/subtitle-batch.log`

---

## 第二天早上怎么看结果

```bash
tail -30 ~/Desktop/系规/subtitle-batch.log
```

或 Finder 打开 `01：基础课视频（已完结）`，看是否多了很多 `.srt`。

---

## 可选：只跑一部分（今晚跑不完时）

```bash
# 只跑前 20 节
caffeinate -dims python3 ~/Projects/xigui-pilot/scripts/batch_generate_subtitles.py --limit 20

# 只跑基础课（默认已包含 01+02+03）
# 强制重做某一节
python3 scripts/generate_subtitle.py "/path/to/视频.mp4" --model base
```

---

## 资源预期（M1）

| 项目 | 预期 |
|------|------|
| 模型磁盘 | ~150 MB（base，只下一份） |
| 全部 .srt | 几 MB |
| 转写时 CPU | 高负载，风扇可能转 |
| 转写时内存 | ~1～2 GB |
| 播放时 | 无额外消耗 |

---

## 失败 / 中断

- **中断后重跑同一命令即可**：已完成的 `.srt` 会自动跳过  
- 某节失败会记在日志末尾「失败列表」，可单独重跑该 mp4

---

## 生成后怎么用

双击桌面「系规助手」→ 设置打开「桌面悬浮字幕」→ 播放任意有 `.srt` 的课节即可。
