#!/usr/bin/env node
// 命令行入口：读配置 → 启动对话 → 每轮把用户输入交给 Agent
import { existsSync, readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";
import { compactHistory, needsCompaction, runTurn, systemPrompt, trimHistory, type Message } from "./agent.js";
import { type Config, DATA_DIR, isComplete, loadConfig, runSetup, searchConfig } from "./config.js";
import { formatTime, helpText, recentSessions, suggestCommands } from "./commands.js";
import { attachCompletion } from "./input.js";
import { MarkdownStream, plainText } from "./markdown.js";
import { closeMcpServers, connectMcpServers, MCP_CONFIG_FILE, mcpStatuses } from "./mcp.js";
import { getProgress, instructionFiles } from "./memory.js";
import { runEval } from "./eval.js";
import { cleanupSessions, latestSession, loadSession, newSessionId, saveSession } from "./session.js";
import { agentDirs, loadAgents, taskTool, toolsFor } from "./subagents.js";
import { clearTodos, printTodos, restoreTodos } from "./todo.js";
import { listLessons, registerTools, type ToolContext } from "./tools.js";
import { c, newline, printConfirm, printToolCall, setMuted, textWidth, write } from "./ui.js";
import { costOf, formatTokens, UsageMeter, usageLine } from "./usage.js";
import { webSearch } from "./web.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;

function explainError(e: unknown) {
  if (e instanceof OpenAI.APIError) {
    if (e.status === 401 || e.status === 403) return "API Key 不对或没有权限，输入 /setup 修改";
    if (e.status === 404) return "base_url 或模型名可能写错了，输入 /setup 修改";
    if (e.status === 400) return `请求被拒绝：${e.message}\n（如果提到 tools，说明这个模型不支持工具调用，请换一个模型）`;
    if (e instanceof OpenAI.APIConnectionError) return "连不上模型服务，请检查网络和 base_url";
  }
  return e instanceof Error ? e.message : String(e);
}

function showProgress() {
  const p = getProgress();
  write(`\n水平：${p.level}\n`);
  for (const lesson of listLessons()) {
    write(`  ${p.completed.includes(lesson) ? c.green("✓") : c.dim("○")} ${lesson.replace(/\.md$/, "")}\n`);
  }
  write(c.dim(`导师记住了你 ${p.memories.length} 件事，输入 /memory 查看\n`));
}

function showMemory(cwd: string) {
  const p = getProgress();
  write(c.bold("\n导师对你的记忆") + c.dim("（导师上课时会自动新增、修改、合并）\n"));
  if (p.memories.length === 0) write(c.dim("  还没有\n"));
  for (const m of p.memories) write(`  ${c.dim(m.id)} ${m.content} ${c.dim(m.updated)}\n`);
  write(c.dim(`想让导师忘掉某条，直接跟它说"忘掉 m1"就行\n`));

  const files = instructionFiles(cwd);
  write(c.bold("\n你写的说明文件 TUTOR.md") + c.dim("（导师只读不改，每次开始新对话时读取）\n"));
  if (files.length === 0) {
    write(c.dim(`  还没有。可以新建 ${DATA_DIR}/TUTOR.md（对所有目录生效）\n`));
    write(c.dim(`  或 ${cwd}/TUTOR.md（只对这个练习目录生效），写下你希望导师怎么教你，比如：\n`));
    write(c.dim("    - 多用做饭的例子打比方\n    - 每讲完一个知识点，先让我用自己的话复述一遍\n"));
  }
  for (const f of files) write(`  ${c.green("✓")} ${f}\n`);
}

// agent-tutor --test-search 关键词：不启动导师，直接检查搜索服务和 key 能不能用
async function testSearch(query: string) {
  const search = searchConfig(loadConfig());
  if (!search) {
    write(c.red("还没有配置搜索服务，请先运行：agent-tutor --setup") + "\n");
    process.exit(1);
  }
  write(c.dim(`正在用 ${search.provider} 搜索「${query}」……\n`));
  const ctx = { signal: new AbortController().signal, search } as ToolContext;
  try {
    const result: any = await webSearch({ query }, ctx);
    if (result.error) throw new Error(result.error);
    if (!result.results.length) write(c.yellow("搜索服务能用，但这次没搜到结果，换个关键词试试\n"));
    for (const [i, r] of result.results.entries()) {
      write(`\n${c.bold(`${i + 1}. ${r.title}`)}${r.site ? c.dim(`  · ${r.site}`) : ""}${r.date ? c.dim(`  · ${r.date.slice(0, 10)}`) : ""}\n`);
      write(c.cyan(r.url) + "\n");
      write(c.dim(r.snippet.slice(0, 120).replace(/\s+/g, " ")) + "\n");
    }
    write(c.green(`\n✅ ${search.provider} 搜索服务工作正常\n`));
  } catch (e) {
    write(c.red(`❌ 搜索失败：${e instanceof Error ? e.message : e}`) + "\n");
    process.exit(1);
  }
}

const MCP_EXAMPLE = `{
  "mcpServers": {
    "服务器名字": { "command": "npx", "args": ["-y", "MCP服务器的npm包名"] },
    "远程服务器": { "url": "https://example.com/mcp" }
  }
}`;

function showMcp(name?: string) {
  const statuses = mcpStatuses();
  if (name) {
    const server = statuses.find((s) => s.name === name);
    if (!server) return write(c.red(`没有叫 ${name} 的 MCP 服务器，输入 /mcp 查看全部`) + "\n");
    if (!server.ok) return write(`${c.red("✗")} ${c.bold(server.name)} ${c.red("连接失败：" + server.error)}\n`);
    write(`\n${c.green("✓")} ${c.bold(server.name)} ${c.dim(`共 ${server.tools.length} 个工具（导师调用时名字是 mcp__${server.name}__工具名）`)}\n`);
    for (const t of server.tools) write(`  ${c.cyan(t.name)}  ${c.dim(t.description || "（没有说明）")}\n`);
    return;
  }
  write(c.dim(`\n配置文件：${MCP_CONFIG_FILE}（修改后重启 agent-tutor 生效）\n`));
  if (statuses.length === 0) {
    write(`还没有配置 MCP 服务器。在配置文件里按这个格式填写（和 Claude Code 的格式一样）：\n${c.dim(MCP_EXAMPLE)}\n`);
    return;
  }
  for (const s of statuses) {
    if (s.ok) write(`${c.green("✓")} ${c.bold(s.name)} ${c.dim(`${s.tools.length} 个工具：${s.tools.map((t) => t.name).join("、")}`)}\n`);
    else write(`${c.red("✗")} ${c.bold(s.name)} ${c.red("连接失败：" + s.error)}\n`);
  }
  write(c.dim("输入 /mcp 服务器名 查看每个工具的说明\n"));
}

const AGENT_EXAMPLE = `---
name: code-reviewer
description: 代码检查员：检查学生写的代码有没有错误，用小白能懂的话指出问题
tools: read_file, list_files
---
你是代码检查员。先用 list_files 找到要检查的文件，再用 read_file 读代码。
逐个指出问题：哪一行、错在哪、怎么改。只指出问题，不要直接改文件。`;

function showAgents(cwd: string, name?: string) {
  const { agents, errors } = loadAgents(cwd);
  if (name) {
    const agent = agents.find((a) => a.name === name);
    if (!agent) return write(c.red(`没有叫 ${name} 的子 Agent，输入 /agents 查看全部`) + "\n");
    write(`\n${c.bold(agent.name)} ${c.dim(`· ${agent.source}`)}\n${agent.description}\n`);
    write(c.dim(`模型：${agent.model ?? "和导师一样"}\n`));
    write(c.dim(`工具：${toolsFor(agent).map((t) => t.name).join("、") || "无"}\n`));
    write(c.dim("人设：\n") + c.dim(agent.prompt.replace(/^/gm, "  │ ")) + "\n");
    return;
  }
  write(c.dim("\n导师可以把独立的任务派给这些子 Agent，它们做完只把结果交回给导师：\n"));
  for (const a of agents) write(`  ${c.cyan(a.name)} ${c.dim(a.source === "内置" ? "（内置）" : "（自定义）")}  ${a.description}\n`);
  for (const e of errors) write(c.red(`  ✗ ${e.path}：${e.error}`) + "\n");
  write(c.dim(`\n输入 /agents 名字 查看人设和能用的工具。想自定义子 Agent，在下面任一目录新建一个 .md 文件（改完不用重启）：\n`));
  for (const dir of agentDirs(cwd)) write(c.dim(`  ${dir}\n`));
  write(c.dim(`格式（和 Claude Code 的一样；tools 不写就能用除改记忆外的全部工具，mcp__* 表示所有 MCP 工具）：\n${AGENT_EXAMPLE}\n`));
}

// 启动时连接 MCP 服务器，把它们的工具加进导师的工具列表
async function setupMcp() {
  if (!existsSync(MCP_CONFIG_FILE)) return c.dim("未配置（输入 /mcp 查看说明）");
  write(c.dim("正在连接 MCP 服务器……\n"));
  try {
    const { statuses, tools } = await connectMcpServers(VERSION);
    registerTools(tools);
    const failed = statuses.filter((s) => !s.ok).length;
    if (statuses.length === 0) return c.dim("配置文件里没有启用的服务器");
    return c.dim(`${statuses.length - failed} 个服务器，${tools.length} 个工具`) + (failed ? c.red(`（${failed} 个连接失败，输入 /mcp 查看）`) : "");
  } catch (e) {
    return c.red(e instanceof Error ? e.message : String(e));
  }
}

// /cost：本次启动以来每个模型用了多少 token、花了多少钱
function showCost(meter: UsageMeter, config: Partial<Config>) {
  if (meter.byModel.size === 0) {
    write(c.dim("\n还没有用量记录。如果已经聊过几轮还是没有，说明这个模型服务不返回用量。\n"));
    return;
  }
  const prices = config.prices ?? {};
  write(c.bold("\n本次启动以来的用量\n"));
  for (const [model, u] of meter.byModel) {
    const cost = costOf(u, prices[model]);
    write(`  ${c.cyan(model)}  ${c.dim(`调用 ${u.calls} 次 · `)}${usageLine(u, cost, config.currency)}${cost === undefined ? c.dim("（没填价格）") : ""}\n`);
  }
  if (meter.byModel.size > 1) write(`  合计  ${usageLine(meter.total(), meter.cost(prices), config.currency)}\n`);
  if (meter.lastContext) write(c.dim(`\n现在的对话约 ${formatTokens(meter.lastContext)} token：下一次调用模型时，这些内容要全部再发一遍\n`));
  write(c.dim("小知识：输入 token 每一轮都会重复计费，对话越长越贵；/compact 压缩对话、把任务派给子 Agent 都能省输入 token。\n"));
  if (meter.byModel.size > 0 && [...meter.byModel.keys()].some((m) => !prices[m])) {
    write(c.dim(`想看花了多少钱：输入 /setup 填写模型价格；子 Agent 用了别的模型的话，在配置文件的 prices 里按模型名补上\n`));
  }
}

// agent-tutor -p "问题"：不进入对话，回答完就退出。回答输出到 stdout，其他提示输出到 stderr，方便写脚本调用
async function printMode(prompt: string) {
  const config = loadConfig();
  if (!isComplete(config)) {
    process.stderr.write("还没有配置模型，请先运行：agent-tutor --setup\n");
    process.exit(1);
  }
  const cwd = process.cwd();
  registerTools([taskTool(cwd)]);
  const meter = new UsageMeter();
  const ctx: ToolContext = {
    client: new OpenAI({ apiKey: config.apiKey || "EMPTY", baseURL: config.baseURL }),
    model: config.model,
    cwd,
    signal: new AbortController().signal,
    search: searchConfig(config),
    // 没人在旁边回答"允许吗"，需要确认的操作一律拒绝
    confirm: async (_tool, title) => {
      process.stderr.write(`（-p 模式不执行需要确认的操作，已拒绝：${title}）\n`);
      return false;
    },
    onUsage: (model, usage) => meter.add(model, usage),
  };
  setMuted(true); // 待办清单、子 Agent 进度这些提示不输出到 stdout
  const messages: Message[] = [
    { role: "system", content: systemPrompt(cwd) },
    { role: "user", content: prompt },
  ];
  try {
    await runTurn(messages, ctx, { onText: (delta) => process.stdout.write(delta), onToolCall: () => {} });
    process.stdout.write("\n");
    if (meter.byModel.size) process.stderr.write(`（${usageLine(meter.total(), meter.cost(config.prices), config.currency)}）\n`);
  } catch (e) {
    process.stderr.write(`出错了：${explainError(e)}\n`);
    process.exit(1);
  }
}

// agent-tutor --eval [测试题文件] [--only 名字] [-v]
async function evalMode(args: string[]) {
  const config = loadConfig();
  if (!isComplete(config)) {
    write(c.red("还没有配置模型，请先运行：agent-tutor --setup") + "\n");
    process.exit(1);
  }
  let file: string | undefined;
  let only: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--only") only = args[++i];
    else if (!args[i].startsWith("-")) file ??= args[i];
  }
  registerTools([taskTool(process.cwd())]);
  try {
    const failed = await runEval(config, { file, only, verbose: args.includes("-v") });
    process.exit(failed ? 1 : 0);
  } catch (e) {
    write(c.red(`评估失败：${explainError(e)}`) + "\n");
    process.exit(1);
  }
}

