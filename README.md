# agent-tutor：AI Agent 学习导师

一个在终端里教小白学习 AI Agent 的 AI Agent，用法类似 Claude Code / Codex：
在任意目录输入 `agent-tutor`，它会摸底你的水平、按课程一步步教、请「出题官」出题检验，
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
| `/setup` | 修改模型和搜索服务配置 |
| `/mcp [服务器名]` | 查看已连接的 MCP 服务器；加服务器名查看每个工具的说明 |
| `/help` | 帮助 |
| `/exit` 或 Ctrl+D | 退出 |
| Ctrl+C | 打断正在进行的回答 |

想接着上次的对话聊：`agent-tutor --continue`（或 `-c`）。

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
- 修改后重启 agent-tutor 生效；启动时第一屏会显示连接结果，输入 `/mcp` 查看详情
- 每次调用 MCP 工具前都会征求你的同意。本地 MCP 服务器是在你电脑上运行的程序，只安装可信来源的

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
| `src/tools.ts` | 工具清单：学习进度与记忆、课程讲义、练习目录里的文件和命令，并注册出题官和网页工具 |
| `src/quiz.ts` | 子 Agent「出题官」，被包装成 `generate_quiz` 工具 |
| `src/web.ts` | 网页工具：`web_search` 调用搜索 API，`web_fetch` 读取网页正文 |
| `src/mcp.ts` | MCP 客户端：连接 MCP 服务器，把它们的工具接进导师的工具列表 |
| `src/config.ts` | 模型配置和首次运行向导 |
| `src/ui.ts` | 终端显示：颜色、文字宽度（中文占两格）、工具调用提示、权限确认 |
| `src/markdown.ts` | 把导师回答里的 Markdown（标题、加粗、列表、代码块、表格）渲染成终端样式，支持流式输出 |
| `src/input.ts` | 输入框的命令补全菜单 |
| `src/commands.ts` | 斜杠命令清单：名字、说明、参数补全，帮助文字也从这里生成 |
| `lessons/` | 课程讲义，导师通过 `read_lesson` 读取，可自行增改（改完直接生效，不用重新编译） |

数据目录 `~/.agent-tutor/`：
- `config.json`：模型和搜索服务配置
- `mcp.json`：MCP 服务器（可选）
- `TUTOR.md`：你写给导师的说明（可选）
- `progress.json`：学习进度和导师对你的记忆（删掉即可从头开始）
- `sessions/`：对话存档，只保留最近 30 个

## 后续可以做的
1. 准备一组测试提问，做自动化评估（第 11 课）
2. 课程多了以后，把 `read_lesson` 升级为向量检索（RAG，第 7 课）
3. 发布到 npm，让别人 `npm install -g agent-tutor` 就能用
