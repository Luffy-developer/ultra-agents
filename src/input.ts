// 输入框里的命令补全：像 Claude Code 一样，输入 / 就在下面列出命令和说明，边打字边筛选
//   ↑↓ 选择 · Tab 补全 · Enter 执行 · Esc 关闭
// 原理：拦截 readline 处理按键的函数，每次按键后根据当前输入算出候选项，画在输入行下面
import type { Interface } from "node:readline/promises";
import { c, termColumns, textWidth, truncateWidth } from "./ui.js";

export interface Suggestion {
  value: string; // 选中后输入框里变成什么
  label: string; // 菜单里显示的名字
  description: string;
  hasArgs?: boolean; // 补全后要不要自动加空格，接着补全参数
}

const MAX_VISIBLE = 8;

// readline 处理按键的内部函数（在原型链上，以 Symbol 为名字）
function findTtyWrite(rl: Interface) {
  for (let proto = Object.getPrototypeOf(rl); proto; proto = Object.getPrototypeOf(proto)) {
    const symbol = Object.getOwnPropertySymbols(proto).find((s) => s.description === "_ttyWrite");
    if (symbol) return symbol;
  }
  return undefined;
}

export function attachCompletion(rl: Interface, suggest: (line: string) => Suggestion[]) {
  const out = process.stdout;
  const symbol = findTtyWrite(rl);
  const noop = { enable() {}, disable() {} };
  if (!out.isTTY || !symbol) return noop; // 不是真正的终端（比如输入来自文件），就不做补全

  const anyRl = rl as any;
  const original = anyRl[symbol].bind(rl) as (s: string, key?: any) => void;
  let enabled = false;
  let items: Suggestion[] = [];
  let selected = 0;
  let shownLines = 0; // 输入行下面画了几行
  let dismissedLine: string | null = null; // 按了 Esc 时的输入；输入变了才重新显示

  const cursorCol = () => rl.getCursorPos().cols;

  // 回到输入行，光标放回原来的列
  const backToInput = (lines: number) => `\x1b[${lines}A\x1b[${cursorCol() + 1}G`;

  function hide() {
    if (shownLines === 0) return;
    out.write("\n\x1b[J" + backToInput(1));
    shownLines = 0;
  }

  function draw() {
    const columns = termColumns();
    const start = Math.min(Math.max(0, selected - MAX_VISIBLE + 1), Math.max(0, items.length - MAX_VISIBLE));
    const visible = items.slice(start, start + MAX_VISIBLE);
    const labelWidth = Math.min(24, Math.max(...visible.map((s) => textWidth(s.label))));
    const lines = visible.map((s, i) => {
      const active = start + i === selected;
      const name = truncateWidth(s.label, labelWidth);
      const head = `${active ? "❯" : " "} ${name}${" ".repeat(Math.max(0, labelWidth - textWidth(name)))}  `;
      // 每项只占一行：说明太长就截断
      const room = columns - 1 - textWidth(head);
      const description = room > 2 ? truncateWidth(s.description, room) : "";
      // 选中项的名字用青色加粗，其他项的说明用灰色
      return active ? c.cyan(c.bold(head)) + description : head + c.dim(description);
    });
    const more = items.length > MAX_VISIBLE ? `（共 ${items.length} 项）` : "";
    lines.push(c.dim(truncateWidth(`  ↑↓ 选择 · Tab 补全 · Enter 执行 · Esc 关闭${more}`, columns - 1)));
    out.write("\n\x1b[J" + lines.join("\n") + backToInput(lines.length));
    shownLines = lines.length;
  }

  function update() {
    if (dismissedLine !== null && dismissedLine !== rl.line) dismissedLine = null;
    const next = enabled && dismissedLine === null ? suggest(rl.line) : [];
    // 只剩一个候选项、而且已经输入完整了，就不用再显示
    const done = next.length === 1 && next[0].value === rl.line.trimEnd();
    if (next.length === 0 || done) {
      items = [];
      hide();
      return;
    }
    const previous = items[selected]?.value;
    items = next;
    selected = Math.max(0, items.findIndex((s) => s.value === previous));
    draw();
  }

  // 把输入框内容换成 text（用 readline 自己的快捷键：Ctrl+E 到行尾，Ctrl+U 删到行首）
  function replaceLine(text: string) {
    original("", { ctrl: true, name: "e" });
    original("", { ctrl: true, name: "u" });
    original(text);
  }

  anyRl[symbol] = (s: string, key: any = {}) => {
    if (!enabled) return original(s, key);
    const open = items.length > 0;

    if (open && (key.name === "up" || key.name === "down")) {
      selected = (selected + (key.name === "up" ? -1 : 1) + items.length) % items.length;
      return draw();
    }
    if (key.name === "tab") {
      if (!open) return; // 不插入制表符
      const pick = items[selected];
      replaceLine(pick.value + (pick.hasArgs && !pick.value.includes(" ") ? " " : ""));
      return update();
    }
    if (open && key.name === "escape") {
      dismissedLine = rl.line;
      items = [];
      return hide();
    }
    if (key.name === "return" || key.name === "enter") {
      // 只输入了命令的开头（比如 /mc），回车就执行选中的那一项
      const pick = items[selected];
      const typed = rl.line.trim();
      if (open && pick && pick.value !== typed && pick.value.startsWith(typed)) replaceLine(pick.value);
      items = [];
      hide();
      return original(s, key);
    }
    if (key.ctrl && (key.name === "c" || key.name === "d")) {
      items = [];
      hide();
      return original(s, key);
    }
    original(s, key);
    update();
  };

  return {
    // 只在主输入框（"你 ›"）里补全，回答"允许吗？"这类问题时不补全
    enable() {
      enabled = true;
      dismissedLine = null;
    },
    disable() {
      enabled = false;
      items = [];
      hide();
    },
  };
}
