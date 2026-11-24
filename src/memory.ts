// 长期记忆（第 7 课）：学习进度 + 错题本 + 导师对学生的记忆 + 学生亲手写的说明文件 TUTOR.md
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

// 错题本里的一道题。用「三个盒子」安排复习（Leitner 盒子）：
// 答错放进第 1 盒，复习时答对升一盒；第 1/2/3 盒分别隔 1/3/5 天复习，第 3 盒再答对就算掌握，移出错题本
export interface ReviewItem {
  id: string;
  lesson: string; // 课程文件名
  topic: string; // 知识点
  question: string; // 当时答错的题目
  mistake: string; // 错在哪里
  box: 1 | 2 | 3;
  due: string; // 下次复习的日期
  wrong: number; // 一共答错过几次
}

export type Track = "基础" | "进阶";

export interface Progress {
  level: string;
  track?: Track; // 档位：基础档只学讲义的「基础」部分，进阶档两部分都学
  completed: string[];
  memories: Memory[];
  nextId: number;
  reviews: ReviewItem[];
  nextReviewId: number;
  answers: Record<string, { right: number; wrong: number }>; // 每节课答对、答错几次（用来判断要不要换档）
}

const BOX_DAYS = { 1: 1, 2: 3, 3: 5 } as const;

// 课程从 11 节扩成 14 节必修 + 2 节选修后，有几节课改了文件名。旧进度里的课程名自动换成新的
const RENAMED_LESSONS: Record<string, string> = {
  "04-FunctionCalling.md": "04-工具调用.md",
  "06-记忆.md": "07-记忆与上下文工程.md",
  "07-RAG知识库.md": "08-RAG知识库.md",
  "08-让Agent上网.md": "09-让Agent上网.md",
  "09-MCP给Agent装标准插头.md": "10-MCP与A2A.md",
  "10-多Agent与框架.md": "11-多Agent与框架.md",
  "11-评估与上线.md": "13-评估与上线.md",
};

function migrateLessonNames(p: Progress) {
  const rename = (name: string) => RENAMED_LESSONS[name] ?? name;
  const changed =
    p.completed.some((name) => name in RENAMED_LESSONS) ||
    p.reviews.some((r) => r.lesson in RENAMED_LESSONS) ||
    Object.keys(p.answers).some((name) => name in RENAMED_LESSONS);
  if (!changed) return false;
  p.completed = [...new Set(p.completed.map(rename))];
  for (const r of p.reviews) r.lesson = rename(r.lesson);
  p.answers = Object.fromEntries(Object.entries(p.answers).map(([name, stat]) => [rename(name), stat]));
  return true;
}

// 用本地日期（不用 toISOString，那是 UTC，北京时间早上 8 点前会算成前一天）
function dateString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const today = () => dateString(new Date());

function daysLater(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateString(d);
}

function emptyProgress(): Progress {
  return { level: "未评估", completed: [], memories: [], nextId: 1, reviews: [], nextReviewId: 1, answers: {} };
}

export interface FakeProgress {
  level?: string;
  track?: Track;
  completed?: string[];
  memories?: string[];
  reviews?: { lesson: string; topic: string; question: string; mistake: string; box?: 1 | 2 | 3; due?: string }[];
}

// 自动化评估时用：进度只存在内存里，每道测试题用自己的假进度，不读写学生真正的 progress.json
let inMemory: Progress | null = null;

export function useInMemoryProgress(p: FakeProgress = {}) {
  const memories = (p.memories ?? []).map((content, i) => ({ id: `m${i + 1}`, content, updated: today() }));
  const reviews = (p.reviews ?? []).map((r, i) => ({ id: `r${i + 1}`, box: 1 as const, due: today(), wrong: 1, ...r }));
  inMemory = {
    ...emptyProgress(),
    level: p.level ?? "未评估",
    track: p.track,
    completed: p.completed ?? [],
    memories,
    nextId: memories.length + 1,
    reviews,
    nextReviewId: reviews.length + 1,
  };
}

