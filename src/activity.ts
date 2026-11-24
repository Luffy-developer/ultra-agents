// 过程折叠（和 Claude Code 一样）：
// - 思考时：显示一个灰底的临时面板，滚动显示最新的几行思考内容；想完了面板消失，只留一行"思考了 9 秒"
// - 工具调用：只显示一行灰色的总结，比如
//   ⎿ 读了 hello.js、api.js · 搜索「MCP 是什么」· 运行了 node hello.js（ctrl+o 展开）
// 回到输入框时按 Ctrl+O（或输入 /details），才展开看上一轮的完整过程；输入 /verbose 可以改成一直完整显示
// 需要学生看到的内容（"允许吗？"确认、待办清单、hook 拦截警告）不折叠
import { c, charWidth, describeCall, newline, tagLine, termColumns, textWidth, toolSummary, truncateWidth, write, writeSeq } from "./ui.js";

// 这一轮的完整过程（展开时显示）
type LogItem = { kind: "think"; text: string; started: number; ms: number } | { kind: "line"; text: string };
let log: LogItem[] = [];

// 正在折叠显示的这一段过程：导师说话之前的那些思考和工具调用，合成一行总结
interface Group {
  actions: Map<string, { objects: string[]; count: number }>; // 动作 → 对象，如 "读了" → [hello.js, api.js]
  agentSteps: Map<string, number>; // 子 Agent → 用了几次工具（审核员的步骤也算在派出的那个子 Agent 头上）
  revisions: Map<string, number>; // 子 Agent → 被审核员退回修改了几次
  hooks: number;
  shown: boolean; // 总结行是不是已经画在屏幕上了
  drawnAt: number; // 画总结行时的输出计数，用来判断后面有没有别的内容
  lastDraw: number;
}
let group: Group | null = null;
let expanded = false;

// 展开模式：每一步都完整显示（/verbose，或自动化评估的 -v）
export function setExpanded(value: boolean) {
  expanded = value;
}

export function isExpanded() {
  return expanded;
}

// 新的一轮开始：清空上一轮的过程记录
export function startTurn() {
  end();
  log = [];
}

// 工具名 → 总结里的说法；第二项表示要不要列出对象（文件名、搜索词……）
const VERBS: Record<string, [string, boolean]> = {
  get_progress: ["查看学习进度", false],
  save_progress: ["保存学习进度", false],
  remember: ["记下记忆", false],
  update_memory: ["更新记忆", false],
  forget: ["删除记忆", false],
  list_lessons: ["查看课程列表", false],
  read_lesson: ["读了讲义", true],
  list_files: ["查看目录", true],
  read_file: ["读了", true],
  write_file: ["写了", true],
  edit_file: ["改了", true],
  glob: ["查找文件", true],
  grep: ["搜索代码", true],
  run_command: ["运行了", true],
  web_search: ["搜索", true],
  web_fetch: ["读了网页", true],
  use_skill: ["使用技能", true],
  task: ["派出", true],
};

// 一次工具调用在总结里的样子：动作 + 对象
function action(name: string, rawArgs: string, label?: string): [string, string] {
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) return ["用了 MCP 工具", `${mcp[1]}/${mcp[2]}`];
  const [verb, withObject] = VERBS[name] ?? [label ?? name, false];
  if (!withObject) return [verb, ""];
  let args: any = {};
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {}
  if (name === "task") return [verb, String(args.agent ?? "?")];
  if (name === "web_fetch") return [verb, String(args.url ?? "").replace(/^https?:\/\/([^/]+).*$/, "$1")];
  if (name === "read_lesson") return [verb, String(args.filename ?? "").replace(/\.md$/, "")];
  const object = toolSummary(rawArgs);
  return [verb, ["web_search", "grep", "glob"].includes(name) && object ? `「${object}」` : object];
}

function summary(g: Group) {
  const parts: string[] = [];
  for (const [verb, { objects, count }] of g.actions) {
    const agentInfo = (a: string) => {
      const info = [g.agentSteps.get(a) && `${g.agentSteps.get(a)} 步`, g.revisions.get(a) && `退回修改 ${g.revisions.get(a)} 次`].filter(Boolean);
      return info.length ? `${a}（${info.join("，")}）` : a;
    };
    const shown = verb === "派出" ? objects.map(agentInfo) : objects;
    if (shown.length === 0) parts.push(count > 1 ? `${verb} ${count} 次` : verb);
    else parts.push(`${verb} ${shown.slice(0, 3).join("、")}${shown.length > 3 ? ` 等 ${shown.length} 个` : ""}`);
  }
  if (g.hooks) parts.push(`运行了 ${g.hooks} 个 hook`);
  return parts.join(" · ");
}

