// 斜杠命令清单：名字、说明、可选参数都在这里定义
// /help 的帮助文字、输入 / 时弹出的补全菜单，都从这份清单生成
import type { Suggestion } from "./input.js";
import { mcpStatuses } from "./mcp.js";
import { listSessions } from "./session.js";
import { loadAgents } from "./subagents.js";

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
  {
    name: "mcp",
    description: "查看已连接的 MCP 服务器和工具",
    argHint: "[服务器名]",
    args: () =>
      mcpStatuses().map((s) => ({
        value: `/mcp ${s.name}`,
        label: s.name,
        description: s.ok ? `${s.tools.length} 个工具：${s.tools.map((t) => t.name).join("、")}` : `连接失败：${s.error}`,
      })),
  },
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
    "正在回答时按 Ctrl+C 可以打断。",
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
    return COMMANDS.filter((cmd) => cmd.name.startsWith(typed)).map((cmd) => ({
      value: `/${cmd.name}`,
      label: `/${cmd.name}`,
      description: cmd.description,
      hasArgs: Boolean(cmd.args),
    }));
  }
  const cmd = COMMANDS.find((c) => c.name === line.slice(1, space).toLowerCase());
  if (!cmd?.args) return [];
  const typedArg = line.slice(space + 1).trimStart().toLowerCase();
  return cmd.args().filter((s) => s.value.slice(cmd.name.length + 2).toLowerCase().startsWith(typedArg));
}
