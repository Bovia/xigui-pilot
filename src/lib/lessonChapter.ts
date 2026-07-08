/** 从课名前缀提取章号，如「23.1 新型消费…」→ 23；导学课（0.x）返回 null */
export function lessonChapterNo(title: string): number | null {
  const t = title.replace(/\s/g, "");
  if (/^0/.test(t)) return null;
  const m = t.match(/^(\d+)\./);
  if (!m) return null;
  const ch = Number(m[1]);
  return ch > 0 ? ch : null;
}
