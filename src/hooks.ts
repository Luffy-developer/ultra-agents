// Hooks（钩子）：在特定的时刻，自动运行你自己写的命令（和 Claude Code 的 Hooks 一样）
// 比如：导师每写完一个文件就自动格式化；导师想运行某些命令时直接拦下；每轮回答完响一声提示音
//
// 配置文件 ~/.agent-tutor/hooks.json：
// {
//   "hooks": {
//     "PreToolUse":       [{ "matcher": "run_command", "command": "..." }],   ← 工具执行前。命令以退出码 2 结束 = 拦下这次调用
//     "PostToolUse":      [{ "matcher": "write_file|edit_file", "command": "npx prettier --write \"$AGENT_TUTOR_FILE\"" }],
//     "UserPromptSubmit": [{ "command": "date" }],         ← 学生发消息后、导师回答前。命令的输出会作为补充信息交给导师
//     "Stop":             [{ "command": "afplay /System/Library/Sounds/Glass.aiff" }]   ← 导师回答完一轮
//   }
// }
// - matcher 是正则，匹配工具名；不写就是所有工具
// - 命令能拿到的信息：标准输入里是一段 JSON（事件、工具名、参数、结果……），
//   环境变量 AGENT_TUTOR_EVENT、AGENT_TUTOR_TOOL、AGENT_TUTOR_FILE（工具参数里的文件的完整路径）
// - 安全：只读取 ~/.agent-tutor/ 里的配置，不读练习目录里的。
//   不然下载一个别人的项目，一打开就可能自动执行别人写好的命令
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DATA_DIR } from "./config.js";
import * as activity from "./activity.js";

export const HOOKS_FILE = join(DATA_DIR, "hooks.json");
export const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface Hook {
  matcher?: string;
  command: string;
}

const TIMEOUT_MS = 60_000;
const BLOCK_EXIT_CODE = 2;
let enabled = true;

// 自动化评估时关掉：评估要测的是导师本身，不能受你自己的 hooks 影响
export function setHooksEnabled(value: boolean) {
  enabled = value;
}

// 也兼容 Claude Code 的写法：{ "matcher": "...", "hooks": [{ "type": "command", "command": "..." }] }
export function loadHooks(): Record<HookEvent, Hook[]> {
  const result = Object.fromEntries(HOOK_EVENTS.map((e) => [e, [] as Hook[]])) as Record<HookEvent, Hook[]>;
  if (!existsSync(HOOKS_FILE)) return result;
  let json: any;
  try {
    json = JSON.parse(readFileSync(HOOKS_FILE, "utf-8"));
  } catch (e) {
    throw new Error(`${HOOKS_FILE} 不是合法的 JSON：${e instanceof Error ? e.message : e}`);
  }
  for (const event of HOOK_EVENTS) {
    for (const item of json.hooks?.[event] ?? []) {
      if (typeof item?.command === "string") result[event].push({ matcher: item.matcher, command: item.command });
      for (const h of item?.hooks ?? []) if (typeof h?.command === "string") result[event].push({ matcher: item.matcher, command: h.command });
    }
  }
  return result;
}

function matches(hook: Hook, tool?: string) {
  if (!tool || !hook.matcher || hook.matcher === "*") return true;
  try {
    return new RegExp(`^(?:${hook.matcher})$`).test(tool);
  } catch {
    return false;
  }
}

function exec(command: string, input: string, env: NodeJS.ProcessEnv, cwd: string, signal?: AbortSignal) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = spawn(command, { shell: true, cwd, env, signal, timeout: TIMEOUT_MS });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.on("error", () => {}); // 命令不读标准输入时，写入会报错，忽略
    child.on("error", (e) => done({ code: 1, stdout, stderr: stderr || e.message }));
    child.on("close", (code) => done({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(input);
  });
}

export interface HookPayload {
  tool?: string;
  args?: any;
  result?: unknown;
  prompt?: string;
  reply?: string;
}

// 运行某个事件的所有 hooks。blocked：被拦下的原因；output：命令输出的内容
export async function runHooks(event: HookEvent, payload: HookPayload, ctx: { cwd: string; signal?: AbortSignal }) {
  const outcome: { blocked?: string; output: string[] } = { output: [] };
  if (!enabled) return outcome;
  let hooks: Hook[];
  try {
    hooks = loadHooks()[event].filter((h) => matches(h, payload.tool));
  } catch (e) {
    activity.warn(`  ⎿ [hook]${e instanceof Error ? e.message : e}`);
    return outcome;
  }
  const file = typeof payload.args?.path === "string" ? resolve(ctx.cwd, payload.args.path) : "";
  const env = { ...process.env, AGENT_TUTOR_EVENT: event, AGENT_TUTOR_TOOL: payload.tool ?? "", AGENT_TUTOR_FILE: file, AGENT_TUTOR_CWD: ctx.cwd };
  const input = JSON.stringify({ event, cwd: ctx.cwd, ...payload });

  for (const hook of hooks) {
    const short = hook.command.length > 50 ? hook.command.slice(0, 50) + "…" : hook.command;
    const r = await exec(hook.command, input, env, ctx.cwd, ctx.signal);
    if (r.code === BLOCK_EXIT_CODE) {
      outcome.blocked = r.stderr || r.stdout || `被 hook 拦下了（${short}）`;
      activity.warn(`  ⎿ [hook]${event}${payload.tool ? ` 拦下了 ${payload.tool}` : " 拦下了这次操作"}：${outcome.blocked.split("\n")[0]}`);
      return outcome; // 已经拦下了，后面的 hooks 不用再跑
    }
    // hook 的输出平时折叠，展开才看得到；出错了要让学生看到
    const shown = r.code === 0 ? r.stdout : r.stderr || r.stdout;
    if (r.code === 0) activity.note("hook", `${event} · ${short}`, 2, shown.split("\n").slice(0, 5).join("\n") || undefined);
    else activity.warn(`  ⎿ [hook]${event} · ${short} 出错了（退出码 ${r.code}）${shown ? "：" + shown.split("\n")[0] : ""}`);
    if (r.code === 0 && r.stdout) outcome.output.push(r.stdout);
  }
  return outcome;
}
