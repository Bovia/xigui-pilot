export function quizChapterHint(title: string): string {
  const t = title.replace(/\s/g, "");
  if (/^0/.test(t)) return "导学 · 章节练习";
  const m = t.match(/^(\d+)\./);
  if (m) return `第 ${m[1]} 章练习`;
  return "章节练习";
}

export function quizTooltip(title: string, miniProgramName: string) {
  return {
    label: `打开「${miniProgramName}」`,
    detail: `建议：${quizChapterHint(title)}`,
  };
}