const live = () => Boolean(process.stdout.isTTY);
const HINT = "（ctrl+o 展开）";

// 画总结行。后面没有别的输出时原地刷新；有的话（比如中间弹出了"允许吗？"）就另起一行
function draw(force = false) {
  if (!group || !live()) return;
  const now = Date.now();
  if (!force && group.shown && now - group.lastDraw < 100) return; // 思考时每个字都会触发，限制一下刷新频率
  const text = truncateWidth(summary(group), termColumns() - 6 - HINT.length * 2);
  const line = `  ${c.dim("⎿ ")}${c.dim(text)}${c.dim(HINT)}`;
  if (group.shown && group.drawnAt === writeSeq()) write("\r\x1b[2K" + line);
  else {
    newline();
    write(line);
  }
  group.shown = true;
  group.drawnAt = writeSeq();
  group.lastDraw = now;
}

// 总结行画出来以后，如果后面插进了别的内容（比如"允许吗？"确认），这行就定格了；之后的动作另起一行重新总结
const interrupted = (g: Group) => g.shown && g.drawnAt !== writeSeq();

function current(): Group {
  if (group && interrupted(group)) group = null;
  return (group ??= { actions: new Map(), agentSteps: new Map(), revisions: new Map(), hooks: 0, shown: false, drawnAt: -1, lastDraw: 0 });
}

// 这一段过程结束（导师开始说话了、要显示别的内容了）：把总结行定下来
export function end() {
  endThinking();
  endGroup();
}

function endGroup() {
  if (!group) return;
  const g = group;
  group = null;
  const text = summary(g);
  if (!text) return;
  if (!live()) return write(`  ⎿ ${text}\n`); // 输出到文件时只写最终的总结
  if (interrupted(g)) return; // 已经定格在屏幕上了
  if (g.shown) write("\r\x1b[2K");
  else newline();
  write(`  ${c.dim("⎿ ")}${c.dim(truncateWidth(text, termColumns() - 6 - HINT.length * 2))}${c.dim(HINT)}\n`);
}

// 展开模式下，每一步都直接显示
function show(text: string) {
  if (!expanded) return;
  newline();
  write(text + "\n");
}

// ---------- 记录各种过程 ----------

export function thinking(delta: string) {
  const now = Date.now();
  const last = log.at(-1);
  let item: Extract<LogItem, { kind: "think" }>;
  if (last?.kind === "think") item = last;
  else {
    item = { kind: "think", text: "", started: now, ms: 0 };
    log.push(item);
    if (expanded) {
      newline();
      write(tagLine("think", "思考过程") + "\n     ");
    } else {
      endGroup(); // 前面工具调用的总结行先定下来，思考面板画在它下面
      panel = { rows: 0, drawnAt: -1, lastDraw: 0 };
    }
  }
  item.text += delta;
  item.ms = now - item.started;
  if (expanded) write(c.dim(delta.replace(/\n+/g, "\n     ")));
  else drawPanel(item);
}

// 思考结束：面板换成一行"思考了 N 秒"；下次再思考就另起一段
export function endThinking() {
  const last = log.at(-1);
  if (last?.kind !== "think") return;
  last.ms = Date.now() - last.started; // 算到真正想完（开始回答或调用工具）为止
  if (expanded) newline();
  else closePanel(last);
  log.push({ kind: "line", text: "" });
}

// ---------- 思考面板 ----------
const PANEL_LINES = 4; // 面板里最多显示几行（只显示最新的内容）
const BG_ON = "\x1b[48;5;236m\x1b[38;5;250m"; // 深灰底、浅灰字
const BG_OFF = "\x1b[39m\x1b[49m";
let panel: { rows: number; drawnAt: number; lastDraw: number } | null = null;

// 按显示宽度折行（中文占两格）
function wrap(text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    let w = 0;
    for (const ch of paragraph) {
      const cw = charWidth(ch.codePointAt(0)!);
      if (w + cw > width) {
        lines.push(line);
        line = "";
        w = 0;
      }
      line += ch;
      w += cw;
    }
    if (line.trim()) lines.push(line);
  }
  return lines;
}