export function getProgress(): Progress {
  if (inMemory) return structuredClone(inMemory);
  if (!existsSync(PROGRESS_FILE)) return emptyProgress();
  const p = JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
  p.memories ??= [];
  p.nextId ??= p.memories.length + 1;
  p.reviews ??= [];
  p.nextReviewId ??= p.reviews.length + 1;
  p.answers ??= {};
  // 旧版本只有"备注" notes（只能往后加），自动转成可以修改、删除的记忆条目
  let changed = false;
  if (Array.isArray(p.notes)) {
    for (const note of p.notes) p.memories.push({ id: `m${p.nextId++}`, content: note, updated: today() });
    delete p.notes;
    changed = true;
  }
  if (migrateLessonNames(p)) changed = true;
  if (changed) writeProgress(p);
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

export function dueReviews(p = getProgress()) {
  return p.reviews.filter((r) => r.due <= today()).sort((a, b) => a.due.localeCompare(b.due));
}

// 给模型看的版本：记忆只要 id 和内容；错题本只给今天该复习的
export function progressForModel() {
  const p = getProgress();
  const due = dueReviews(p);
  return {
    level: p.level,
    track: p.track ?? "未选择",
    completed: p.completed,
    memories: p.memories.map(({ id, content }) => ({ id, content })),
    due_reviews: due.slice(0, 3).map(({ id, lesson, topic, question, mistake, box }) => ({ id, lesson, topic, question, mistake, box })),
    ...(due.length > 3 && { more_due: due.length - 3 }),
    review_total: p.reviews.length,
  };
}

export function saveProgress(args: { level?: string; track?: string; completed_topic?: string }) {
  const p = getProgress();
  if (args.level) p.level = args.level;
  if (args.track) {
    if (args.track !== "基础" && args.track !== "进阶") return { error: "track 只能是「基础」或「进阶」" };
    p.track = args.track;
  }
  if (args.completed_topic && !p.completed.includes(args.completed_topic)) p.completed.push(args.completed_topic);
  writeProgress(p);
  return { ok: true };
}

// 记录一次答题：新题答错就放进错题本；复习错题本里的题（带 review_id）时，答对升一盒，答错退回第 1 盒
export function recordAnswer(args: { lesson: string; topic: string; question: string; correct: boolean; mistake?: string; review_id?: string }) {
  const p = getProgress();
  const stat = (p.answers[args.lesson] ??= { right: 0, wrong: 0 });
  if (args.correct) stat.right++;
  else stat.wrong++;
  const lessonStat = { lesson: args.lesson, ...stat };

  if (args.review_id) {
    const item = p.reviews.find((r) => r.id === args.review_id);
    if (!item) return { error: `错题本里没有 id 为 ${args.review_id} 的题，先用 get_progress 看看` };
    if (args.correct && item.box === 3) {
      p.reviews = p.reviews.filter((r) => r !== item);
      writeProgress(p);
      return { ok: true, result: "这个知识点已经掌握，移出错题本", lesson_stat: lessonStat };
    }
    item.box = args.correct ? ((item.box + 1) as 2 | 3) : 1;
    item.due = daysLater(BOX_DAYS[item.box]);
    if (!args.correct) {
      item.wrong++;
      if (args.mistake) item.mistake = args.mistake;
    }
    writeProgress(p);
    return { ok: true, result: `放进第 ${item.box} 盒，${item.due} 再复习`, lesson_stat: lessonStat };
  }

  if (!args.correct) {
    // 同一节课的同一个知识点已经在错题本里，就不重复记，退回第 1 盒
    const same = p.reviews.find((r) => r.lesson === args.lesson && r.topic === args.topic);
    const item: ReviewItem = same ?? { id: `r${p.nextReviewId++}`, lesson: args.lesson, topic: args.topic, question: "", mistake: "", box: 1, due: "", wrong: 0 };
    Object.assign(item, { question: args.question, mistake: args.mistake ?? "", box: 1, due: daysLater(BOX_DAYS[1]), wrong: item.wrong + 1 });
    if (!same) p.reviews.push(item);
    writeProgress(p);
    return { ok: true, result: `记进错题本（${item.id}），${item.due} 复习`, lesson_stat: lessonStat };
  }
  writeProgress(p);
  return { ok: true, lesson_stat: lessonStat };
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
