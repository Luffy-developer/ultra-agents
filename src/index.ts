#!/usr/bin/env node
// 命令行入口：读配置 → 启动对话 → 每轮把用户输入交给 Agent
import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";
import { runTurn, systemPrompt, trimHistory, type Message } from "./agent.js";
import { type Config, isComplete, loadConfig, runSetup, searchConfig } from "./config.js";
import { getProgress, listLessons, type ToolContext } from "./tools.js";
import { c, newline, printConfirm, printToolCall, write } from "./ui.js";
import { webSearch } from "./web.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;

const HELP = `
命令：
  /progress  查看学习进度
  /clear     开始新对话（学习进度不会丢）
  /setup     修改模型和搜索服务配置
  /help      显示帮助
  /exit      退出（也可以按 Ctrl+D）
正在回答时按 Ctrl+C 可以打断。`;

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
  if (p.notes.length) write(c.dim(`备注：${p.notes.join("；")}\n`));
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

async function main() {
  const testIndex = process.argv.indexOf("--test-search");
  if (testIndex !== -1) return testSearch(process.argv.slice(testIndex + 1).join(" ") || "AI Agent 是什么");

  const rl = createInterface({ input: stdin, output: stdout });
  rl.on("close", () => {
    write(c.dim("\n再见！下次输入 agent-tutor 继续学习。\n"));
    process.exit(0);
  });

  let config: Partial<Config> = loadConfig();
  if (process.argv.includes("--setup") || !isComplete(config)) config = await runSetup(rl);
  const makeClient = (cfg: Config) => new OpenAI({ apiKey: cfg.apiKey || "EMPTY", baseURL: cfg.baseURL });
  let client = makeClient(config as Config);

  const cwd = process.cwd();
  const newConversation = (): Message[] => [{ role: "system", content: systemPrompt(cwd) }];
  let messages = newConversation();
  const alwaysAllowed = new Set<string>(); // 学生选了"本次都允许"的工具

  // Ctrl+C：正在回答时打断这一轮；空闲时退出
  let controller: AbortController | null = null;
  rl.on("SIGINT", () => (controller ? controller.abort() : rl.close()));

  async function confirm(toolName: string, title: string, detail: string) {
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

  write(`\n${c.bold("🤖 Agent 导师")} ${c.dim(`v${VERSION}`)}\n`);
  const search = searchConfig(config);
  write(c.dim(`模型：${config.model}    网页搜索：${search ? search.provider : "未开启（/setup 配置）"}\n`));
  write(c.dim(`练习目录：${cwd}\n`));
  write(c.dim("输入 /help 查看命令。试着说：你好，我想学 AI Agent\n"));

  while (true) {
    const input = (await rl.question(c.bold(c.green("\n你 › ")))).trim();
    if (!input) continue;

    if (input.startsWith("/")) {
      const cmd = input.slice(1).toLowerCase();
      if (cmd === "exit" || cmd === "quit") rl.close();
      else if (cmd === "help") write(HELP + "\n");
      else if (cmd === "progress") showProgress();
      else if (cmd === "clear") {
        messages = newConversation();
        alwaysAllowed.clear();
        write(c.dim("已开始新对话。\n"));
      } else if (cmd === "setup") {
        config = await runSetup(rl);
        client = makeClient(config as Config);
      } else write(c.red(`没有这个命令：${input}，输入 /help 查看`) + "\n");
      continue;
    }

    trimHistory(messages);
    const before = messages.length;
    messages.push({ role: "user", content: input });
    controller = new AbortController();
    const ctx: ToolContext = {
      client,
      model: config.model!,
      cwd,
      signal: controller.signal,
      confirm,
      search: searchConfig(config),
    };

    write(c.bold(c.cyan("\n导师 › ")));
    try {
      await runTurn(messages, ctx, { onText: write, onToolCall: printToolCall });
      newline();
    } catch (e) {
      messages.length = before; // 回滚这一轮，保证对话历史完整
      newline();
      if (controller.signal.aborted) write(c.yellow("（已打断，可以重新说）\n"));
      else write(c.red(`出错了：${explainError(e)}`) + "\n");
    } finally {
      controller = null;
    }
  }
}

main();
