// 工具：Agent 能"动手"做的事。每个工具 = 说明书（给模型看） + run 函数（真正执行）
import { exec } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { forget, progressForModel, remember, saveProgress, updateMemory } from "./memory.js";
import { TODO_TOOL } from "./todo.js";
import type { Usage } from "./usage.js";
import { type SearchConfig, webFetch, webSearch } from "./web.js";

export interface ToolContext {
  client: OpenAI;
  model: string;
  cwd: string; // 学生的练习目录，文件和命令工具只能在这里面操作
  signal: AbortSignal;
  search?: SearchConfig; // 搜索服务配置，没配置时 web_search 会提示学生去 /setup
  // 危险操作前征求用户同意
  confirm(toolName: string, title: string, detail: string): Promise<boolean>;
  // 每调用一次模型，报告一次 token 用量（subagent：是不是子 Agent、压缩对话这类不属于主对话的调用）
  onUsage?(model: string, usage: Omit<Usage, "calls">, subagent?: boolean): void;
}

export interface Tool {
  name: string;
  label?: string; // 中文名，显示给学生看，如"更新记忆"
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  run(args: any, ctx: ToolContext): unknown | Promise<unknown>;
  concurrent?: boolean; // 模型一次调用好几个时，能不能同时执行（比如派出多个子 Agent）
}

const MAX_OUTPUT = 8000; // 工具结果太长会撑爆上下文，截断

function truncate(text: string) {
  return text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + "\n…（内容过长，已截断）" : text;
}

// ---------- 课程讲义（随工具一起发布，在包的 lessons/ 目录） ----------
const LESSONS_DIR = fileURLToPath(new URL("../lessons/", import.meta.url));

export function listLessons() {
  return readdirSync(LESSONS_DIR).filter((f) => f.endsWith(".md")).sort();
}

export function readLesson(filename: string) {
  const path = join(LESSONS_DIR, filename.split(/[\\/]/).pop()!); // 只允许读 lessons 目录
  if (!existsSync(path)) return { error: `没有这节课：${filename}，可用课程：${listLessons().join("、")}` };
  return { content: readFileSync(path, "utf-8") };
}

// ---------- 练习目录里的文件和命令（像 Claude Code 一样动手） ----------
function insideCwd(ctx: ToolContext, path: string) {
  const full = resolve(ctx.cwd, path);
  if (full !== ctx.cwd && !full.startsWith(ctx.cwd + sep)) throw new Error(`不允许访问练习目录以外的路径：${path}`);
  return full;
}

const IGNORED = new Set(["node_modules", ".git", ".venv", "dist"]);

function listFiles(args: { path?: string }, ctx: ToolContext) {
  const dir = insideCwd(ctx, args.path ?? ".");
  return readdirSync(dir)
    .filter((name) => !IGNORED.has(name))
    .map((name) => (statSync(join(dir, name)).isDirectory() ? name + "/" : name));
}

function readFile(args: { path: string; offset?: number; limit?: number }, ctx: ToolContext) {
  const lines = readFileSync(insideCwd(ctx, args.path), "utf-8").split("\n");
  const start = Math.max(1, Math.floor(args.offset ?? 1));
  const end = args.limit ? start - 1 + Math.floor(args.limit) : lines.length;
  const text = lines.slice(start - 1, end).join("\n");
  const content = text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + "\n…（内容过长，已截断。可以用 offset 和 limit 分段读取）" : text;
  return { content, total_lines: lines.length, ...(start > 1 || end < lines.length ? { from_line: start, to_line: Math.min(end, lines.length) } : {}) };
}

async function writeFile(args: { path: string; content: string }, ctx: ToolContext) {
  const full = insideCwd(ctx, args.path);
  const lines = args.content.split("\n");
  const preview = lines.slice(0, 15).join("\n") + (lines.length > 15 ? `\n…（共 ${lines.length} 行）` : "");
  const action = existsSync(full) ? "覆盖" : "新建";
  if (!(await ctx.confirm("write_file", `${action}文件 ${relative(ctx.cwd, full)}`, preview))) {
    return { error: "学生拒绝了这次写文件，请问问学生原因或换个做法" };
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, args.content);
  return { ok: true };
}

// 修改预览：- 是删掉的行，+ 是改成的行
function diffPreview(oldText: string, newText: string) {
  const show = (text: string, sign: string) => {
    const lines = text.split("\n");
    return [...lines.slice(0, 10).map((l) => `${sign} ${l}`), ...(lines.length > 10 ? [`${sign} …（共 ${lines.length} 行）`] : [])];
  };
  return [...show(oldText, "-"), ...show(newText, "+")].join("\n");
}

