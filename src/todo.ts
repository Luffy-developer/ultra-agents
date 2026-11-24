// 待办清单（规划能力）：遇到步骤多的任务，先把计划列出来，再一步步做、一项项打勾——和 Claude Code 的 Todo 列表一样
// 好处：模型不容易做着做着忘了还剩哪几步；学生也能随时看到进度
// 清单属于当前这段对话：/clear 时清空，恢复旧对话时从对话记录里还原
import type { Message } from "./agent.js";
import type { Tool } from "./tools.js";
import { c, newline, write } from "./ui.js";

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

const STATUSES = ["pending", "in_progress", "completed"];
let todos: Todo[] = [];

export function getTodos() {
  return todos;
}

export function clearTodos() {
  todos = [];
}

export function printTodos(list = todos) {
  newline();
  if (list.length === 0) return write(c.dim("  📋 现在没有待办清单\n"));
  const done = list.filter((t) => t.status === "completed").length;
  write(c.dim(`  📋 待办清单（${done}/${list.length}）\n`));
  for (const t of list) {
    if (t.status === "completed") write(c.dim(`     ${c.green("☑")} ${c.strike(t.content)}\n`));
    else if (t.status === "in_progress") write(`     ${c.cyan("◐")} ${c.bold(t.content)}\n`);
    else write(`     ${c.dim("☐")} ${t.content}\n`);
  }
}

function writeTodos(args: { todos?: unknown }) {
  if (!Array.isArray(args.todos)) return { error: "todos 必须是一个数组" };
  const list: Todo[] = [];
  for (const item of args.todos) {
    const content = String(item?.content ?? "").trim();
    if (!content) return { error: "每一项都要有 content" };
    if (!STATUSES.includes(item?.status)) return { error: `status 只能是 ${STATUSES.join(" / ")}：${content}` };
    list.push({ content, status: item.status });
  }
  todos = list;
  printTodos();
  const doing = list.filter((t) => t.status === "in_progress").length;
  const left = list.filter((t) => t.status !== "completed").length;
  return {
    ok: true,
    left,
    tip: doing > 1 ? "同一时间最好只有一项是 in_progress，做完一项再开始下一项" : left === 0 && list.length ? "全部完成了，跟学生总结一下做了什么" : undefined,
  };
}

export const TODO_TOOL: Tool = {
  name: "todo_write",
  description:
    "维护当前任务的待办清单，会显示给学生看。要做 3 步以上的任务时，先列出所有步骤再动手；" +
    "开始做某一步时把它标成 in_progress，做完马上标成 completed，中途发现新步骤就加进去。" +
    "每次都要传完整的清单（会整个替换旧清单）。简单的一问一答不用列清单",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "这一步要做什么，简短的一句话" },
            status: { type: "string", enum: STATUSES, description: "pending 还没开始 / in_progress 正在做 / completed 已完成" },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },
  run: writeTodos,
};

// 恢复旧对话时：找到对话记录里最后一次 todo_write，把清单还原出来
export function restoreTodos(messages: Message[]) {
  todos = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !m.tool_calls) continue;
    for (const call of m.tool_calls as any[]) {
      if (call.function?.name !== "todo_write") continue;
      try {
        const list = JSON.parse(call.function.arguments).todos;
        if (Array.isArray(list)) todos = list.filter((t) => t?.content && STATUSES.includes(t.status));
      } catch {}
    }
  }
}
