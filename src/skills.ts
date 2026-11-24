// Skills（技能）：把一套做事方法写成说明书，需要时才加载（和 Claude Code 的 Skills 一样）
// - 每个技能是一个文件夹，里面的 SKILL.md 开头写名字和一句话说明，正文写具体怎么做；文件夹里还可以放模板、例子等附件
// - 导师平时只看得到每个技能的名字和说明（在 use_skill 工具的说明里），觉得用得上时才调用 use_skill 读取全文
//   —— 这叫"渐进式披露"：技能装得再多，也不会撑大每一轮的上下文
// - 学生也可以直接输入 /技能名 来使用某个技能
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./config.js";
import { NAME_PATTERN, parseFrontmatter } from "./frontmatter.js";
import type { Tool } from "./tools.js";

export interface Skill {
  name: string;
  description: string; // 什么时候该用这个技能
  content: string; // SKILL.md 的正文
  dir: string;
  source: string; // "内置"或文件夹路径
}

const BUILTIN_DIR = fileURLToPath(new URL("../skills/", import.meta.url));
const MAX_FILE = 20_000;

// 技能放在这三个地方（后面的优先，同名的覆盖前面的）：随工具自带的、对所有目录生效的、只对当前练习目录生效的
export function skillDirs(cwd: string) {
  return [join(DATA_DIR, "skills"), join(cwd, ".agent-tutor", "skills")];
}

function parseSkill(dir: string, source: string): Skill {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) throw new Error("文件夹里没有 SKILL.md");
  const parsed = parseFrontmatter(readFileSync(file, "utf-8"));
  if (!parsed) throw new Error("SKILL.md 开头缺少 --- 包起来的 name、description");
  const name = parsed.meta.name || dir.split(sep).pop()!;
  if (!NAME_PATTERN.test(name)) throw new Error(`名字只能用字母、数字、中文、- 和 _：${name}`);
  if (!parsed.meta.description) throw new Error("缺少 description（导师靠它判断什么时候用这个技能）");
  if (!parsed.body) throw new Error("正文是空的，请写上具体怎么做");
  return { name, description: parsed.meta.description, content: parsed.body, dir, source };
}

// 每次用到都重新读：新加的技能不用重启就能用
export function loadSkills(cwd: string) {
  const byName = new Map<string, Skill>();
  const errors: { path: string; error: string }[] = [];
  const roots: [string, boolean][] = [[BUILTIN_DIR, true], ...skillDirs(cwd).map((d): [string, boolean] => [d, false])];
  for (const [root, builtin] of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort()) {
      const dir = join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      try {
        const skill = parseSkill(dir, builtin ? "内置" : dir);
        byName.set(skill.name, skill);
      } catch (e) {
        errors.push({ path: dir, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return { skills: [...byName.values()], errors };
}

// 技能文件夹里除了 SKILL.md 以外的附件
function attachments(dir: string, sub = dir): string[] {
  return readdirSync(sub).flatMap((name) => {
    const full = join(sub, name);
    if (statSync(full).isDirectory()) return attachments(dir, full);
    const rel = relative(dir, full).split(sep).join("/");
    return rel === "SKILL.md" ? [] : [rel];
  });
}

function useSkill(cwd: string, args: { name: string; file?: string }) {
  const { skills } = loadSkills(cwd);
  const skill = skills.find((s) => s.name === args.name);
  if (!skill) return { error: `没有这个技能：${args.name}，可用的有：${skills.map((s) => s.name).join("、") || "（还没有技能）"}` };
  if (args.file) {
    // 只允许读这个技能自己文件夹里的附件
    const full = resolve(skill.dir, args.file);
    if (!full.startsWith(skill.dir + sep) || !existsSync(full)) return { error: `技能 ${skill.name} 里没有这个文件：${args.file}` };
    const text = readFileSync(full, "utf-8");
    return { content: text.length > MAX_FILE ? text.slice(0, MAX_FILE) + "\n…（内容过长，已截断）" : text };
  }
  const files = attachments(skill.dir);
  return { name: skill.name, instructions: skill.content, ...(files.length > 0 && { files, tip: "需要时用 use_skill 的 file 参数读取这些附件" }) };
}

// 学生输入 /技能名 时，把技能说明直接放进这条消息里，导师就会照着做
export function skillMessage(skill: Skill, request: string) {
  return `（学生输入了 /${skill.name}，要求使用技能「${skill.name}」。技能说明如下，请照着做）\n\n${skill.content}\n\n学生的要求：${request || "（没有额外要求）"}`;
}

export function skillTool(cwd: string): Tool {
  return {
    name: "use_skill",
    label: "使用技能",
    // 说明每次现算：新加的技能导师马上就能看到
    get description() {
      const list = loadSkills(cwd).skills.map((s) => `- ${s.name}：${s.description}`).join("\n");
      return `读取某个技能的完整说明，然后照着做。技能是学生或导师工具自带的"做事方法说明书"。
遇到下面列出的情况时，先调用这个工具读取说明，再动手。
可用的技能：
${list || "（还没有技能）"}`;
    },
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "技能名字" },
        file: { type: "string", description: "要读的附件（技能说明里提到的模板、例子等），不填就读技能说明本身" },
      },
      required: ["name"],
    },
    run: (args, ctx) => useSkill(ctx.cwd, args),
  };
}