// 精确修改：只把文件里的某一段换掉，不用整个重写（和 Claude Code 的 Edit 工具一样）
// 要求 old_string 在文件里只出现一次，防止改错地方
async function editFile(args: { path: string; old_string: string; new_string: string; replace_all?: boolean }, ctx: ToolContext) {
  const full = insideCwd(ctx, args.path);
  if (!existsSync(full)) return { error: `文件不存在：${args.path}。新建文件请用 write_file` };
  if (!args.old_string) return { error: "old_string 不能为空" };
  if (args.old_string === args.new_string) return { error: "old_string 和 new_string 一模一样，不用改" };
  const text = readFileSync(full, "utf-8");
  const count = text.split(args.old_string).length - 1;
  if (count === 0) return { error: "文件里找不到 old_string。先用 read_file 看看文件现在的内容，空格、缩进、换行都要一模一样" };
  if (count > 1 && !args.replace_all) {
    return { error: `old_string 在文件里出现了 ${count} 次，不知道改哪一处。请多带几行上下文让它只出现一次，或者设 replace_all 为 true 全部替换` };
  }
  const line = text.slice(0, text.indexOf(args.old_string)).split("\n").length;
  const where = count > 1 ? `第 ${line} 行等 ${count} 处` : `第 ${line} 行`;
  if (!(await ctx.confirm("edit_file", `修改文件 ${relative(ctx.cwd, full)}（${where}）`, diffPreview(args.old_string, args.new_string)))) {
    return { error: "学生拒绝了这次修改，请问问学生原因或换个做法" };
  }
  // 用函数做替换：新内容里的 $ 符号不会被当成特殊写法
  writeFileSync(full, args.replace_all ? text.split(args.old_string).join(args.new_string) : text.replace(args.old_string, () => args.new_string));
  return { ok: true, replaced: args.replace_all ? count : 1 };
}

// ---------- 搜索：按文件名找文件（glob）、按内容找代码（grep） ----------
const MAX_FILES = 5000;

