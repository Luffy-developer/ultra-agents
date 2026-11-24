#!/usr/bin/env node
// 命令行入口：读配置 → 启动对话 → 每轮把用户输入交给 Agent
import { existsSync, readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";
import { compactHistory, needsCompaction, runTurn, systemPrompt, trimHistory, type Message } from "./agent.js";
import { type Config, DATA_DIR, isComplete, loadConfig, runSetup, saveModel, searchConfig } from "./config.js";
import { formatTime, helpText, recentSessions, setModelChoices, splitArgs, suggestCommands } from "./commands.js";
import { HOOK_EVENTS, HOOKS_FILE, loadHooks, runHooks, setHooksEnabled } from "./hooks.js";
import { attachCompletion } from "./input.js";
import { MarkdownStream, plainText } from "./markdown.js";
import { addMcpServer, closeMcpServers, connectMcpServers, MCP_CONFIG_FILE, mcpStatuses, mcpToolPrefix, removeMcpServer, type ServerConfig } from "./mcp.js";
import { getProgress, instructionFiles } from "./memory.js";
import { runEval } from "./eval.js";
import { cleanupSessions, latestSession, loadSession, newSessionId, saveSession } from "./session.js";
import { loadSkills, skillDirs, skillMessage, skillTool } from "./skills.js";
import { agentDirs, loadAgents, taskTool, toolsFor } from "./subagents.js";
import { clearTodos, printTodos, restoreTodos } from "./todo.js";
import { listLessons, registerTools, toolLabel, type ToolContext, unregisterTools } from "./tools.js";
import * as activity from "./activity.js";
import { c, newline, printConfirm, setMuted, tagLine, textWidth, write } from "./ui.js";
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
  write(c.dim(`\n配置文件：${MCP_CONFIG_FILE}（用 /mcp add、/mcp remove 修改马上生效；直接改文件要重启）\n`));
  if (statuses.length === 0) {
    write(`还没有配置 MCP 服务器。最简单的办法：输入 /mcp add 查看用法。\n也可以直接在配置文件里按这个格式填写（和 Claude Code 的格式一样）：\n${c.dim(MCP_EXAMPLE)}\n`);
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
    if (agent.reviewer) write(c.dim(`审核员：${agent.reviewer}（交结果前先请它检查，不通过就退回修改）\n`));
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

const MCP_ADD_USAGE = `用法：
  /mcp add 名字 命令 [参数...]   本地服务器，如：/mcp add everything npx -y @modelcontextprotocol/server-everything
  /mcp add 名字 网址             远程服务器，如：/mcp add 远程 https://example.com/mcp
  需要 key 时：/mcp add 名字 -e KEY=值 npx -y 包名
  远程服务器加请求头：/mcp add 名字 -H "Authorization: Bearer 你的token" https://...
  （-e、-H 要写在命令或网址的前面；名字相同会覆盖原来的）
删除：/mcp remove 名字`;

// /mcp add：写进 mcp.json，马上连接，工具立刻就能用
async function mcpAdd(tokens: string[]) {
  const [name, ...rest] = tokens;
  if (!name || rest.length === 0) return write(MCP_ADD_USAGE + "\n");
  if (!/^[\w一-龥-]+$/.test(name)) return write(c.red(`名字只能用字母、数字、中文、- 和 _：${name}`) + "\n");
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  let i = 0;
  for (; i < rest.length && rest[i].startsWith("-"); i += 2) {
    const [flag, value = ""] = [rest[i], rest[i + 1]];
    const sep = flag === "-H" || flag === "--header" ? value.indexOf(":") : value.indexOf("=");
    if (sep <= 0 || !["-e", "--env", "-H", "--header"].includes(flag)) return write(c.red(`看不懂：${flag} ${value}`) + "\n" + MCP_ADD_USAGE + "\n");
    const target = flag === "-e" || flag === "--env" ? env : headers;
    target[value.slice(0, sep).trim()] = value.slice(sep + 1).trim();
  }
  const target = rest.slice(i);
  if (target.length === 0) return write(MCP_ADD_USAGE + "\n");
  const cfg: ServerConfig = /^https?:\/\//.test(target[0])
    ? { url: target[0], ...(Object.keys(headers).length > 0 && { headers }) }
    : { command: target[0], args: target.slice(1), ...(Object.keys(env).length > 0 && { env }) };
  write(c.dim(`正在连接 ${name}……（第一次用 npx 要先下载，可能要等一会儿）\n`));
  unregisterTools((t) => t.name.startsWith(mcpToolPrefix(name))); // 同名的旧服务器的工具先去掉
  const { status, tools } = await addMcpServer(name, cfg, VERSION);
  registerTools(tools);
  if (status.ok) {
    write(`${c.green("✓")} 已添加 ${c.bold(name)}，共 ${tools.length} 个工具：${c.dim(status.tools.map((t) => t.name).join("、"))}\n`);
    write(c.dim(`已保存到 ${MCP_CONFIG_FILE}，下次启动会自动连接。导师现在就能用这些工具了。\n`));
  } else {
    write(`${c.red("✗")} 已保存到配置，但连接失败：${status.error}\n`);
    write(c.dim(`检查命令或网址后，再运行一次 /mcp add ${name} … 覆盖；不要了就 /mcp remove ${name}\n`));
  }
}

async function mcpRemove(name?: string) {
  if (!name) return write("用法：/mcp remove 名字\n");
  const existed = await removeMcpServer(name);
  unregisterTools((t) => t.name.startsWith(mcpToolPrefix(name)));
  write(existed ? c.green(`已删除 MCP 服务器 ${name}`) + "\n" : c.red(`没有叫 ${name} 的 MCP 服务器`) + "\n");
}

// 向模型服务查询有哪些模型（OpenAI 兼容接口的 GET /models），查不到就返回空列表
async function listModels(client: OpenAI) {
  const ids: string[] = [];
  try {
    for await (const m of client.models.list({ signal: AbortSignal.timeout(5000) })) {
      ids.push(m.id);
      if (ids.length >= 200) break;
    }
  } catch {}
  return ids.sort();
}

const SKILL_EXAMPLE = `---
name: weekly-review
description: 帮学生做每周学习复盘。学生说"复盘一下""这周学了什么"时使用
---
1. 用 get_progress 看这周学完了哪些课
2. 每节课问学生一个问题，检查还记不记得
3. 把答不上来的知识点用 remember 记下来，下次上课先复习`;

function showSkills(cwd: string, name?: string) {
  const { skills, errors } = loadSkills(cwd);
  if (name) {
    const skill = skills.find((s) => s.name === name);
    if (!skill) return write(c.red(`没有叫 ${name} 的技能，输入 /skills 查看全部`) + "\n");
    write(`\n${c.bold(skill.name)} ${c.dim(`· ${skill.source}`)}\n${skill.description}\n`);
    write(c.dim(skill.content.replace(/^/gm, "  │ ")) + "\n");
    return;
  }
  write(c.dim("\n技能是写好的「做事方法说明书」：导师平时只看名字和说明，用得上时才读全文。也可以输入 /技能名 直接使用：\n"));
  if (skills.length === 0) write(c.dim("  还没有技能\n"));
  for (const s of skills) write(`  ${c.cyan("/" + s.name)} ${c.dim(s.source === "内置" ? "（内置）" : "（自定义）")}  ${s.description}\n`);
  for (const e of errors) write(c.red(`  ✗ ${e.path}：${e.error}`) + "\n");
  write(c.dim(`\n输入 /skills 名字 查看全文。想自己写技能：在下面任一目录里新建一个文件夹，里面放一个 SKILL.md（改完不用重启）：\n`));
  for (const dir of skillDirs(cwd)) write(c.dim(`  ${dir}/技能名/SKILL.md\n`));
  write(c.dim(`格式（和 Claude Code 的一样；文件夹里还可以放模板、例子等附件，导师需要时会读）：\n${SKILL_EXAMPLE}\n`));
}

const HOOKS_EXAMPLE = `{
  "hooks": {
    "PostToolUse": [{ "matcher": "write_file|edit_file", "command": "npx prettier --write \\"$AGENT_TUTOR_FILE\\"" }],
    "PreToolUse": [{ "matcher": "run_command", "command": "grep -q 'rm -rf' && echo '不许删除文件' >&2 && exit 2 || exit 0" }],
    "Stop": [{ "command": "afplay /System/Library/Sounds/Glass.aiff" }]
  }
}`;

function showHooks() {
  write(c.dim(`\n配置文件：${HOOKS_FILE}（改完马上生效，不用重启）\n`));
  let hooks;
  try {
    hooks = loadHooks();
  } catch (e) {
    return write(c.red(e instanceof Error ? e.message : String(e)) + "\n");
  }
  const total = HOOK_EVENTS.reduce((n, e) => n + hooks[e].length, 0);
  if (total > 0) {
    for (const event of HOOK_EVENTS) {
      for (const h of hooks[event]) write(`  ${c.cyan(event)}${h.matcher ? c.dim(` [${h.matcher}]`) : ""}  ${h.command}\n`);
    }
  } else write("还没有设置 hooks。\n");
  write(c.dim(`
Hooks 会在特定时刻自动运行你写的命令：
  PreToolUse        导师调用工具之前（命令以退出码 2 结束 = 拦下这次调用，错误输出会告诉导师原因）
  PostToolUse       工具执行完之后（比如写完文件自动格式化）
  UserPromptSubmit  你发消息之后、导师回答之前（命令的输出会作为补充信息交给导师）
  Stop              导师回答完一轮
matcher 是匹配工具名的正则，不写就是所有工具。命令能从环境变量 AGENT_TUTOR_FILE 拿到文件路径，从标准输入拿到完整信息（JSON）。
例子（和 Claude Code 的格式基本一样）：
${HOOKS_EXAMPLE}
`));
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
  registerTools([taskTool(cwd), skillTool(cwd)]);
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
  registerTools([taskTool(process.cwd()), skillTool(process.cwd())]);
  setHooksEnabled(false); // 评估要测的是导师本身，不受你自己设置的 hooks 影响
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
  const completion = attachCompletion(rl, suggestCommands, () => {
    process.stdout.write("\r\x1b[2K");
    activity.printDetails();
    rl.prompt(true);
  });
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
    activity.restoreTurns(session.messages, toolLabel);
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

  async function switchModel(name: string) {
    if (!name) {
      write(`\n当前模型：${c.bold(config.model!)}\n`);
      write(c.dim("正在向模型服务查询可用的模型……\n"));
      const ids = await listModels(client);
      setModelChoices([...ids, ...Object.keys(config.prices ?? {})], config.model!);
      if (ids.length === 0) write(c.dim("这个模型服务没有提供模型列表，可以直接输入 /model 模型名 切换。\n"));
      for (const id of ids.slice(0, 50)) write(`  ${id === config.model ? c.green("● " + id) : c.dim("○ ") + id}\n`);
      if (ids.length > 50) write(c.dim(`  …共 ${ids.length} 个，输入 /model 加空格可以边打字边筛选\n`));
      write(c.dim("输入 /model 模型名 切换（会保存为默认模型）。\n"));
      return;
    }
    const known = await listModels(client);
    config.model = name;
    saveModel(name);
    setModelChoices([...known, ...Object.keys(config.prices ?? {})], name);
    write(c.green(`已切换到 ${name}，并保存为默认模型。`) + "\n");
    if (known.length > 0 && !known.includes(name)) write(c.yellow("注意：模型服务的列表里没有这个名字，如果写错了，下一轮回答会报错。") + "\n");
    if (!config.prices?.[name]) write(c.dim("这个模型还没填价格，/cost 算不出花费；需要的话在 /setup 里填。\n"));
    if (process.env.MODEL_NAME) write(c.yellow(`注意：环境变量 MODEL_NAME=${process.env.MODEL_NAME} 的优先级更高，下次启动还会用它。`) + "\n");
  }

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

  registerTools([taskTool(cwd), skillTool(cwd)]);
  const mcpSummary = await setupMcp();
  write(`\n${c.bold("🤖 Agent 导师")} ${c.dim(`v${VERSION}`)}\n`);
  const search = searchConfig(config);
  write(c.dim(`模型：${config.model}    网页搜索：${search ? search.provider : "未开启（/setup 配置）"}\n`));
  write(c.dim("MCP：") + mcpSummary + "\n");
  let hookCount = 0;
  try {
    hookCount = Object.values(loadHooks()).flat().length;
  } catch {}
  write(c.dim(`技能：${loadSkills(cwd).skills.length} 个（/skills 查看）    Hooks：${hookCount ? `${hookCount} 个` : "未设置（/hooks 查看说明）"}\n`));
  // 模型列表：先放上配置里填过价格的，再到后台查一下模型服务有哪些模型（给 /model 的补全菜单用）
  setModelChoices(Object.keys(config.prices ?? {}), config.model!);
  listModels(client).then((ids) => setModelChoices([...ids, ...Object.keys(config.prices ?? {})], config.model!));
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
    const typed = input; // 学生实际输入的（用技能时 input 会被换成技能说明）

    let skillInput: string | undefined;
    if (input.startsWith("/")) {
      const [name, ...rest] = input.slice(1).split(/\s+/);
      const cmd = name.toLowerCase();
      const arg = rest.join(" ");
      if (cmd === "exit" || cmd === "quit") rl.close();
      else if (cmd === "help") write("\n" + helpText() + "\n");
      else if (cmd === "progress") showProgress();
      else if (cmd === "mcp") {
        const [sub, ...args] = splitArgs(arg);
        if (sub === "add") await mcpAdd(args);
        else if (sub === "remove" || sub === "rm") await mcpRemove(args[0]);
        else showMcp(arg);
      } else if (cmd === "model") await switchModel(arg);
      else if (cmd === "skills") showSkills(cwd, arg);
      else if (cmd === "hooks") showHooks();
      else if (cmd === "details") activity.printDetails(arg);
      else if (cmd === "verbose") {
        activity.setExpanded(!activity.isExpanded());
        write(c.dim(activity.isExpanded() ? "已切换为完整显示：思考过程和每次工具调用都直接显示出来。再输入 /verbose 切换回折叠显示。\n" : "已切换为折叠显示：过程只显示一行总结，按 Ctrl+O 展开。\n"));
      }
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
        activity.clearTurns();
        write(c.dim("已开始新对话（之前的对话已保存，可以用 /resume 找回）。\n"));
      } else if (cmd === "setup") {
        config = await runSetup(rl);
        client = makeClient(config as Config);
        setModelChoices(Object.keys(config.prices ?? {}), config.model!);
      } else {
        // 不是内置命令，看看是不是技能：/技能名 要求
        const skill = loadSkills(cwd).skills.find((sk) => sk.name.toLowerCase() === cmd);
        if (skill) {
          write(tagLine("skill", `使用技能 ${skill.name}`) + "\n");
          skillInput = skillMessage(skill, arg);
        } else write(c.red(`没有这个命令：${input}，输入 /help 查看`) + "\n");
      }
      if (!skillInput) continue;
      input = skillInput;
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
    activity.startTurn(typed); // 开始记录这一轮的过程（Ctrl+O、/details 展开时看的就是它）
    // UserPromptSubmit hooks：可以拦下这条消息，或者给导师补充信息（比如当前时间、git 状态）
    const hook = await runHooks("UserPromptSubmit", { prompt: input }, { cwd, signal: controller.signal });
    activity.end();
    if (hook.blocked) {
      write(c.yellow("这条消息没有发给导师。") + "\n");
      controller = null;
      continue;
    }
    const before = messages.length;
    const extra = hook.output.length ? `\n\n（以下是学生设置的 hook 自动补充的信息）\n${hook.output.join("\n")}` : "";
    messages.push({ role: "user", content: input + extra });
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
    // 思考过程和工具调用折叠成一行灰色总结（activity.ts），导师开始说话时把总结行定下来
    const events = {
      onThinking: (delta: string) => {
        md.flush();
        activity.thinking(delta);
      },
      onText: (delta: string) => {
        activity.end();
        md.push(delta);
      },
      onToolCall: (name: string, args: string) => {
        md.flush(); // 先把已经说的话显示完，再显示工具调用
        activity.toolCall(name, args, toolLabel(name));
      },
      onToolResult: (_name: string, result: unknown) => activity.toolResult(result),
    };
    try {
      const reply = await runTurn(messages, ctx, events);
      activity.end();
      md.flush();
      newline();
      saveSession(sessionId, cwd, messages); // 每说完一轮就存档
      await runHooks("Stop", { reply: reply ?? "" }, { cwd });
    } catch (e) {
      messages.length = before; // 回滚这一轮，保证对话历史完整
      activity.end();
      md.flush();
      newline();
      if (controller.signal.aborted) write(c.yellow("（已打断，可以重新说）\n"));
      else write(c.red(`出错了：${explainError(e)}`) + "\n");
    } finally {
      controller = null;
      activity.end();
      // 这一轮用了多少 token（被打断的也算，钱已经花了）
      if (turnMeter.byModel.size) {
        const u = turnMeter.total();
        const calls = u.calls > 1 ? `调用模型 ${u.calls} 次 · ` : "";
        write(tagLine("usage", `${calls}${usageLine(u, turnMeter.cost(config.prices), config.currency)}`) + "\n");
      }
    }
  }
}

main();
