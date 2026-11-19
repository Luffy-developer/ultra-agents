// 工具：Agent 能"动手"做的事。每个工具 = 说明书（给模型看） + run 函数（真正执行）
import { exec } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { forget, progressForModel, remember, saveProgress, updateMemory } from "./memory.js";
import { generateQuiz } from "./quiz.js";
import { type SearchConfig, webFetch, webSearch } from "./web.js";

export interface ToolContext {
  client: OpenAI;
  model: string;
  cwd: string; // 学生的练习目录，文件和命令工具只能在这里面操作
  signal: AbortSignal;
  search?: SearchConfig; // 搜索服务配置，没配置时 web_search 会提示学生去 /setup
  // 危险操作前征求用户同意
  confirm(toolName: string, title: string, detail: string): Promise<boolean>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  run(args: any, ctx: ToolContext): unknown | Promise<unknown>;
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

function readFile(args: { path: string }, ctx: ToolContext) {
  return { content: truncate(readFileSync(insideCwd(ctx, args.path), "utf-8")) };
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
    description: "读取学生的水平、已学完的课程，以及你之前记下的关于这个学生的记忆（每条有 id）",
    parameters: { type: "object", properties: {} },
    run: progressForModel,
  },
  {
    name: "save_progress",
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
    description: "记下一条关于学生的新记忆（薄弱点、喜好、学习习惯等），以后上课都能用上。先看看有没有相近的旧记忆，有的话用 update_memory 改写，不要重复记",
    parameters: { type: "object", properties: { content: str("一句话写清楚，如：怕看长代码，代码要逐行讲") }, required: ["content"] },
    run: remember,
  },
  {
    name: "update_memory",
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
    description: "删掉一条已经过时、错误，或者已经合并进别的记忆里的记忆",
    parameters: { type: "object", properties: { id: str("记忆的 id，如 m3") }, required: ["id"] },
    run: forget,
  },
  {
    name: "list_lessons",
    description: "列出所有课程文件（按学习顺序）",
    parameters: { type: "object", properties: {} },
    run: listLessons,
  },
  {
    name: "read_lesson",
    description: "读取某节课的讲义内容，讲课前必须先读",
    parameters: { type: "object", properties: { filename: str("课程文件名，如 01-大模型是什么.md") }, required: ["filename"] },
    run: (args) => readLesson(args.filename),
  },
  {
    name: "generate_quiz",
    description: "请出题官根据某节课的讲义和学生薄弱点出一道小测验，返回题目、参考答案和提示",
    parameters: { type: "object", properties: { filename: str("课程文件名，如 01-大模型是什么.md") }, required: ["filename"] },
    run: (args, ctx) => generateQuiz(args.filename, ctx),
  },
  {
    name: "list_files",
    description: "列出学生练习目录（或其子目录）里的文件",
    parameters: { type: "object", properties: { path: str("相对路径，默认为练习目录本身") } },
    run: listFiles,
  },
  {
    name: "read_file",
    description: "读取学生练习目录里的文件内容",
    parameters: { type: "object", properties: { path: str("相对路径") }, required: ["path"] },
    run: readFile,
  },
  {
    name: "write_file",
    description: "在学生练习目录里新建或覆盖一个文件（会先征求学生同意）",
    parameters: {
      type: "object",
      properties: { path: str("相对路径"), content: str("完整的文件内容") },
      required: ["path", "content"],
    },
    run: writeFile,
  },
  {
    name: "run_command",
    description: "在学生练习目录里运行一条终端命令（会先征求学生同意），返回输出。不要运行需要交互输入的命令",
    parameters: { type: "object", properties: { command: str("要运行的命令") }, required: ["command"] },
    run: runCommand,
  },
  {
    name: "web_search",
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
    description: "读取某个网页的正文内容（自动去掉导航栏、广告等）。一般先用 web_search 找到网址再读",
    parameters: { type: "object", properties: { url: str("完整网址，以 http:// 或 https:// 开头") }, required: ["url"] },
    run: webFetch,
  },
];

// 启动后再加进来的工具（比如 MCP 服务器提供的工具）
export function registerTools(tools: Tool[]) {
  TOOLS.push(...tools);
}

// 转成 OpenAI 接口需要的格式。每次调用模型时现算，这样新加的工具也能被模型看到
export function toolSchemas(): ChatCompletionFunctionTool[] {
  return TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
