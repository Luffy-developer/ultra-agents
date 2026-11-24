# agent-tutor：AI Agent 学习导师

一个在终端里教小白学习 AI Agent 的 AI Agent，用法类似 Claude Code / Codex：
在任意目录输入 `agent-tutor`，它会摸底你的水平、按课程一步步教、派「出题官」子 Agent 出题检验，
还能在当前目录帮你创建练习文件、运行代码、上网搜索资料，并能通过 MCP 接入更多工具，带你边学边做。

## 安装

需要 Node.js 20 或更高版本。

```bash
cd ~/GitHub/ultra-agents
npm install        # 安装依赖
npm run build      # 把 TypeScript 编译成 JavaScript（输出到 dist/）
npm link           # 注册成全局命令 agent-tutor
```

## 使用

```bash
mkdir ~/agent-practice && cd ~/agent-practice   # 建一个练习目录
agent-tutor
```

第一次运行会让你填写模型配置（OpenAI 兼容接口的 base_url、模型名、API Key），
以及可选的网页搜索服务，保存在 `~/.agent-tutor/config.json`。
也可以用环境变量临时覆盖：`OPENAI_BASE_URL`、`MODEL_NAME`、`OPENAI_API_KEY`、`SEARCH_PROVIDER`、`SEARCH_API_KEY`。

### 网页搜索（可选）

| 搜索服务 | 说明 | 获取 key |
|---|---|---|
| `bocha` 博查 | 国内服务，国内网络直接可用，中文效果好 | https://open.bochaai.com |
| `tavily` | 国外服务，有免费额度 | https://tavily.com |

运行 `agent-tutor --setup`（或在程序里输入 `/setup`），选择搜索服务并填入 key。
配置好后，用 `agent-tutor --test-search 关键词` 检查 key 能不能用（不启动导师，不消耗模型额度）。
不配置也能用：导师照常上课，只是不能搜索；读取指定网址（`web_fetch`）不需要 key。

> 注意：所用模型需要支持 function calling（工具调用）。

输入 `/` 会弹出命令菜单（和 Claude Code 一样）：边打字边筛选，`↑↓` 选择，`Tab` 补全，`Enter` 执行，`Esc` 关闭。
`/resume`、`/mcp` 后面加空格，菜单会列出可选的对话、服务器。

| 操作 | 说明 |
|---|---|
| `/progress` | 查看学习进度 |
| `/memory` | 查看导师记住了你什么，以及你写的 TUTOR.md |
| `/clear` | 开始新对话（学习进度和记忆不会丢，之前的对话会保存） |
| `/resume [序号]` | 从历史对话里挑一个接着聊 |
| `/compact` | 把当前对话压缩成摘要（对话太长时也会自动压缩） |
| `/todos` | 查看导师正在做的待办清单 |
| `/cost` | 查看本次启动以来用了多少 token、花了多少钱 |
| `/setup` | 修改模型和搜索服务配置 |
| `/model [模型名]` | 列出模型服务里可用的模型；加模型名就切换过去（保存为默认） |
| `/mcp [服务器名]` | 查看已连接的 MCP 服务器；加服务器名查看每个工具的说明 |
| `/mcp add 名字 命令或网址` | 添加 MCP 服务器，马上连接；`/mcp remove 名字` 删除 |
| `/skills [名字]` | 查看可用的技能；`/技能名 要求` 直接使用某个技能 |
| `/hooks` | 查看设置好的 hooks 和写法 |
| `/details` 或 Ctrl+O | 展开上一轮的完整过程（思考、工具调用和结果） |
| `/verbose` | 切换显示方式：过程折叠成一行总结 / 每一步都完整显示 |
| `/agents [名字]` | 查看导师可以派出的子 Agent；加名字查看人设和能用的工具 |
| `/help` | 帮助 |
| `/exit` 或 Ctrl+D | 退出 |
| Ctrl+C | 打断正在进行的回答 |

想接着上次的对话聊：`agent-tutor --continue`（或 `-c`）。
不进入对话、问一句就退出：`agent-tutor -p "什么是 Agent？"`（回答输出到 stdout，适合写脚本；需要确认的操作一律拒绝）。

### 导师能做的事

- **讲课**：按讲义一节节教，派出题官出题检验，记住你的薄弱点
- **动手**：在练习目录里新建文件（`write_file`）、只改某几行（`edit_file`）、按文件名找文件（`glob`）、按内容搜代码（`grep`）、运行命令
- **规划**：做 3 步以上的任务时，先列出「⎿ [todo]待办清单」，做一项勾一项
- **上网**：搜索、读网页；通过 MCP 和子 Agent 还能做更多

