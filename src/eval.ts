// 自动化评估（第 13 课）：准备一组测试题，一键跑完，检查导师有没有按规矩做事
// 每道题：准备好假的学习进度和练习文件 → 让导师回答 → 用规则检查（调用了哪些工具、回答里有没有某些字、文件改对了没有）
//        → 再请一个模型当评委，按评分标准判断合不合格（LLM-as-judge）
// 改了 System Prompt、工具或换了模型之后跑一遍，就知道有没有把原来好好的地方改坏
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { runTurn, systemPrompt, type Message } from "./agent.js";
import { type Config, DATA_DIR, searchConfig } from "./config.js";
import { type FakeProgress, useInMemoryProgress } from "./memory.js";
import { clearTodos } from "./todo.js";
import { toolLabel, type ToolContext } from "./tools.js";
import * as activity from "./activity.js";
import { c, setMuted, write } from "./ui.js";
import { readUsage, UsageMeter, usageLine } from "./usage.js";

export interface EvalCase {
  name: string;
  input: string | string[]; // 学生说的话；多轮对话写成数组，按顺序一句句说
  progress?: FakeProgress; // 假的学习进度（可以带档位和错题本），不填就是新同学
  files?: Record<string, string>; // 练习目录里预先放好的文件
  tutor?: string; // 假的 TUTOR.md 内容
  expect: {
    tools?: string[]; // 必须调用过的工具；"a|b" 表示调用其中一个就行；"task:quiz-maker" 表示派了出题官
    notTools?: string[]; // 不许调用的工具
    contains?: string[]; // 最后一轮回答里必须出现的文字
    notContains?: string[]; // 回答里（每一轮都算）不许出现的文字
    files?: Record<string, string>; // 跑完后这些文件必须存在，并包含这段文字（空字符串 = 只要存在）
    judge?: string; // 评分标准，交给评委模型判断
  };
}

interface CaseResult {
  name: string;
  pass: boolean;
  failures: string[];
  judge?: { pass: boolean; reason: string };
  tools: string[];
  denied: string[];
  replies: string[];
  seconds: number;
  usage: ReturnType<UsageMeter["total"]>;
  cost?: number;
}

export const DEFAULT_CASES = fileURLToPath(new URL("../evals/cases.json", import.meta.url));

// 评估时允许在临时练习目录里写文件、改文件、领取作业（目录是临时建的，测完就删）；运行命令、MCP 工具一律拒绝
const ALLOWED = new Set(["write_file", "edit_file", "start_homework"]);

const JUDGE_PROMPT = `你是一位严格、公正的评委，负责检查「AI Agent 入门导师」（一个教小白学 AI Agent 的 AI）在一段对话里的表现。
根据评分标准判断是否合格。只看对话里实际发生的事，不要脑补。
只输出 JSON，不要输出任何别的内容：{"pass": true 或 false, "reason": "一句话理由"}`;

function loadCases(file: string): EvalCase[] {
  const cases = JSON.parse(readFileSync(file, "utf-8"));
  if (!Array.isArray(cases)) throw new Error("测试题文件应该是一个数组");
  cases.forEach((item, i) => {
    if (!item?.name || !item.input || !item.expect) throw new Error(`第 ${i + 1} 道题缺少 name、input 或 expect`);
  });
  return cases;
}

