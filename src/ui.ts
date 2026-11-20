// 终端显示：颜色、文字宽度、工具调用提示、权限确认
// 每种样式用自己的"关闭码"结束（而不是全部重置），这样样式可以嵌套：比如加粗的标题里有一段代码
const ansi = (on: number, off: number) => (s: string) => (process.stdout.isTTY ? `\x1b[${on}m${s}\x1b[${off}m` : s);
export const c = {
  bold: ansi(1, 22),
  dim: ansi(2, 22),
  italic: ansi(3, 23),
  underline: ansi(4, 24),
  strike: ansi(9, 29),
  red: ansi(31, 39),
  green: ansi(32, 39),
  yellow: ansi(33, 39),
  cyan: ansi(36, 39),
};

export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

// 一个字符在终端里占几格：中文、全角符号、大部分 emoji 占 2 格，组合符号占 0 格
export function charWidth(code: number) {
  if (code === 0x200b || code === 0x200d || (code >= 0x0300 && code <= 0x036f) || (code >= 0xfe00 && code <= 0xfe0f)) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd) ||
    [0x231a, 0x231b, 0x23f0, 0x23f3, 0x2614, 0x2615, 0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26d4, 0x2705, 0x2728, 0x274c, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797, 0x2b50, 0x2b55].includes(code)
  ) {
    return 2;
  }
  return 1;
}

// 一段文字在终端里占几格（忽略颜色代码）
export function textWidth(s: string) {
  let width = 0;
  for (const ch of stripAnsi(s)) width += charWidth(ch.codePointAt(0)!);
  return width;
}

// 按显示宽度截断（用于补全菜单，保证每项只占一行）
export function truncateWidth(s: string, max: number) {
  if (textWidth(s) <= max) return s;
  let out = "";
  let width = 0;
  for (const ch of stripAnsi(s)) {
    const w = charWidth(ch.codePointAt(0)!);
    if (width + w > max - 1) break;
    out += ch;
    width += w;
  }
  return out + "…";
}

export const termColumns = () => process.stdout.columns || 80;

// 记录光标是否在行首，避免工具提示和文字挤在同一行
let atLineStart = true;

export function write(text: string) {
  if (!text) return;
  process.stdout.write(text);
  atLineStart = text.endsWith("\n");
}

export function newline() {
  if (!atLineStart) write("\n");
}

// 把工具参数缩成一行，方便学生看到 Agent 在"动手"做什么
export function printToolCall(name: string, rawArgs: string) {
  let summary = rawArgs;
  try {
    const args = JSON.parse(rawArgs || "{}");
    summary = args.command ?? args.path ?? args.filename ?? args.query ?? args.url ?? (Object.keys(args).length ? JSON.stringify(args) : "");
  } catch {}
  if (summary.length > 80) summary = summary.slice(0, 80) + "…";
  newline();
  write(c.dim(`  🔧 ${name}${summary ? ` ${summary}` : ""}`) + "\n");
}

export function printConfirm(title: string, detail: string) {
  newline();
  write(c.yellow(`\n⚠️  导师想要：${title}\n`));
  write(c.dim(detail.replace(/^/gm, "  │ ")) + "\n");
}