导师的思考过程和工具调用**默认折叠**成一行灰色总结（和 Claude Code 一样），并随着进度实时刷新：

```
  ⎿ 思考了 3 秒 · 读了 hello.js、api.js · 搜索代码「fetch」· 运行了 node hello.js（ctrl+o 展开）
```

- 回到输入框时按 **Ctrl+O**（或输入 `/details`），展开上一轮的完整过程：思考全文、每次工具调用的参数和结果、子 Agent 的每一步、hook 的输出
- 输入 `/verbose` 切换成一直完整显示，再输入一次切换回来
- 需要你看到的内容不会折叠：「允许吗？」确认、待办清单、hook 拦截警告、子 Agent 没完成的提醒

展开后，每一步以 `⎿ [标签]内容` 的形式显示，标签说明是哪一类：

| 标签 | 含义 | 例子 |
|---|---|---|
| `[tools]` | 内置工具 | `⎿ [tools]update_memory 更新记忆 · m3 怕看长代码` |
| `[mcp]` | MCP 工具 | `⎿ [mcp]amap/search_poi · 北京 咖啡店` |
| `[agent]` | 子 Agent（下面缩进一层的是子 Agent 在用的工具） | `⎿ [agent]researcher 派出子 Agent · 查 MCP 资料` |
| `[todo]` | 待办清单 | `⎿ [todo]待办清单（1/3）` |
| `[think]` | 思考过程（DeepSeek-R1 这类推理模型才有） | `⎿ [think]思考过程` |
| `[usage]` | 这一轮的 token 用量 | `⎿ [usage]输入 12.3k · 输出 456` |

### 用量和花费

导师每说完一轮，下面会有一行灰字显示这一轮的用量，例如 `⎿ [usage]调用模型 3 次 · 输入 12.3k（缓存 8.0k） · 输出 456 · 约 ¥0.0123`，
输入 `/cost` 查看总账。想看到花了多少钱，在 `/setup` 里填写模型价格（每百万 token 的「输入价/输出价/缓存价」）。
子 Agent 用了别的模型时，在 `config.json` 的 `prices` 里按模型名补上：

```json
"prices": { "主模型名": { "input": 2, "output": 8, "cached": 0.5 }, "小模型名": { "input": 0.3, "output": 0.6 } },
"currency": "¥"
```

个别模型服务不返回用量，这时就不显示。

### 自动化评估

```bash
agent-tutor --eval                  # 跑一遍内置的测试题（evals/cases.json）
agent-tutor --eval --only 安全       # 只跑名字里带「安全」的题
agent-tutor --eval 我的题.json -v    # 用自己的测试题，并显示导师的每一句回答
JUDGE_MODEL=更强的模型 agent-tutor --eval   # 评委换一个更强的模型
```

每道题用假的学习进度和临时练习目录，不会改动你真正的进度和文件。评估时允许导师在临时目录里写文件、改文件，运行命令和 MCP 工具一律拒绝。
测试题的写法（完整例子见 `evals/cases.json`）：

```json
{
  "name": "精确修改：只改需要改的地方",
  "progress": { "level": "入门", "completed": ["01-大模型是什么.md"] },
  "files": { "hello.js": "const name = \"World\";\n" },
  "input": "帮我把 hello.js 里的 World 改成 小白",
  "expect": {
    "tools": ["edit_file"],
    "notTools": ["write_file"],
    "files": { "hello.js": "小白" },
    "judge": "导师改之前先说明了要做什么"
  }
}
```

- `input` 写成数组就是多轮对话
- `tools`：必须调用过的工具，`"a|b"` 表示调用其中一个就行，`"task:quiz-maker"` 表示派了出题官
- `contains` / `notContains`：回答里必须有 / 不能有的文字；`files`：跑完后文件里必须包含的文字
- `judge`：评分标准，交给评委模型判断
- 报告保存在 `~/.agent-tutor/evals/`；有题没通过时退出码为 1，方便以后接到 CI 里自动跑

### 说明文件 TUTOR.md（可选）

像 Claude Code 的 `CLAUDE.md` 一样，写下你希望导师怎么教你，导师每次开始新对话时都会读：
- `~/.agent-tutor/TUTOR.md`：对所有目录生效
- 练习目录里的 `TUTOR.md`：只对这个目录生效

导师写文件、运行命令前都会问你「允许吗？」：`y` 允许一次，`a` 本次对话都允许，`n` 拒绝。
文件操作只能在启动时所在的目录（练习目录）里进行。

### 接入 MCP 工具（可选）

