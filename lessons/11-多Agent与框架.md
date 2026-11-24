# 第 11 课：多 Agent 与框架

> **学完你能**：判断一个任务该不该拆成多个 Agent；说清「主管模式」和「转交模式」的区别；看懂本项目的子 Agent 是怎么派活的；把第 5 课手写的循环和 LangGraph 的写法一一对上。

## 基础

### 1. 先把一个 Agent 用到极限，再考虑拆
- 一个 Agent 什么都干，事情多了容易乱；拆成几个分工明确的 Agent，每个只管一摊事。
- 比喻：一个人开餐馆，既当厨师又当服务员又收银，忙不过来还容易出错；多 Agent = 招几个人分工，店长负责协调。
- 但 OpenAI 的建议是：**先用一个 Agent 做到极限，再拆**。拆了以后要协调、要传话，出错的地方也变多了。
- 什么时候该拆？两个信号（来自 OpenAI 的 Agent 搭建指南）：
  - **Prompt 里的「如果……就……」越写越多**，一个人设已经装不下这么多规则
  - **工具太多、功能重叠**，模型老是选错工具（第 4 课「工具调用」讲过：关键不在数量，在重叠）

### 2. 两种分工方式
- **主管模式（Manager）**：一个主管 Agent 面对用户，把子任务派给几个专家 Agent，专家做完把结果交回给主管，主管再汇总回答。
  专家 Agent 对主管来说**就是一个工具**：输入任务，返回结果。本项目就是这种模式。
- **转交模式（Handoff）**：没有主管，一个 Agent 把对话**整个交给**另一个 Agent，自己退出。
  例：客服系统里，「分诊 Agent」先听用户说什么，发现是查订单，就把对话转交给「订单 Agent」，之后由订单 Agent 直接和用户聊。
- 区别一句话：主管模式是「派活，活干完还回来」；转交模式是「转接电话，转过去就不回来了」。

### 3. 看看本项目：导师就是一个主管
导师有一个特别的工具 `task`，专门用来派**子 Agent** 干活（和 Claude Code 的做法一样）。打开 `src/subagents.ts`：
- 每个子 Agent 有**自己的人设**和**自己的 messages**，看不到你和导师的聊天记录，所以导师派活时要把任务写清楚
- 每个子 Agent **只能用分配给它的工具**：出题官只能读讲义和进度，调研员只能上网；谁都不能再派子 Agent（`NEVER` 里有 `task`，防止无限套娃）
- 子 Agent 自己跑一遍完整的 Agent 循环（就是第 5 课的 `runTurn`），做完**只把结论交回给导师**，中间搜到的十几个网页不会塞进导师的对话里——这是拆子 Agent 最大的好处：**隔离上下文**（第 7 课「记忆与上下文工程」会再讲）
- 导师在同一步里派出好几个子 Agent，它们会**同时开工**，比一个一个来快
- 终端里出现「⎿ [agent]… 派出子 Agent」，下面缩进一层的 ⎿ 行就是子 Agent 在用的工具

内置的子 Agent：出题官 `quiz-maker`、审题官 `quiz-reviewer`、调研员 `researcher`、通用助手 `general-purpose`。
输入 `/agents` 查看；你还可以在 `~/.agent-tutor/agents/` 里写一个 Markdown 文件，定义自己的子 Agent：

```markdown
---
name: code-reviewer
description: 代码检查员：检查学生写的代码有没有错误
tools: read_file, list_files
---
你是代码检查员。先用 list_files 找到文件，再用 read_file 读代码，逐个指出问题。
```

`description` 很重要：导师就是看它来决定什么时候派这个子 Agent 的（和工具说明书的作用一样）。

### 4. 反思：让另一个 Agent 帮你检查
人写完东西会检查一遍，Agent 也可以：**一个负责做，另一个负责挑毛病，不合格就退回去改**。这叫**反思**（Reflection），第 6 课「工作流与设计模式」里的「评估者-优化者」就是它。
- 本项目的出题官出完题，会自动交给审题官 `quiz-reviewer` 检查：讲义里讲过吗？答案对吗？提示有没有把答案说漏？
- 审题官第一行写「结论：通过」或「结论：不通过」，不通过就把意见交回给出题官修改，**最多改 2 次**（`MAX_REVISIONS = 2`，防止一直改不完）
- 你自定义的子 Agent 也能用：在文件开头加一行 `reviewer: 审核员的名字`
- 为什么要另一个 Agent 来审？自己检查自己，容易"看不出自己的错"；换一个只负责挑错的人设，更容易发现问题

### 5. 什么时候该派子 Agent
- 适合：任务独立、步骤多、过程不重要只要结果（查资料、跑通一段代码、检查一批文件）
- 不适合：简单的一两步小事（派活本身也要花时间和 token），或者需要和用户来回商量的事（子 Agent 没法问用户）

### 6. 框架是什么，要不要用
- 常见框架：LangGraph、LlamaIndex、CrewAI、AutoGen、OpenAI Agents SDK、Google ADK 等。它们把 Agent 循环、记忆、多 Agent 协作这些"轮子"封装好了。
- Anthropic 的建议：**先直接调用模型 API**，很多模式几行代码就能写出来；如果用框架，**一定要弄懂它底层在做什么**——框架多包了几层，出了问题更难查，也容易让人把本来简单的事做复杂。
- 本课程的做法就是这样：你在第 5 课已经手写过 Agent 循环，再看框架就知道它替你做了什么。

## 进阶

