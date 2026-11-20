// Markdown 渲染：把模型回答里的 **加粗**、# 标题、- 列表、```代码块```、表格等，显示成终端里的样式
// 模型是一个字一个字流式输出的，所以按"行"处理：
// - 已经写完的行：按 Markdown 格式渲染后输出
// - 还没写完的那一行：先显示出来，每来一个新字就擦掉重画（终端里才这样做；输出到文件时只输出写完的行）
import { c, charWidth, stripAnsi, termColumns, textWidth } from "./ui.js";

// ---------- 行内格式：`代码`、**加粗**、*斜体*、~~删除线~~、[链接](网址) ----------
// \* 这类转义写法：先把被转义的字符换成占位字符（Unicode 私用区），免得被当成格式，最后再换回来
const hide = (ch: string) => String.fromCharCode(0xe000 + ch.charCodeAt(0));
const unhide = (s: string) => s.replace(/[\ue000-\ue07f]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xe000));

function inlineText(text: string) {
  return unhide(text
    .replace(/\\([*_`~#>|\\[\]])/g, (_, ch) => hide(ch))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => (label === url ? c.underline(url) : `${c.underline(label)}${c.dim(` (${url})`)}`))
    .replace(/\*\*(.+?)\*\*/g, (_, t) => c.bold(t))
    .replace(/__(.+?)__/g, (_, t) => c.bold(t))
    .replace(/(^|[^*\w])\*(?![\s*])(.+?)(?<![\s*])\*(?!\*)/g, (_, pre, t) => pre + c.italic(t))
    .replace(/~~(.+?)~~/g, (_, t) => c.strike(t)));
}

export function renderInline(text: string) {
  // 先把 `代码` 拆出来：代码里的 * _ 等符号要原样显示，不能当成格式
  return text
    .split(/(`[^`]+`)/)
    .map((part) => (part.length > 1 && part.startsWith("`") && part.endsWith("`") ? c.cyan(part.slice(1, -1)) : inlineText(part)))
    .join("");
}

// 去掉 Markdown 符号、合并成一行纯文字（用于"导师上次说到……"这类一行预览）
export function plainText(markdown: string) {
  return markdown
    .split("\n")
    .filter((line) => !FENCE.test(line) && !TABLE_SEPARATOR.test(line))
    .map((line) =>
      line
        .replace(/^\s*(#{1,6}|>|[-*+](\s+\[[ xX]\])?|\d+[.)])\s+/, "")
        .replace(/^\s*\||\|\s*$/g, "")
        .replace(/\s*\|\s*/g, "  "),
    )
    .map((line) => stripAnsi(renderInlinePlain(line)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderInlinePlain(text: string) {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])\*(?![\s*])(.+?)(?<![\s*])\*(?!\*)/g, "$1$2");
}

// ---------- 整行格式 ----------
const FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?\s*$/;

function renderLine(line: string) {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
    const text = renderInline(m[2]);
    return m[1].length <= 2 ? c.bold(c.underline(text)) : c.bold(text);
  }
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return c.dim("─".repeat(Math.min(40, termColumns() - 1)));
  if ((m = line.match(/^(\s*)>\s?(.*)$/))) return m[1] + c.dim("│ ") + c.italic(renderInline(m[2]));
  if ((m = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/))) return `${m[1]}${m[2] === " " ? "☐" : c.green("☑")} ${renderInline(m[3])}`;
  if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) return `${m[1]}${c.cyan("•")} ${renderInline(m[2])}`;
  if ((m = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/))) return `${m[1]}${c.cyan(m[2] + m[3])} ${renderInline(m[4])}`;
  return renderInline(line);
}

function splitCells(row: string) {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => renderInline(cell.trim()));
}