// 给评委看的对话记录：学生说了什么、导师调用了什么工具、回答了什么
function transcript(messages: Message[]) {
  return messages
    .slice(1)
    .map((m) => {
      if (m.role === "user") return `【学生】${m.content}`;
      if (m.role === "tool") return `【工具结果】${String(m.content).slice(0, 300)}`;
      if (m.role === "assistant") {
        const calls = ((m.tool_calls ?? []) as any[]).map((t) => `${t.function?.name}(${String(t.function?.arguments ?? "").slice(0, 300)})`);
        return [m.content ? `【导师】${m.content}` : "", calls.length ? `【导师调用工具】${calls.join("，")}` : ""].filter(Boolean).join("\n");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function judge(client: OpenAI, model: string, criteria: string, messages: Message[], meter: UsageMeter) {
  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: JUDGE_PROMPT },
      { role: "user", content: `评分标准：${criteria}\n\n对话记录：\n${transcript(messages)}` },
    ],
  });
  const used = readUsage(resp.usage);
  if (used) meter.add(model, used);
  const text = resp.choices[0]?.message.content ?? "";
  try {
    const result = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "");
    return { pass: result.pass === true, reason: String(result.reason ?? "") };
  } catch {
    return { pass: false, reason: `评委没有按格式回答：${text.slice(0, 100)}` };
  }
}

