// 解析 Markdown 文件开头的 --- 头部（子 Agent、Skills 的定义文件都用这种格式，和 Claude Code 一样）：
// ---
// name: 名字
// description: 一句话说明
// ---
// 正文……
export function parseFrontmatter(text: string) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return undefined;
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*(\w+)\s*:\s*(.*?)\s*$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2].trim() };
}

// 子 Agent、技能的名字规则：字母、数字、中文、- 和 _
export const NAME_PATTERN = /^[\w一-龥-]+$/;
