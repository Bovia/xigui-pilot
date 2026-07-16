export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleInfo {
  path: string;
  format: "srt" | "vtt";
}

const POSITION_KEY = "xigui-subtitle-position";

export interface SubtitlePosition {
  x: number;
  y: number;
}

export function loadSubtitlePosition(): SubtitlePosition | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SubtitlePosition;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveSubtitlePosition(pos: SubtitlePosition) {
  localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
}

function parseTimestamp(raw: string): number {
  const normalized = raw.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return Number(m) * 60 + Number(s);
  }
  return Number(normalized) || 0;
}

function parseTimestampLine(line: string): { start: number; end: number } | null {
  const match = line.match(
    /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}|\d{1,2}:\d{2}(?::\d{2})?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}|\d{1,2}:\d{2}(?::\d{2})?)/,
  );
  if (!match) return null;
  return {
    start: parseTimestamp(match[1]),
    end: parseTimestamp(match[2]),
  };
}

function stripTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function parseSubtitles(content: string, format: "srt" | "vtt"): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;

    let timeLineIdx = 0;
    if (/^\d+$/.test(lines[0])) {
      timeLineIdx = 1;
    }
    if (timeLineIdx >= lines.length) continue;

    const times = parseTimestampLine(lines[timeLineIdx]);
    if (!times) continue;

    const text = stripTags(lines.slice(timeLineIdx + 1).join("\n"));
    if (!text) continue;

    cues.push({
      start: times.start,
      end: times.end,
      text,
    });
  }

  if (format === "vtt" && cues.length === 0) {
    return parseSubtitles(content, "srt");
  }

  return cues.sort((a, b) => a.start - b.start);
}

export function cueAtTime(cues: SubtitleCue[], time: number): SubtitleCue | null {
  for (const cue of cues) {
    if (time >= cue.start && time < cue.end) {
      return cue;
    }
  }
  return null;
}

export function nextCue(cues: SubtitleCue[], time: number): SubtitleCue | null {
  for (const cue of cues) {
    if (cue.start > time) {
      return cue;
    }
  }
  return null;
}

/**
 * 播放器生命周期（猫猫窗用）
 * - none：无播放器（开机陪伴 / 已关视频）
 * - paused：播放器在，但暂停
 * - playing：正在播
 */
export type CatPlayback = "none" | "paused" | "playing";

/**
 * 猫猫模式展示态（仅 catMode=true）
 *
 * | playback | floating | hasCue | view | 画面 |
 * | none/paused | * | * | idle-rest | 趴姿，无气泡 |
 * | playing | off | * | playing-quiet | 坐姿，无气泡 |
 * | playing | on | no | playing-gap | 坐姿，无气泡 |
 * | playing | on | yes | playing-speak | 坐姿 + 字幕气泡 |
 *
 * 关视频 → playback=none，气泡必须消失；猫窗可留下陪伴。
 * 开机自启 → 面板 Ready 后拉猫窗，初始 idle-rest。
 *
 * 护眼（另层，与上表正交）：
 * - 全局一条工时线（localStorage 截止时刻），播↔不播切换不重置
 * - 催促 UI：播放中归播放器卡片；不播归猫气泡；休息共用整屏黑底
 */
export type CatCompanionView =
  | "idle-rest"
  | "playing-quiet"
  | "playing-gap"
  | "playing-speak";

export function resolveCatCompanionView(input: {
  playback: CatPlayback;
  floatingSubtitles: boolean;
  hasCue: boolean;
}): CatCompanionView {
  if (input.playback !== "playing") return "idle-rest";
  if (!input.floatingSubtitles) return "playing-quiet";
  if (!input.hasCue) return "playing-gap";
  return "playing-speak";
}