MCP 是给 Agent 用的"标准插头"：别人写好的 MCP 服务器（地图、数据库、浏览器……）可以直接接进来，导师就多了这些工具。
创建 `~/.agent-tutor/mcp.json`，格式和 Claude Code / Claude 桌面版一样：

```json
{
  "mcpServers": {
    "everything": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"] },
    "远程服务器": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer 你的token" } },
    "暂时不用的": { "command": "npx", "args": ["-y", "某个包"], "disabled": true }
  }
}
```

- 本地服务器写 `command` + `args`（需要 key 的话写在 `env` 里），远程服务器写 `url`
- 也可以不改文件，直接在程序里输入 `/mcp add 名字 npx -y 包名` 或 `/mcp add 名字 https://网址`，马上连接、马上能用
  （需要 key：`/mcp add 名字 -e KEY=值 npx -y 包名`；远程服务器加请求头：`-H "Authorization: Bearer xx"`；`-e`、`-H` 写在命令前面）
- 直接改文件的话要重启 agent-tutor 才生效；启动时第一屏会显示连接结果，输入 `/mcp` 查看详情
- 每次调用 MCP 工具前都会征求你的同意。本地 MCP 服务器是在你电脑上运行的程序，只安装可信来源的

### 子 Agent

和 Claude Code 一样，导师（主 Agent）可以用 `task` 工具把独立的任务派给子 Agent。
子 Agent 有自己的人设、只能用分配给它的工具、看不到你们的聊天记录，做完只把结果交回给导师；
导师一次派出几个时，它们会同时开工。

内置四个：`quiz-maker`（出题官）、`quiz-reviewer`（审题官）、`researcher`（调研员，需要配置网页搜索）、`general-purpose`（通用助手）。

**反思**：子 Agent 可以指定一个审核员。交结果前先请审核员检查，不通过就带着意见退回修改，最多改 2 次。
出题官就配了审题官：检查题目是不是讲义里讲过的、答案对不对、提示有没有泄露答案。
自定义子 Agent：在 `~/.agent-tutor/agents/`（所有目录生效）或练习目录的 `.agent-tutor/agents/`（只对这个目录生效）
新建一个 `.md` 文件，格式和 Claude Code 的 `.claude/agents/*.md` 一样，改完不用重启：

```markdown
---
name: code-reviewer
description: 代码检查员：检查学生写的代码有没有错误，用小白能懂的话指出问题
tools: read_file, list_files
model: 可选，不写就和导师用同一个模型
reviewer: 可选，审核员的名字
---
你是代码检查员。先用 list_files 找到要检查的文件，再用 read_file 读代码，逐个指出问题。
```

- `tools` 不写就能用除了「改学生进度和记忆」以外的全部工具；`mcp__*` 表示所有 MCP 工具
- 子 Agent 写文件、运行命令时同样会征求你的同意，并注明是哪个子 Agent 发起的
- `reviewer: 审核员名字`：交结果前先请这个子 Agent 审核（审核员第一行要写「结论：通过」或「结论：不通过」）
- 和内置子 Agent 同名的会覆盖内置的

### 技能 Skills

和 Claude Code 的 Skills 一样：把一套做事方法写成说明书，导师平时只看得到名字和一句话说明，用得上时才调用 `use_skill` 读全文（不占每一轮的上下文）。
也可以直接输入 `/技能名 要求` 使用，比如 `/study-plan 每周学两次`。

内置两个：`study-plan`（定学习计划）、`explain-code`（逐段给小白讲代码）。
自己写：在 `~/.agent-tutor/skills/`（所有目录生效）或练习目录的 `.agent-tutor/skills/` 里新建一个文件夹，放一个 `SKILL.md`：

```markdown
---
name: weekly-review
description: 帮学生做每周学习复盘。学生说"复盘一下""这周学了什么"时使用
---
1. 用 get_progress 看这周学完了哪些课
2. 每节课问学生一个问题，检查还记不记得
```

文件夹里还可以放模板、例子等附件，导师需要时会读。改完不用重启。

### Hooks

和 Claude Code 的 Hooks 一样：在特定时刻自动运行你写的命令，不经过模型。在 `~/.agent-tutor/hooks.json` 里设置：

```json
{
  "hooks": {
    "PostToolUse": [{ "matcher": "write_file|edit_file", "command": "npx prettier --write \"$AGENT_TUTOR_FILE\"" }],
    "PreToolUse": [{ "matcher": "run_command", "command": "grep -q 'rm -rf' && echo '不许删除文件' >&2 && exit 2 || exit 0" }],
    "UserPromptSubmit": [{ "command": "date" }],
    "Stop": [{ "command": "afplay /System/Library/Sounds/Glass.aiff" }]
  }
}
```

