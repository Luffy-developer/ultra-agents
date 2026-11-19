// 会话保存与恢复（第 6 课：短期记忆也能存下来）
// 每说完一轮就把整段对话存成一个文件，下次用 agent-tutor --continue 或 /resume 接着聊
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "./agent.js";
import { DATA_DIR } from "./config.js";

const SESSIONS_DIR = join(DATA_DIR, "sessions");
const KEEP_SESSIONS = 30; // 只保留最近 30 个会话，太旧的自动删掉

export interface Session {
  id: string;
  cwd: string; // 在哪个练习目录里聊的
  created: string;
  updated: string;
  title: string; // 学生说的第一句话，用来在列表里认出是哪次对话
  messages: Message[]; // 不含 system 消息：恢复时会按最新的规则和 TUTOR.md 重新生成
}

export function newSessionId() {
  // 形如 20261119-153012-a3f9：前面是时间，后面加 4 位随机字符，同一秒新建两个会话也不会互相覆盖
  const time = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${time}-${Math.random().toString(36).slice(2, 6)}`;
}

function sessionFile(id: string) {
  return join(SESSIONS_DIR, `${id}.json`);
}

function firstUserText(messages: Message[]) {
  const first = messages.find((m) => m.role === "user" && typeof m.content === "string" && !m.content.startsWith("（系统提示"));
  return typeof first?.content === "string" ? first.content.replace(/\s+/g, " ").slice(0, 40) : "（新对话）";
}

export function saveSession(id: string, cwd: string, messages: Message[]) {
  const history = messages.slice(1); // 去掉 system 消息
  if (!history.some((m) => m.role === "user")) return; // 还没说话，不用存
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const old = loadSession(id);
  const now = new Date().toISOString();
  const session: Session = {
    id,
    cwd,
    created: old?.created ?? now,
    updated: now,
    title: old?.title && old.title !== "（新对话）" ? old.title : firstUserText(history),
    messages: history,
  };
  // 先写临时文件再改名：万一写到一半程序被关掉，旧存档也不会坏
  const tmp = sessionFile(id) + ".tmp";
  writeFileSync(tmp, JSON.stringify(session));
  renameSync(tmp, sessionFile(id));
}

export function loadSession(id: string): Session | undefined {
  const file = sessionFile(id);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return undefined; // 存档坏了就当没有
  }
}

export type SessionInfo = Omit<Session, "messages"> & { turns: number };

// 最近的会话在前
export function listSessions(): SessionInfo[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => loadSession(f.replace(/\.json$/, "")))
    .filter((s): s is Session => Boolean(s))
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .map(({ messages, ...info }) => ({ ...info, turns: messages.filter((m) => m.role === "user").length }));
}

export function latestSession(cwd: string) {
  return listSessions().find((s) => s.cwd === cwd);
}

export function cleanupSessions() {
  for (const s of listSessions().slice(KEEP_SESSIONS)) unlinkSync(sessionFile(s.id));
}