// 擦掉面板：光标回到面板第一行开头，清掉下面所有内容。面板后面有别的输出时就不擦了（擦了会把别的内容一起擦掉）
function erasePanel() {
  if (!panel || panel.rows === 0) return false;
  if (panel.drawnAt !== writeSeq()) return false;
  write(`\r${panel.rows > 1 ? `\x1b[${panel.rows - 1}A` : ""}\x1b[J`);
  return true;
}

function drawPanel(item: { text: string }, force = false) {
  if (!panel || !live()) return;
  const now = Date.now();
  if (!force && panel.rows > 0 && now - panel.lastDraw < 100) return; // 每个字都会触发，限制一下刷新频率
  const width = termColumns() - 3; // 留出右边一格，防止终端自动换行
  const body = wrap(item.text.trim(), width - 5).slice(-PANEL_LINES);
  const row = (text: string) => `  ${BG_ON}${text}${" ".repeat(Math.max(0, width - textWidth(text)))}${BG_OFF}`;
  const rows = [row(""), ...body.map((line, i) => row(`${i === 0 ? " ∴ " : "   "}${line}`)), row("")];
  if (!erasePanel()) newline();
  write(rows.join("\n"));
  panel.rows = rows.length;
  panel.drawnAt = writeSeq();
  panel.lastDraw = now;
}

function closePanel(item: { ms: number }) {
  if (!panel) return;
  const seconds = Math.max(1, Math.round(item.ms / 1000));
  if (live()) {
    if (!erasePanel()) newline();
  } else newline();
  panel = null;
  write(`  ${c.dim("思考了 ")}${c.bold(c.dim(String(seconds)))}${c.dim(" 秒")}\n`);
}

export function toolCall(name: string, rawArgs: string, label?: string) {
  endThinking();
  const { tag, text } = describeCall(name, rawArgs, label);
  log.push({ kind: "line", text: tagLine(tag, text) });
  if (name === "todo_write") return; // 待办清单会直接画出来，不用再记一次
  show(tagLine(tag, text));
  if (expanded) return;
  const g = current();
  const [verb, object] = action(name, rawArgs, label);
  const entry = g.actions.get(verb) ?? { objects: [], count: 0 };
  entry.count++;
  if (object && !entry.objects.includes(object)) entry.objects.push(object);
  g.actions.set(verb, entry);
  draw(true);
}

// 工具结果：只在展开时看得到（缩成一行）
export function toolResult(result: unknown, indent = 5) {
  let text = typeof result === "string" ? result : JSON.stringify(result);
  text = text.replace(/\s+/g, " ");
  const line = c.dim(`${" ".repeat(indent)}→ ${text.length > 200 ? text.slice(0, 200) + "…" : text}`);
  log.push({ kind: "line", text: line });
  show(line);
}

// 子 Agent 在用什么工具。owner：总结里算在哪个子 Agent 头上（审核员干的活算在被审核的子 Agent 头上）
export function subagentStep(agent: string, name: string, rawArgs: string, label?: string, owner = agent) {
  endThinking();
  const { tag, text } = describeCall(name, rawArgs, label);
  const line = tagLine(tag, `${agent} › ${text}`, 5);
  log.push({ kind: "line", text: line });
  show(line);
  if (expanded) return;
  const g = current();
  g.agentSteps.set(owner, (g.agentSteps.get(owner) ?? 0) + 1);
  draw();
}

// 子 Agent 的结果被审核员退回修改了一次
export function revised(agent: string) {
  if (expanded) return;
  const g = current();
  g.revisions.set(agent, (g.revisions.get(agent) ?? 0) + 1);
  draw(true);
}

// 其他过程信息：子 Agent 的审核结果、hook 的输出等
export function note(tag: string, text: string, indent = 2, detail?: string) {
  endThinking();
  const lines = [tagLine(tag, text, indent), ...(detail ? [c.dim(detail.replace(/^/gm, " ".repeat(indent + 3)))] : [])];
  for (const line of lines) {
    log.push({ kind: "line", text: line });
    show(line);
  }
  if (expanded) return;
  if (tag === "hook") current().hooks++;
  draw(true);
}

// 必须让学生看到的提醒（hook 拦下了操作、子 Agent 没完成……）：不折叠
export function warn(text: string) {
  endThinking();
  log.push({ kind: "line", text: c.yellow(text) });
  end();
  newline();
  write(c.yellow(text) + "\n");
}

// Ctrl+O / /details：展开上一轮的完整过程
export function printDetails() {
  end();
  const items = log.filter((item) => item.kind === "think" || item.text);
  if (items.length === 0) return write(c.dim("\n上一轮没有思考过程或工具调用。\n"));
  write(c.dim("\n──────── 上一轮的完整过程 ────────\n"));
  for (const item of items) {
    if (item.kind === "line") write(item.text + "\n");
    else {
      write(tagLine("think", `思考过程（${Math.max(1, Math.round(item.ms / 1000))} 秒）`) + "\n");
      write(c.dim(item.text.trim().replace(/^/gm, "     ")) + "\n");
    }
  }
  write(c.dim("──────────────────────────────\n"));
}
