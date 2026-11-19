// 子 Agent：出题官（第 10 课：把另一个 Agent 包装成工具）
import type { ToolContext } from "./tools.js";
import { getProgress, readLesson } from "./tools.js";

const QUIZ_PROMPT = `你是一位「出题官」，只负责根据讲义给小白出题，不负责讲课。
要求：
1. 只考讲义里讲过的内容，题目要短、贴近生活，不要考死记硬背。
2. 如果给了学生的薄弱点，优先考薄弱点。
3. 只输出 JSON，不要输出任何别的文字，格式：
{"question": "题目", "answer": "参考答案", "hint": "学生答不出时给的提示"}`;

export async function generateQuiz(filename: string, ctx: ToolContext) {
  const lesson = readLesson(filename);
  if ("error" in lesson) return lesson;
  const progress = getProgress();
  // 出题官有自己独立的 messages 和人设，看不到导师和学生的聊天记录；
  // 它没有工具，所以调用一次就够了，不需要循环
  const resp = await ctx.client.chat.completions.create(
    {
      model: ctx.model,
      messages: [
        { role: "system", content: QUIZ_PROMPT },
        {
          role: "user",
          content:
            `学生水平：${progress.level}\n` +
            `学生薄弱点：${progress.notes.join("；") || "暂无"}\n` +
            `讲义：\n${lesson.content}`,
        },
      ],
    },
    { signal: ctx.signal },
  );
  // 有些模型会把 JSON 包在 ```json ... ``` 里，去掉再解析
  const text = (resp.choices[0]?.message.content ?? "")
    .trim()
    .replace(/^```(json)?/, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    return { question: text }; // 解析失败就把原文交给导师自己处理
  }
}