| 时刻 | 说明 |
|---|---|
| `PreToolUse` | 导师调用工具之前。命令以退出码 2 结束 = 拦下这次调用，错误输出会告诉导师原因 |
| `PostToolUse` | 工具执行完之后。退出码 2 时，错误输出会作为反馈交给导师 |
| `UserPromptSubmit` | 你发消息之后、导师回答之前。命令的输出会作为补充信息交给导师；退出码 2 = 这条消息不发 |
| `Stop` | 导师回答完一轮 |

- `matcher` 是匹配工具名的正则，不写就是所有工具；也兼容 Claude Code 嵌套的 `"hooks": [{ "type": "command", ... }]` 写法
- 命令能拿到：环境变量 `AGENT_TUTOR_FILE`（工具参数里文件的完整路径）、`AGENT_TUTOR_TOOL`、`AGENT_TUTOR_EVENT`，标准输入里是完整信息（JSON）
- 改完马上生效。为了安全，只读取 `~/.agent-tutor/hooks.json`，不读练习目录里的（免得打开别人的项目就自动执行别人写的命令）
- 自动化评估时不会运行 hooks

## 开发

```bash
npm run dev         # 不用编译，直接运行源码（改完代码立即生效）
npm run typecheck   # 类型检查
npm run build       # 编译；npm link 过的全局命令会用到最新的编译结果
```

## 项目结构

| 文件 | 作用 |
|---|---|
| `src/index.ts` | 命令行入口：读配置、对话循环、斜杠命令、Ctrl+C 打断 |
| `src/agent.ts` | Agent 本体：导师人设（System Prompt）+ Agent 循环（`runTurn`，流式输出）+ 对话压缩 |
| `src/memory.ts` | 长期记忆：学习进度、可增删改的记忆条目、读取 TUTOR.md |
| `src/session.ts` | 会话存档与恢复 |
| `src/tools.ts` | 工具清单：学习进度与记忆、课程讲义、练习目录里的文件（读、写、精确修改、glob、grep）和命令、网页工具 |
| `src/todo.ts` | 待办清单工具 `todo_write`（规划能力） |
| `src/usage.ts` | token 用量统计和花费计算 |
| `src/eval.ts` | 自动化评估：跑测试题、规则检查、评委模型打分 |
| `evals/cases.json` | 内置的测试题 |
| `src/subagents.ts` | 子 Agent：内置和自定义子 Agent 的定义、派活用的 `task` 工具、审核员（反思） |
| `src/skills.ts` | 技能：加载 SKILL.md，`use_skill` 工具 |
| `src/hooks.ts` | Hooks：在工具调用前后、发消息后、回答完时运行你的命令 |
| `src/frontmatter.ts` | 解析子 Agent、技能文件开头的 `---` 头部 |
| `skills/` | 内置的技能 |
| `src/web.ts` | 网页工具：`web_search` 调用搜索 API，`web_fetch` 读取网页正文 |
| `src/mcp.ts` | MCP 客户端：连接 MCP 服务器，把它们的工具接进导师的工具列表 |
| `src/config.ts` | 模型配置和首次运行向导 |
| `src/activity.ts` | 过程折叠：把思考和工具调用合成一行总结，Ctrl+O 展开完整过程 |
| `src/ui.ts` | 终端显示：颜色、文字宽度（中文占两格）、工具调用提示、权限确认 |
| `src/markdown.ts` | 把导师回答里的 Markdown（标题、加粗、列表、代码块、表格）渲染成终端样式，支持流式输出 |
| `src/input.ts` | 输入框的命令补全菜单 |
| `src/commands.ts` | 斜杠命令清单：名字、说明、参数补全，帮助文字也从这里生成 |
| `lessons/` | 课程讲义，导师通过 `read_lesson` 读取，可自行增改（改完直接生效，不用重新编译） |

数据目录 `~/.agent-tutor/`：
- `config.json`：模型和搜索服务配置
- `mcp.json`：MCP 服务器（可选）
- `agents/`：自定义子 Agent（可选）
- `skills/`：自定义技能（可选）
- `hooks.json`：Hooks（可选）
- `TUTOR.md`：你写给导师的说明（可选）
- `progress.json`：学习进度和导师对你的记忆（删掉即可从头开始）
- `sessions/`：对话存档，只保留最近 30 个
- `evals/`：自动化评估的报告

## 后续可以做的
1. 课程多了以后，把 `read_lesson` 升级为向量检索（RAG，第 7 课）
2. 发布到 npm，让别人 `npm install -g agent-tutor` 就能用