// 列出目录下所有文件（相对路径，用 / 分隔）。跳过 node_modules 等目录和符号链接（防止绕出练习目录）
function walk(root: string, dir = root, out: string[] = []) {
  for (const name of readdirSync(dir).sort()) {
    if (IGNORED.has(name) || out.length >= MAX_FILES) continue;
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isDirectory()) walk(root, full, out);
    else if (st.isFile()) out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

// 把 *.js、src/**/*.ts、*.{js,ts} 这样的通配符转成正则
// * 匹配文件名里的任意字符，** 匹配任意层目录；没有 / 的写法（如 *.js）在所有子目录里找
export function globToRegex(pattern: string) {
  let re = "";
  let braces = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i++;
      }
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else if (ch === "{") {
      braces++;
      re += "(?:";
    } else if (ch === "}" && braces > 0) {
      braces--;
      re += ")";
    } else if (ch === "," && braces > 0) re += "|";
    else re += ch.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern.includes("/") ? "" : "(?:.*/)?"}${re}$`);
}

// 搜索的起点：练习目录本身或其中的子目录
function searchRoot(ctx: ToolContext, path?: string) {
  const full = insideCwd(ctx, path ?? ".");
  if (!existsSync(full)) throw new Error(`路径不存在：${path}`);
  return full;
}

function globFiles(args: { pattern: string; path?: string }, ctx: ToolContext) {
  const root = searchRoot(ctx, args.path);
  const re = globToRegex(args.pattern);
  const files = walk(root).filter((f) => re.test(f));
  const prefix = relative(ctx.cwd, root).split(sep).join("/");
  const paths = files.map((f) => (prefix ? `${prefix}/${f}` : f));
  return { files: paths.slice(0, 200), total: paths.length, ...(paths.length > 200 && { tip: "结果太多，只列出前 200 个，换个更具体的写法试试" }) };
}

const MAX_MATCHES = 100;

function grep(args: { pattern: string; path?: string; glob?: string; ignore_case?: boolean }, ctx: ToolContext) {
  let re: RegExp;
  try {
    re = new RegExp(args.pattern, args.ignore_case ? "i" : "");
  } catch (e) {
    return { error: `正则表达式写错了：${e instanceof Error ? e.message : e}` };
  }
  const root = searchRoot(ctx, args.path);
  const isFile = statSync(root).isFile();
  const filter = args.glob ? globToRegex(args.glob) : undefined;
  const files = isFile ? [relative(ctx.cwd, root)] : walk(root).map((f) => relative(ctx.cwd, join(root, f)));
  const matches: string[] = [];
  let total = 0;
  for (const file of files) {
    if (filter && !filter.test(file.split(sep).join("/"))) continue;
    const full = join(ctx.cwd, file);
    if (statSync(full).size > 1_000_000) continue; // 太大的文件跳过
    const text = readFileSync(full, "utf-8");
    if (text.slice(0, 8000).includes("\0")) continue; // 图片之类的二进制文件跳过
    text.split("\n").forEach((line, i) => {
      if (!re.test(line)) return;
      total++;
      if (matches.length < MAX_MATCHES) matches.push(`${file.split(sep).join("/")}:${i + 1}: ${line.trim().slice(0, 200)}`);
    });
  }
  return { matches, total, ...(total > MAX_MATCHES && { tip: `共 ${total} 处，只列出前 ${MAX_MATCHES} 处，可以用 path 或 glob 缩小范围` }) };
}

async function runCommand(args: { command: string }, ctx: ToolContext) {
  if (!(await ctx.confirm("run_command", "运行命令", `$ ${args.command}\n（目录：${ctx.cwd}）`))) {
    return { error: "学生拒绝了运行这条命令，请问问学生原因或换个做法" };
  }
  return new Promise((done) => {
    exec(args.command, { cwd: ctx.cwd, timeout: 120_000, signal: ctx.signal }, (err, stdout, stderr) => {
      done({ exit_code: err ? (err.code ?? 1) : 0, stdout: truncate(stdout), stderr: truncate(stderr) });
    });
  });
}

// ---------- 工具清单 ----------
const str = (description: string) => ({ type: "string", description });

export const TOOLS: Tool[] = [
  {
    name: "get_progress",
    label: "读取学习进度",
    description: "读取学生的水平、已学完的课程，以及你之前记下的关于这个学生的记忆（每条有 id）",
    parameters: { type: "object", properties: {} },
    run: progressForModel,
  },
  {
    name: "save_progress",
    label: "保存学习进度",
    description: "更新学生的水平，或记录刚学完的课程",
    parameters: {
      type: "object",
      properties: {
        level: str("如：零基础/入门/进阶"),
        completed_topic: str("刚学完的课程文件名"),
      },
    },
    run: saveProgress,
  },
  {
    name: "remember",
    label: "记下记忆",
    description: "记下一条关于学生的新记忆（薄弱点、喜好、学习习惯等），以后上课都能用上。先看看有没有相近的旧记忆，有的话用 update_memory 改写，不要重复记",
    parameters: { type: "object", properties: { content: str("一句话写清楚，如：怕看长代码，代码要逐行讲") }, required: ["content"] },
    run: remember,
  },
  {
    name: "update_memory",
    label: "更新记忆",
    description: "改写一条已有的记忆：情况变了（比如学生已经不怕代码了），或者要把几条相近的记忆合并成一条",
    parameters: {
      type: "object",
      properties: { id: str("记忆的 id，如 m3"), content: str("改写后的完整内容") },
      required: ["id", "content"],
    },
    run: updateMemory,
  },
  {
    name: "forget",
    label: "删除记忆",
    description: "删掉一条已经过时、错误，或者已经合并进别的记忆里的记忆",
    parameters: { type: "object", properties: { id: str("记忆的 id，如 m3") }, required: ["id"] },
    run: forget,
  },
  {
    name: "list_lessons",
    label: "查看课程列表",
    description: "列出所有课程文件（按学习顺序）",
    parameters: { type: "object", properties: {} },
    run: listLessons,
  },
  {
    name: "read_lesson",
    label: "读取讲义",
    description: "读取某节课的讲义内容，讲课前必须先读",
    parameters: { type: "object", properties: { filename: str("课程文件名，如 01-大模型是什么.md") }, required: ["filename"] },
    run: (args) => readLesson(args.filename),
  },
  TODO_TOOL,
  {
    name: "list_files",
    label: "查看文件列表",
    description: "列出学生练习目录（或其子目录）里的文件",
    parameters: { type: "object", properties: { path: str("相对路径，默认为练习目录本身") } },
    run: listFiles,
  },
  {
    name: "read_file",
    label: "读取文件",
    description: "读取学生练习目录里的文件内容。文件很长时可以用 offset、limit 分段读",
    parameters: {
      type: "object",
      properties: {
        path: str("相对路径"),
        offset: { type: "integer", description: "从第几行开始读（从 1 开始），不填从头读" },
        limit: { type: "integer", description: "最多读几行，不填读到结尾" },
      },
      required: ["path"],
    },
    run: readFile,
  },
  {
    name: "write_file",
    label: "写入文件",
    description: "在学生练习目录里新建文件，或把整个文件重写（会先征求学生同意）。只改文件里的一部分时用 edit_file",
    parameters: {
      type: "object",
      properties: { path: str("相对路径"), content: str("完整的文件内容") },
      required: ["path", "content"],
    },
    run: writeFile,
  },
  {
    name: "edit_file",
    label: "修改文件",
    description:
      "精确修改已有文件：把文件里的 old_string 换成 new_string，文件其余部分不动（会先征求学生同意）。" +
      "改之前先用 read_file 看文件内容；old_string 要和文件里一模一样（包括空格和缩进），并且只出现一次，不唯一时多带几行上下文",
    parameters: {
      type: "object",
      properties: {
        path: str("相对路径"),
        old_string: str("要被替换的原文"),
        new_string: str("替换成的新内容"),
        replace_all: { type: "boolean", description: "为 true 时替换所有出现的地方（比如给变量改名），默认 false" },
      },
      required: ["path", "old_string", "new_string"],
    },
    run: editFile,
  },
  {
    name: "glob",
    label: "查找文件",
    description: "按文件名查找练习目录里的文件，如 *.js（所有子目录里的 js 文件）、src/**/*.ts、*.{js,ts}",
    parameters: { type: "object", properties: { pattern: str("文件名通配符"), path: str("在哪个子目录里找，默认整个练习目录") }, required: ["pattern"] },
    run: globFiles,
  },
  {
    name: "grep",
    label: "搜索代码",
    description: "按内容搜索练习目录里的文件（支持正则表达式），返回「文件:行号: 这一行」。找某个函数、变量、报错信息在哪时用",
    parameters: {
      type: "object",
      properties: {
        pattern: str("要搜的内容（正则表达式），如 fetch\\( 或 function\\s+main"),
        path: str("在哪个子目录或文件里搜，默认整个练习目录"),
        glob: str("只搜文件名符合这个通配符的文件，如 *.js"),
        ignore_case: { type: "boolean", description: "是否忽略大小写" },
      },
      required: ["pattern"],
    },
    run: grep,
  },
  {
    name: "run_command",
    label: "运行命令",
    description: "在学生练习目录里运行一条终端命令（会先征求学生同意），返回输出。不要运行需要交互输入的命令",
    parameters: { type: "object", properties: { command: str("要运行的命令") }, required: ["command"] },
    run: runCommand,
  },
  {
    name: "web_search",
    label: "上网搜索",
    description: "上网搜索，返回网页标题、网址和摘要。用于讲义以外的新知识、最新资讯，或学生明确要求查资料时",
    parameters: {
      type: "object",
      properties: {
        query: str("搜索关键词，简短明确"),
        freshness: { type: "string", enum: ["day", "week", "month", "year"], description: "只看最近一天/一周/一个月/一年的结果；查最新资讯时用，不填则不限时间" },
      },
      required: ["query"],
    },
    run: webSearch,
  },
  {
    name: "web_fetch",
    label: "读取网页",
    description: "读取某个网页的正文内容（自动去掉导航栏、广告等）。一般先用 web_search 找到网址再读",
    parameters: { type: "object", properties: { url: str("完整网址，以 http:// 或 https:// 开头") }, required: ["url"] },
    run: webFetch,
  },
];

// 启动后再加进来的工具（派子 Agent 的 task 工具、MCP 服务器提供的工具）
export function registerTools(tools: Tool[]) {
  TOOLS.push(...tools);
}

// 去掉一批工具（比如删除 MCP 服务器时，去掉它提供的工具）
export function unregisterTools(shouldRemove: (t: Tool) => boolean) {
  for (let i = TOOLS.length - 1; i >= 0; i--) if (shouldRemove(TOOLS[i])) TOOLS.splice(i, 1);
}

export function toolLabel(name: string) {
  return TOOLS.find((t) => t.name === name)?.label;
}

// 转成 OpenAI 接口需要的格式。每次调用模型时现算，这样新加的工具也能被模型看到
export function toolSchemas(tools: Tool[] = TOOLS): ChatCompletionFunctionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
