# 第 10 课：多 Agent 与框架

## 核心概念
- **多 Agent**：一个 Agent 什么都干容易乱，可以拆成多个分工明确的 Agent 协作。
  例如：「出题 Agent」负责出题，「批改 Agent」负责判分，「导师 Agent」负责统筹。
- 常见协作方式：
  - **流水线**：A 做完交给 B，B 做完交给 C
  - **主管模式**：一个主管 Agent 把任务分派给几个专家 Agent，再汇总结果
- 实现上很简单：**把另一个 Agent 包装成一个工具**，让主 Agent 去调用它。

## 比喻
一个人开餐馆：既当厨师又当服务员又收银，忙不过来还容易出错；
多 Agent = 招几个人分工，店长负责协调。

## 看看本项目
导师的小测验就是另一个 Agent 出的！打开 agent-tutor 源码里的 `src/quiz.ts`：
- 出题官有**自己的人设**（`QUIZ_PROMPT`）和**自己的 messages**，看不到你和导师的聊天记录
- 它被包装成 `generate_quiz` 工具（注册在 `src/tools.ts`），导师需要出题时就调用它
- 终端里出现「🔧 generate_quiz」，就是导师把活儿交给了出题官

## 框架
- 常见框架：LangChain / LangGraph、LlamaIndex、AutoGen、CrewAI、OpenAI Agents SDK 等。
- 框架帮你封装好了 Agent 循环、记忆、RAG 等"轮子"，写起来更快。
- 建议：**先像本项目一样手写一遍原理，再用框架**。这样框架出问题时你知道去哪里查。

## 小测验
问：怎样让一个 Agent "调用"另一个 Agent？
答：把另一个 Agent 包装成一个工具函数（输入任务、返回结果），注册到主 Agent 的 tools 里。