async function main() {
  const testIndex = process.argv.indexOf("--test-search");
  if (testIndex !== -1) return testSearch(process.argv.slice(testIndex + 1).join(" ") || "AI Agent 是什么");
  const evalIndex = process.argv.indexOf("--eval");
  if (evalIndex !== -1) return evalMode(process.argv.slice(evalIndex + 1));
  const printIndex = process.argv.findIndex((a) => a === "-p" || a === "--print");
  if (printIndex !== -1) {
    const prompt = process.argv.slice(printIndex + 1).join(" ").trim();
    if (!prompt) {
      process.stderr.write('用法：agent-tutor -p "你的问题"\n');
      process.exit(1);
    }
    return printMode(prompt);
  }

  // escapeCodeTimeout：单独按 Esc 时，终端要等一会儿才能确定不是方向键等组合键的开头，默认等 500 毫秒，太慢了
  const rl = createInterface({ input: stdin, output: stdout, escapeCodeTimeout: 50 });
  const completion = attachCompletion(rl, suggestCommands);
  let closed = false;
  rl.on("close", async () => {
    closed = true;
    write(c.dim("\n再见！下次输入 agent-tutor 继续学习。\n"));
    await Promise.race([closeMcpServers(), new Promise((r) => setTimeout(r, 2000))]); // 关闭 MCP 服务器，最多等 2 秒
    process.exit(0);
  });

  let config: Partial<Config> = loadConfig();
  if (process.argv.includes("--setup") || !isComplete(config)) config = await runSetup(rl);
  const makeClient = (cfg: Config) => new OpenAI({ apiKey: cfg.apiKey || "EMPTY", baseURL: cfg.baseURL });
  let client = makeClient(config as Config);

  const cwd = process.cwd();
  // system 消息每次都重新生成：这样改了 TUTOR.md 或升级了导师规则，恢复旧对话时也会用上最新的
  const newConversation = (history: Message[] = []): Message[] => [{ role: "system", content: systemPrompt(cwd) }, ...history];
  let messages = newConversation();
  let sessionId = newSessionId();
  const alwaysAllowed = new Set<string>(); // 学生选了"本次都允许"的工具
  cleanupSessions();

  // token 用量：meter 累计本次启动以来的，turnMeter 只记这一轮的（每轮回答完显示一行）
  const meter = new UsageMeter();
  let turnMeter = new UsageMeter();
  const onUsage = (model: string, usage: { input: number; output: number; cached: number }, subagent?: boolean) => {
    meter.add(model, usage);
    turnMeter.add(model, usage);
    if (!subagent) meter.lastContext = usage.input;
  };

  function resume(id: string) {
    const session = loadSession(id);
    if (!session) return false;
    messages = newConversation(session.messages);
    sessionId = session.id;
    alwaysAllowed.clear();
    restoreTodos(session.messages);
    const lastReply = [...session.messages].reverse().find((m) => m.role === "assistant" && typeof m.content === "string" && m.content);
    write(c.dim(`\n已恢复 ${formatTime(session.updated)} 的对话「${session.title}」\n`));
    if (lastReply) write(c.dim(`导师上次说到：${plainText(String(lastReply.content)).slice(-120)}\n`));
    return true;
  }

  async function pickSession(arg: string) {
    const sessions = recentSessions();
    if (sessions.length === 0) return write(c.dim("还没有保存过的对话。\n"));
    if (arg) {
      const picked = sessions[Number(arg) - 1];
      if (picked) resume(picked.id);
      else write(c.red(`没有第 ${arg} 个对话，输入 /resume 查看列表`) + "\n");
      return;
    }
    write("\n最近的对话：\n");
    sessions.forEach((s, i) => {
      const here = s.cwd === cwd ? "" : c.dim(`  （在 ${s.cwd}）`);
      write(`  ${c.bold(String(i + 1))}. ${formatTime(s.updated)}  ${s.title}  ${c.dim(`${s.turns} 轮`)}${here}\n`);
    });
    const answer = (await rl.question("输入序号恢复，直接回车取消：")).trim();
    const picked = sessions[Number(answer) - 1];
    if (picked) resume(picked.id);
  }

  // 压缩对话：失败时退回到直接丢弃最早的内容
  async function compact(signal: AbortSignal, manual: boolean) {
    write(c.dim(manual ? "正在压缩对话……\n" : "\n对话有点长了，正在把旧内容整理成摘要……\n"));
    try {
      const count = await compactHistory(messages, { client, model: config.model!, signal, onUsage: (m, u) => onUsage(m, u, true) });
      if (count === 0 && manual) write(c.dim("对话还很短，不用压缩。\n"));
      if (count > 0) write(c.dim(`已把 ${count} 条旧消息压缩成一份摘要，最近的对话保留原文。\n`));
      if (needsCompaction(messages)) trimHistory(messages); // 还是太长（很少见），只能丢掉最早的内容
    } catch (e) {
      if (signal.aborted) throw e;
      trimHistory(messages);
      write(c.yellow(`压缩失败（${explainError(e)}），已直接丢掉最早的几轮对话。\n`));
    }
    saveSession(sessionId, cwd, messages);
  }

  // Ctrl+C：正在回答时打断这一轮；空闲时退出
  let controller: AbortController | null = null;
  rl.on("SIGINT", () => (controller ? controller.abort() : rl.close()));

  async function confirm(toolName: string, title: string, detail: string) {
    // 几个子 Agent 同时干活时可能同时来问，排好队一个一个问
    const ask = confirmQueue.then(() => askConfirm(toolName, title, detail));
    confirmQueue = ask.then(
      () => {},
      () => {},
    );
    return ask;
  }
  let confirmQueue = Promise.resolve();

  async function askConfirm(toolName: string, title: string, detail: string) {
    if (alwaysAllowed.has(toolName)) return true;
    printConfirm(title, detail);
    const answer = (
      await rl.question(c.yellow("允许吗？[y] 允许 / [a] 本次对话都允许 / [n] 拒绝："), { signal: controller!.signal })
    )
      .trim()
      .toLowerCase();
    if (answer === "a") alwaysAllowed.add(toolName);
    return answer === "y" || answer === "a";
  }

  registerTools([taskTool(cwd)]);
  const mcpSummary = await setupMcp();
  write(`\n${c.bold("🤖 Agent 导师")} ${c.dim(`v${VERSION}`)}\n`);
  const search = searchConfig(config);
  write(c.dim(`模型：${config.model}    网页搜索：${search ? search.provider : "未开启（/setup 配置）"}\n`));
  write(c.dim("MCP：") + mcpSummary + "\n");
  write(c.dim(`练习目录：${cwd}\n`));
  if (instructionFiles(cwd).length) write(c.dim(`已读取你的说明文件 TUTOR.md\n`));
  write(c.dim("输入 /help 查看命令。试着说：你好，我想学 AI Agent\n"));

  if (process.argv.includes("--continue") || process.argv.includes("-c")) {
    const last = latestSession(cwd);
    if (!last || !resume(last.id)) write(c.dim("\n这个目录里还没有保存过的对话，开始新对话。\n"));
  }

  while (true) {
    let input: string;
    try {
      completion.enable();
      input = (await rl.question(c.bold(c.green("\n你 › ")))).trim();
      completion.disable();
    } catch (e) {
      if (closed) return; // 正在退出（在关闭 MCP 服务器），不再等输入
      throw e;
    }
    if (!input) continue;

    if (input.startsWith("/")) {
      const [name, ...rest] = input.slice(1).split(/\s+/);
      const cmd = name.toLowerCase();
      const arg = rest.join(" ");
      if (cmd === "exit" || cmd === "quit") rl.close();
      else if (cmd === "help") write("\n" + helpText() + "\n");
      else if (cmd === "progress") showProgress();
      else if (cmd === "mcp") showMcp(arg);
      else if (cmd === "agents") showAgents(cwd, arg);
      else if (cmd === "cost") showCost(meter, config);
      else if (cmd === "todos") printTodos();
      else if (cmd === "memory") showMemory(cwd);
      else if (cmd === "resume") await pickSession(arg);
      else if (cmd === "compact") {
        controller = new AbortController();
        try {
          await compact(controller.signal, true);
        } catch {
          write(c.yellow("（已取消）\n"));
        } finally {
          controller = null;
        }
      } else if (cmd === "clear") {
        messages = newConversation();
        sessionId = newSessionId();
        alwaysAllowed.clear();
        clearTodos();
        write(c.dim("已开始新对话（之前的对话已保存，可以用 /resume 找回）。\n"));
      } else if (cmd === "setup") {
        config = await runSetup(rl);
        client = makeClient(config as Config);
      } else write(c.red(`没有这个命令：${input}，输入 /help 查看`) + "\n");
      continue;
    }

    controller = new AbortController();
    if (needsCompaction(messages)) {
      try {
        await compact(controller.signal, false);
      } catch {
        write(c.yellow("（已取消）\n"));
        controller = null;
        continue;
      }
    }
    const before = messages.length;
    messages.push({ role: "user", content: input });
    const ctx: ToolContext = {
      client,
      model: config.model!,
      cwd,
      signal: controller.signal,
      confirm,
      search: searchConfig(config),
      onUsage,
    };
    turnMeter = new UsageMeter();

    const prefix = "导师 › ";
    write("\n" + c.bold(c.cyan(prefix)));
    const md = new MarkdownStream(write, textWidth(prefix));
    const events = {
      onText: (delta: string) => md.push(delta),
      onToolCall: (name: string, args: string) => {
        md.flush(); // 先把已经说的话显示完，再显示工具调用提示
        printToolCall(name, args);
      },
    };
    try {
      await runTurn(messages, ctx, events);
      md.flush();
      newline();
      saveSession(sessionId, cwd, messages); // 每说完一轮就存档
    } catch (e) {
      messages.length = before; // 回滚这一轮，保证对话历史完整
      md.flush();
      newline();
      if (controller.signal.aborted) write(c.yellow("（已打断，可以重新说）\n"));
      else write(c.red(`出错了：${explainError(e)}`) + "\n");
    } finally {
      controller = null;
      // 这一轮用了多少 token（被打断的也算，钱已经花了）
      if (turnMeter.byModel.size) {
        const u = turnMeter.total();
        const calls = u.calls > 1 ? `调用模型 ${u.calls} 次 · ` : "";
        write(c.dim(`  ↳ ${calls}${usageLine(u, turnMeter.cost(config.prices), config.currency)}`) + "\n");
      }
    }
  }
}

main();