// 表格要等整张表都收到才能对齐，所以先攒着，表格结束时一起输出
function renderTable(rows: string[]) {
  const body = rows.filter((r) => !TABLE_SEPARATOR.test(r)).map(splitCells);
  const hasHeader = rows.length > 1 && TABLE_SEPARATOR.test(rows[1]);
  const cols = Math.max(...body.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, i) => Math.max(...body.map((r) => textWidth(r[i] ?? ""))));
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - textWidth(s)));
  const lines = body.map((r, i) => {
    const cells = widths.map((w, j) => (j === cols - 1 ? (r[j] ?? "") : pad(r[j] ?? "", w))); // 最后一列不用补空格
    return (hasHeader && i === 0 ? cells.map((x) => c.bold(x)) : cells).join(c.dim(" │ "));
  });
  if (hasHeader) lines.splice(1, 0, c.dim(widths.map((w) => "─".repeat(w)).join("─┼─")));
  return lines;
}

// 模拟终端自动换行，算出一段文字写完后光标往下走了几行（用来擦掉重画）
function rowsAdvanced(startCol: number, text: string, columns: number) {
  let col = startCol;
  let rows = 0;
  for (const ch of stripAnsi(text)) {
    const w = charWidth(ch.codePointAt(0)!);
    if (w === 0) continue;
    if (col + w > columns) {
      rows++;
      col = 0;
    }
    col += w;
  }
  return rows;
}

export class MarkdownStream {
  private partial = ""; // 还没写完的那一行（原文）
  private shown = ""; // 屏幕上正显示着的那一行（渲染后），重画前要擦掉
  private col: number; // 这一行开始时光标在第几列（第一行前面有"导师 › "）
  private inCode = false;
  private table: string[] = [];
  private readonly live = Boolean(process.stdout.isTTY);

  constructor(private readonly out: (s: string) => void, startCol = 0) {
    this.col = startCol;
  }

  push(delta: string) {
    const lines = (this.partial + delta).split("\n");
    this.partial = lines.pop()!;
    for (const line of lines) this.finishLine(line);
    this.drawPartial();
  }

  // 一轮回答结束，或者要显示工具调用提示之前：把手上的内容都输出
  flush() {
    if (this.partial) {
      const line = this.partial;
      this.partial = "";
      this.erase();
      if (TABLE_ROW.test(line)) this.table.push(line);
      else {
        this.flushTable();
        this.out(this.render(line));
      }
    }
    this.flushTable();
    this.col = 0;
  }

  private render(line: string) {
    line = line.replace(/\t/g, "  ");
    if (this.inCode) return c.cyan(line);
    return renderLine(line);
  }

  private finishLine(line: string) {
    this.erase();
    const fence = line.match(FENCE);
    if (fence) {
      this.flushTable();
      this.inCode = !this.inCode;
      // 代码行不加缩进和边框，方便直接复制运行；只在开头结尾各标一行
      this.emit(c.dim(this.inCode ? `┌ ${fence[2] || "代码"}` : "└"));
      return;
    }
    if (!this.inCode && TABLE_ROW.test(line)) {
      this.table.push(line);
      return;
    }
    this.flushTable();
    this.emit(this.render(line));
  }

  private flushTable() {
    if (this.table.length === 0) return;
    const rows = this.table;
    this.table = [];
    for (const line of renderTable(rows)) this.emit(line);
  }

  private emit(rendered: string) {
    this.out(rendered + "\n");
    this.col = 0;
  }

  // 没写完的行：先按目前的样子显示出来（表格行先不显示，等整张表收齐）
  private drawPartial() {
    if (!this.live || !this.partial || (!this.inCode && TABLE_ROW.test(this.partial + "|"))) return;
    if (!this.inCode && FENCE.test(this.partial)) return;
    this.erase();
    this.shown = this.render(this.partial);
    this.out(this.shown);
  }

  // 擦掉屏幕上那一行没写完的内容：光标先移回这一行开头，再清掉后面的所有内容
  private erase() {
    if (!this.shown) return;
    const up = rowsAdvanced(this.col, this.shown, termColumns());
    this.out((up > 0 ? `\x1b[${up}A` : "") + `\x1b[${this.col + 1}G\x1b[J`);
    this.shown = "";
  }
}
