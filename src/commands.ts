// 斜杠命令清单：名字、说明、可选参数都在这里定义
// /help 的帮助文字、输入 / 时弹出的补全菜单，都从这份清单生成
import type { Suggestion } from "./input.js";
import { mcpStatuses } from "./mcp.js";
import { listSessions } from "./session.js";
import { loadSkills } from "./skills.js";
import { loadAgents } from "./subagents.js";

// /model 补全菜单里的模型：启动时从模型服务查一次，再加上用过的、配置里填了价格的
let modelChoices: string[] = [];
let currentModel = "";

export function setModelChoices(models: string[], current: string) {
  currentModel = current;
  modelChoices = [...new Set([current, ...models])].filter(Boolean);
}

export interface Command {
  name: string;
  description: string;
  argHint?: string; // 在帮助里显示，如 "[序号]"
  args?: () => Suggestion[]; // 输入"命令 + 空格"后，补全菜单里列出的参数
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const RESUME_LIMIT = 10;

export function recentSessions() {
  return listSessions().slice(0, RESUME_LIMIT);
}

export const COMMANDS: Command[] = [
  { name: "help", description: "显示所有命令" },
  { name: "progress", description: "查看学习进度" },
  { name: "memory", description: "查看导师记住了你什么，以及你写的 TUTOR.md" },
  {
    name: "resume",
    description: "从历史对话里挑一个接着聊",
    argHint: "[序号]",
    args: () =>
      recentSessions().map((s, i) => ({
        value: `/resume ${i + 1}`,
        label: String(i + 1),
        description: `${formatTime(s.updated)}  ${s.title}  · ${s.turns} 轮`,
      })),
  },
  { name: "clear", description: "开始新对话（学习进度和记忆不会丢，之前的对话会保存）" },
  { name: "compact", description: "把当前对话压缩成摘要（对话很长、回答变慢时用）" },
  { name: "todos", description: "查看导师正在做的待办清单" },
  { name: "cost", description: "查看本次启动以来用了多少 token、花了多少钱" },
  { name: "details", description: "展开上一轮的完整过程：思考全文、每次工具调用和结果（也可以按 Ctrl+O）" },
  { name: "verbose", description: "切换显示方式：过程折叠成一行总结 / 每一步都完整显示" },
  {
    name: "model",
    description: "查看可用的模型，或切换到另一个模型（会保存为默认）",
    argHint: "[模型名]",
    args: () =>
      modelChoices.map((m) => ({ value: `/model ${m}`, label: m, description: m === currentModel ? "当前使用中" : "" })),
  },
  {
    name: "mcp",
    description: "查看、添加、删除 MCP 服务器",
    argHint: "[服务器名 | add | remove]",
    args: () => [
      { value: "/mcp add ", label: "add", description: "添加服务器：/mcp add 名字 命令或网址（马上连接，不用重启）" },
      ...mcpStatuses().map((s) => ({
        value: `/mcp ${s.name}`,
        label: s.name,
        description: s.ok ? `${s.tools.length} 个工具：${s.tools.map((t) => t.name).join("、")}` : `连接失败：${s.error}`,
      })),
      ...mcpStatuses().map((s) => ({ value: `/mcp remove ${s.name}`, label: `remove ${s.name}`, description: `删除服务器 ${s.name}` })),
    ],
  },
  {
    name: "skills",
    description: "查看可用的技能，以及怎么自己写技能",
    argHint: "[名字]",
    args: () =>
      loadSkills(process.cwd()).skills.map((sk) => ({ value: `/skills ${sk.name}`, label: sk.name, description: sk.description })),
  },
  { name: "hooks", description: "查看设置好的 hooks，以及怎么设置" },
  {
    name: "agents",
    description: "查看导师可以派出的子 Agent，以及怎么自定义",
    argHint: "[名字]",
    args: () =>
      loadAgents(process.cwd()).agents.map((a) => ({
        value: `/agents ${a.name}`,
        label: a.name,
        description: a.description,
      })),
  },
  { name: "setup", description: "修改模型和搜索服务配置" },
  { name: "exit", description: "退出（也可以按 Ctrl+D）" },
];

export function helpText() {
  const width = Math.max(...COMMANDS.map((cmd) => (cmd.name + (cmd.argHint ? " " + cmd.argHint : "")).length)) + 2;
  const lines = COMMANDS.map((cmd) => `  /${(cmd.name + (cmd.argHint ? " " + cmd.argHint : "")).padEnd(width)}${cmd.description}`);
  return [
    "命令（输入 / 会弹出命令菜单，↑↓ 选择、Tab 补全）：",
    ...lines,
    "  /技能名 [要求]       直接使用某个技能（输入 /skills 查看有哪些）",
    "正在回答时按 Ctrl+C 可以打断；在输入框里按 Ctrl+O 展开上一轮的完整过程。",
    "启动参数：",
    "  agent-tutor --continue        接着这个目录里上次的对话",
    '  agent-tutor -p "问题"          不进入对话，回答完就退出（适合写脚本）',
    "  agent-tutor --eval [文件]      运行自动化评估（--only 名字 只跑部分题，-v 显示导师的回答）",
  ].join("\n");
}

// 补全菜单的候选项：输入 /mc 列出名字以 mc 开头的命令；输入 "/resume " 列出可选的参数
export function suggestCommands(line: string): Suggestion[] {
  if (!line.startsWith("/")) return [];
  const space = line.indexOf(" ");
  if (space === -1) {
    const typed = line.slice(1).toLowerCase();
    const commands = COMMANDS.filter((cmd) => cmd.name.startsWith(typed)).map((cmd) => ({
      value: `/${cmd.name}`,
      label: `/${cmd.name}`,
      description: cmd.description,
      hasArgs: Boolean(cmd.args),
    }));
    // 技能也能用 /技能名 直接使用（和内置命令重名的，内置命令优先）
    const skills = loadSkills(process.cwd())
      .skills.filter((sk) => sk.name.toLowerCase().startsWith(typed) && !COMMANDS.some((cmd) => cmd.name === sk.name))
      .map((sk) => ({ value: `/${sk.name}`, label: `/${sk.name}`, description: `[技能] ${sk.description}`, hasArgs: true }));
    return [...commands, ...skills];
  }
  const cmd = COMMANDS.find((c) => c.name === line.slice(1, space).toLowerCase());
  if (!cmd?.args) return [];
  const typedArg = line.slice(space + 1).trimStart().toLowerCase();
  return cmd.args().filter((s) => s.value.slice(cmd.name.length + 2).toLowerCase().startsWith(typedArg));
}

// 把一行命令拆成参数，支持用引号把带空格的内容括起来：/mcp add 名字 -H "Authorization: Bearer xx" https://...
export function splitArgs(line: string) {
  const args: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) args.push(m[1] ?? m[2] ?? m[3]);
  return args;
}
