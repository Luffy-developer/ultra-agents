// 长期记忆（第 6 课）：学习进度 + 导师对学生的记忆 + 学生亲手写的说明文件 TUTOR.md
// 都存在 ~/.agent-tutor/ 里，关掉程序也不会丢
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";

const PROGRESS_FILE = join(DATA_DIR, "progress.json");
const MAX_MEMORIES = 20; // 记忆太多会变乱，超过就提醒导师合并

export interface Memory {
  id: string;
  content: string;
  updated: string; // 最后修改日期
}

export interface Progress {
  level: string;
  completed: string[];
  memories: Memory[];
  nextId: number;
}

const today = () => new Date().toISOString().slice(0, 10);

// 自动化评估时用：进度只存在内存里，每道测试题用自己的假进度，不读写学生真正的 progress.json
let inMemory: Progress | null = null;

export function useInMemoryProgress(p: { level?: string; completed?: string[]; memories?: string[] } = {}) {
  const memories = (p.memories ?? []).map((content, i) => ({ id: `m${i + 1}`, content, updated: today() }));
  inMemory = { level: p.level ?? "未评估", completed: p.completed ?? [], memories, nextId: memories.length + 1 };
}

export function getProgress(): Progress {
  if (inMemory) return structuredClone(inMemory);
  if (!existsSync(PROGRESS_FILE)) return { level: "未评估", completed: [], memories: [], nextId: 1 };
  const p = JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
  p.memories ??= [];
  p.nextId ??= p.memories.length + 1;
  // 旧版本只有"备注" notes（只能往后加），自动转成可以修改、删除的记忆条目
  if (Array.isArray(p.notes)) {
    for (const note of p.notes) p.memories.push({ id: `m${p.nextId++}`, content: note, updated: today() });
    delete p.notes;
    writeProgress(p);
  }
  return p;
}

function writeProgress(p: Progress) {
  if (inMemory) {
    inMemory = structuredClone(p);
    return;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

// 给模型看的版本：只要 id 和内容
export function progressForModel() {
  const p = getProgress();
  return {
    level: p.level,
    completed: p.completed,
    memories: p.memories.map(({ id, content }) => ({ id, content })),
  };
}

export function saveProgress(args: { level?: string; completed_topic?: string }) {
  const p = getProgress();
  if (args.level) p.level = args.level;
  if (args.completed_topic && !p.completed.includes(args.completed_topic)) p.completed.push(args.completed_topic);
  writeProgress(p);
  return { ok: true };
}

function memoryTip(p: Progress) {
  return p.memories.length > MAX_MEMORIES
    ? `记忆已有 ${p.memories.length} 条，偏多了：请把重复或相近的合并（update_memory 改写一条，forget 删掉其余的）`
    : undefined;
}

export function remember(args: { content: string }) {
  const p = getProgress();
  const memory = { id: `m${p.nextId++}`, content: args.content.trim(), updated: today() };
  p.memories.push(memory);
  writeProgress(p);
  return { ok: true, id: memory.id, tip: memoryTip(p) };
}

export function updateMemory(args: { id: string; content: string }) {
  const p = getProgress();
  const memory = p.memories.find((m) => m.id === args.id);
  if (!memory) return { error: `没有 id 为 ${args.id} 的记忆，先用 get_progress 看看现有的记忆` };
  memory.content = args.content.trim();
  memory.updated = today();
  writeProgress(p);
  return { ok: true, tip: memoryTip(p) };
}

export function forget(args: { id: string }) {
  const p = getProgress();
  const before = p.memories.length;
  p.memories = p.memories.filter((m) => m.id !== args.id);
  if (p.memories.length === before) return { error: `没有 id 为 ${args.id} 的记忆` };
  writeProgress(p);
  return { ok: true };
}

// ---------- 说明文件 TUTOR.md（学生亲手写的规矩，导师只读不改） ----------
// 和 Claude Code 读 CLAUDE.md 一样：全局的写在 ~/.agent-tutor/TUTOR.md，只对某个练习目录生效的写在那个目录里
const MAX_INSTRUCTIONS = 10_000;

export function instructionFiles(cwd: string) {
  const paths = [join(DATA_DIR, "TUTOR.md"), join(cwd, "TUTOR.md")];
  return [...new Set(paths)].filter((path) => existsSync(path));
}

export function loadInstructions(cwd: string) {
  const text = instructionFiles(cwd)
    .map((path) => `【${path}】\n${readFileSync(path, "utf-8").trim()}`)
    .join("\n\n");
  return text.length > MAX_INSTRUCTIONS ? text.slice(0, MAX_INSTRUCTIONS) + "\n…（太长，后面的内容已省略）" : text;
}
