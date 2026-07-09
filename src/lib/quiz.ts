/** 从课节标题解析章节 key（同章多节课共用一套题状态） */
export function quizChapterKey(title: string): string {
  const t = title.replace(/\s/g, "");
  if (/^0/.test(t)) return "ch0";
  const m = t.match(/^(\d+)\./);
  if (m) return `ch${m[1]}`;
  return "ch-unknown";
}

export function quizChapterHint(title: string): string {
  const t = title.replace(/\s/g, "");
  if (/^0/.test(t)) return "导学 · 章节练习";
  const m = t.match(/^(\d+)\./);
  if (m) return `第 ${m[1]} 章练习`;
  return "章节练习";
}

export function quizTooltip(title: string, done: boolean) {
  const chapter = quizChapterHint(title);
  if (done) {
    return {
      label: "本章习题已做",
      detail: `点击取消「${chapter}」标记`,
    };
  }
  return {
    label: "标记习题已做",
    detail: `${chapter} · 刷题请自行打开小程序`,
  };
}