// 把预先准备的文件放进临时练习目录（不许写到目录外面）
function prepareDir(files: Record<string, string> = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-tutor-eval-")));
  for (const [path, content] of Object.entries(files)) {
    const full = resolve(dir, path);
    if (!full.startsWith(dir + sep)) throw new Error(`files 里的路径不能跑出练习目录：${path}`);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

async function runCase(item: EvalCase, client: OpenAI, config: Config, judgeModel: string, verbose: boolean): Promise<CaseResult> {
  const started = Date.now();
  const meter = new UsageMeter();
  const tools: string[] = [];
  const denied: string[] = [];
  const replies: string[] = [];
  const failures: string[] = [];
  let judged: CaseResult["judge"];

  useInMemoryProgress(item.progress);
  clearTodos();
  const dir = prepareDir(item.files);
  const ctx: ToolContext = {
    client,
    model: config.model,
    cwd: dir,
    signal: new AbortController().signal,
    search: searchConfig(config),
    confirm: async (tool) => {
      if (ALLOWED.has(tool)) return true;
      denied.push(tool);
      return false;
    },
    onUsage: (model, usage) => meter.add(model, usage),
  };
  const events = {
    onText: (delta: string) => {
      activity.end();
      if (verbose) write(delta); // 用 write 输出，后面的过程提示才知道要不要先换行
    },
    onThinking: (delta: string) => activity.thinking(delta),
    onToolResult: (_name: string, result: unknown) => activity.toolResult(result),
    onToolCall: (name: string, rawArgs: string) => {
      tools.push(name);
      if (name === "task") {
        try {
          tools.push(`task:${JSON.parse(rawArgs).agent}`);
        } catch {}
      }
      activity.toolCall(name, rawArgs, toolLabel(name));
    },
  };
  const messages: Message[] = [{ role: "system", content: systemPrompt(dir, item.tutor ?? "") }];

  try {
    for (const input of [item.input].flat()) {
      if (verbose) process.stdout.write(c.green(`\n你 › ${input}\n`) + c.cyan("导师 › "));
      messages.push({ role: "user", content: input });
      const reply = await runTurn(messages, ctx, events);
      if (reply === undefined) failures.push("步骤太多，被强制停止");
      replies.push(reply ?? "");
      if (verbose) process.stdout.write("\n");
    }

    // ---------- 规则检查 ----------
    const { expect } = item;
    const called = new Set(tools);
    for (const want of expect.tools ?? []) {
      if (!want.split("|").some((name) => called.has(name))) failures.push(`没有调用 ${want}`);
    }
    for (const name of expect.notTools ?? []) {
      if (called.has(name)) failures.push(`不该调用 ${name}`);
    }
    const last = replies.at(-1) ?? "";
    for (const text of expect.contains ?? []) {
      if (!last.includes(text)) failures.push(`回答里没有「${text}」`);
    }
    for (const text of expect.notContains ?? []) {
      if (replies.some((r) => r.includes(text))) failures.push(`回答里不该出现「${text}」`);
    }
    for (const [path, text] of Object.entries(expect.files ?? {})) {
      const full = join(dir, path);
      if (!existsSync(full)) failures.push(`文件 ${path} 不存在`);
      else if (text && !readFileSync(full, "utf-8").includes(text)) failures.push(`文件 ${path} 里没有「${text}」`);
    }

    // ---------- 评委打分 ----------
    if (expect.judge) {
      judged = await judge(client, judgeModel, expect.judge, messages, meter);
      if (!judged.pass) failures.push(`评委：${judged.reason}`);
    }
  } catch (e) {
    failures.push(`出错了：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return {
    name: item.name,
    pass: failures.length === 0,
    failures,
    judge: judged,
    tools,
    denied,
    replies,
    seconds: Math.round((Date.now() - started) / 1000),
    usage: meter.total(),
    cost: meter.cost(config.prices),
  };
}

// 返回没通过的题数（命令行据此决定退出码，方便以后接到 CI 里自动跑）
export async function runEval(config: Config, opts: { file?: string; only?: string; verbose?: boolean }) {
  const file = resolve(opts.file ?? DEFAULT_CASES);
  let cases = loadCases(file);
  if (opts.only) cases = cases.filter((item) => item.name.includes(opts.only!));
  if (cases.length === 0) throw new Error(`没有找到测试题${opts.only ? `（名字里包含「${opts.only}」）` : ""}`);

  const client = new OpenAI({ apiKey: config.apiKey || "EMPTY", baseURL: config.baseURL });
  const judgeModel = process.env.JUDGE_MODEL || config.model;
  const out = (s: string) => process.stdout.write(s);
  out(c.bold(`\n🧪 自动化评估：${cases.length} 道题\n`));
  out(c.dim(`测试题：${file}\n导师模型：${config.model}    评委模型：${judgeModel}（可以用环境变量 JUDGE_MODEL 换一个更强的）\n`));
  out(c.dim("每道题用假的学习进度和临时练习目录，不会改动你真正的进度和文件。\n"));

  const started = Date.now();
  const results: CaseResult[] = [];
  setMuted(!opts.verbose); // 不加 -v 时，不显示导师画的待办清单、子 Agent 进度等
  activity.setExpanded(true); // 加了 -v 时，每一步都完整显示
  for (const [i, item] of cases.entries()) {
    out(`\n${c.dim(`[${i + 1}/${cases.length}]`)} ${item.name} `);
    const result = await runCase(item, client, config, judgeModel, Boolean(opts.verbose));
    results.push(result);
    const stats = c.dim(`（${result.seconds} 秒 · ${usageLine(result.usage, result.cost, config.currency)}）`);
    out(`${result.pass ? c.green("✓ 通过") : c.red("✗ 没通过")} ${stats}\n`);
    for (const f of result.failures) out(c.red(`    · ${f}`) + "\n");
    if (result.pass && result.judge?.reason) out(c.dim(`    · 评委：${result.judge.reason}`) + "\n");
  }
  setMuted(false);

  const passed = results.filter((r) => r.pass).length;
  const sum = { input: 0, output: 0, cached: 0, calls: 0 };
  for (const r of results) for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += r.usage[key];
  const cost = results.every((r) => r.cost !== undefined) ? results.reduce((n, r) => n + r.cost!, 0) : undefined;
  const seconds = Math.round((Date.now() - started) / 1000);

  const reportDir = join(DATA_DIR, "evals");
  mkdirSync(reportDir, { recursive: true });
  const reportFile = join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  writeFileSync(reportFile, JSON.stringify({ time: new Date().toISOString(), cases: file, model: config.model, judgeModel, passed, total: results.length, results }, null, 2));

  const rate = Math.round((passed / results.length) * 100);
  const color = passed === results.length ? c.green : c.yellow;
  out(`\n${color(c.bold(`结果：${passed}/${results.length} 通过（${rate}%）`))}  ${c.dim(`用时 ${seconds} 秒 · ${usageLine(sum, cost, config.currency)}`)}\n`);
  out(c.dim(`详细报告（含导师每一轮的回答）：${reportFile}\n`));
  return results.length - passed;
}
