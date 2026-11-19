// 终端显示：颜色、工具调用提示、权限确认
const ansi = (code: number) => (s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: ansi(1),
  dim: ansi(2),
  red: ansi(31),
  green: ansi(32),
  yellow: ansi(33),
  cyan: ansi(36),
};

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