### 1. 多 Agent 很贵，要用在值得的地方
（来自 Anthropic《How we built our multi-agent research system》）
- Anthropic 的调研系统里，多 Agent 消耗的 token 约是普通聊天的 **15 倍**。所以只适合**价值高、能拆成很多条线同时查**的任务（比如大范围调研）
- 子任务之间要频繁共享信息、互相依赖的事（大多数编程任务就是这样），不适合拆成多 Agent
- 并行的好处很明显：主 Agent 同时派出几个子 Agent、子 Agent 同时调用多个工具，复杂调研的时间最多能缩短 90%
- 投入要和问题匹配：简单的事实查询一个 Agent 调几次工具就够了，复杂调研才需要派一批子 Agent

### 2. 给子 Agent 布置任务，要写清四件事
同样来自 Anthropic 的多 Agent 篇：任务写得含糊，子 Agent 会重复干活、漏掉要点，或者跑去查别的。每次派活写清：
- **目标**：要查/做什么，做到什么程度算完
- **输出格式**：交回什么样的结果（如"结论 + 要点 + 来源网址"）
- **可用的工具和资料来源**：该用哪些工具、优先看哪类来源
- **边界**：不要做什么、和别的子 Agent 怎么分工
本项目 `task` 工具的说明里写着"prompt 里要写清楚：要做什么、需要知道的背景、希望交回什么样的结果"，就是这个道理。

### 3. 小而专的 Agent
（来自 12-factor-agents 第 10 条「Small, Focused Agents」）
- 与其做一个什么都管、一跑几十步的大 Agent，不如做几个各管一件事的小 Agent，每个只跑 **3~10 步**，最多 20 步左右
- 步数一多，上下文越来越长，模型越来越容易迷失；小 Agent 的上下文短、好测试、出错也好定位

### 4. 框架实操：用 LangGraph 写第 5 课的循环
LangGraph 把 Agent 写成一张**图**：**节点**是一步操作（调模型、执行工具），**边**是下一步去哪，**状态**是在节点之间传递的数据（主要是 messages）。
下面是官方快速入门的结构（https://docs.langchain.com/oss/python/langgraph/quickstart ，安装：`pip install -U langgraph langchain langchain-anthropic`，需要自己的 API Key）：

```python
from typing import Literal
from typing_extensions import TypedDict, Annotated
import operator
from langchain.messages import AnyMessage, ToolMessage
from langgraph.graph import StateGraph, START, END

class MessagesState(TypedDict):          # 状态：在节点之间传递的数据
    messages: Annotated[list[AnyMessage], operator.add]   # operator.add = 新消息追加到列表后面

def llm_call(state):                      # 节点 1：问模型
    return {"messages": [model_with_tools.invoke(state["messages"])]}

def tool_node(state):                     # 节点 2：执行工具
    result = []
    for tool_call in state["messages"][-1].tool_calls:
        observation = tools_by_name[tool_call["name"]].invoke(tool_call["args"])
        result.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))
    return {"messages": result}

def should_continue(state) -> Literal["tool_node", END]:   # 条件边：下一步去哪
    return "tool_node" if state["messages"][-1].tool_calls else END

builder = StateGraph(MessagesState)
builder.add_node("llm_call", llm_call)
builder.add_node("tool_node", tool_node)
builder.add_edge(START, "llm_call")
builder.add_conditional_edges("llm_call", should_continue, ["tool_node", END])
builder.add_edge("tool_node", "llm_call")
agent = builder.compile()
agent.invoke({"messages": [...]})
```
（`model_with_tools`、`tools_by_name` 的定义见官方文档第 1 步：用 `init_chat_model` 建模型，用 `@tool` 定义工具，再 `bind_tools`。）

和第 5 课手写的循环对照：

| LangGraph | 第 5 课手写的循环 |
|---|---|
| `MessagesState` 里的 `messages` | `messages` 列表 |
| `llm_call` 节点 | `reply = llm.chat(messages)` |
| `should_continue` 条件边 | `if not reply["tool_calls"]: return ...` |
| `tool_node` 节点 + `ToolMessage(tool_call_id=...)` | 执行 `run_tool`，追加 `role: "tool"` 消息 |
| `add_edge("tool_node", "llm_call")` | `for` 循环回到开头 |
| `operator.add` | `messages.append(...)` |

框架额外给你的：把每一步的状态存下来（可以暂停、恢复、回到某一步重来）、可视化调试、流式输出。代价是多学一套概念。**暂停与恢复、人工审批这些能力，第 14 课「生产级 Agent 工程」细讲。**

## 常见误区
- ❌ "Agent 越多越强" → ✅ 先把一个 Agent 用到极限；多 Agent 要协调、更贵（约 15 倍 token），只在值得的地方用
- ❌ "子 Agent 知道主 Agent 和用户聊过什么" → ✅ 子 Agent 有自己独立的 messages，看不到聊天记录，派活时必须把背景写清楚
- ❌ "主管模式和转交模式一样" → ✅ 主管模式是派活、结果交回给主管；转交模式是把对话整个交出去，自己不再管
- ❌ "用了框架就不用懂原理" → ✅ 框架底层就是第 5 课的循环；不懂原理，框架出问题时无从查起
- ❌ "让 Agent 自己检查自己就够了" → ✅ 换一个专门挑错的审核员更容易发现问题，还要限制最多改几次

## 参考资料
- OpenAI《A practical guide to building agents》（什么时候拆、Manager 与 Handoff）：https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- Anthropic《Building effective agents》（框架的取舍）：https://www.anthropic.com/engineering/building-effective-agents
- Anthropic《How we built our multi-agent research system》：https://www.anthropic.com/engineering/multi-agent-research-system
- 12-factor-agents（第 10 条）：https://github.com/humanlayer/12-factor-agents
- LangGraph 快速入门：https://docs.langchain.com/oss/python/langgraph/quickstart
