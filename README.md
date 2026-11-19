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

| 操作 | 说明 |
|---|---|
| `/progress` | 查看学习进度 |
| `/clear` | 开始新对话（学习进度不会丢） |
| `/setup` | 修改模型和搜索服务配置 |
| `/mcp` | 查看已连接的 MCP 服务器和工具 |
| `/help` | 帮助 |
| `/exit` 或 Ctrl+D | 退出 |
| Ctrl+C | 打断正在进行的回答 |

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
| `src/agent.ts` | Agent 本体：导师人设（System Prompt）+ Agent 循环（`runTurn`，流式输出）+ 短期记忆裁剪 |
| `src/tools.ts` | 工具清单：学习进度、课程讲义、练习目录里的文件和命令，并注册出题官和网页工具 |
| `src/quiz.ts` | 子 Agent「出题官」，被包装成 `generate_quiz` 工具 |
| `src/web.ts` | 网页工具：`web_search` 调用搜索 API，`web_fetch` 读取网页正文 |
| `src/mcp.ts` | MCP 客户端：连接 MCP 服务器，把它们的工具接进导师的工具列表 |
| `src/config.ts` | 模型配置和首次运行向导 |
| `src/ui.ts` | 终端显示：颜色、工具调用提示、权限确认 |
| `lessons/` | 课程讲义，导师通过 `read_lesson` 读取，可自行增改（改完直接生效，不用重新编译） |

数据目录 `~/.agent-tutor/`：`config.json`（模型配置）、`mcp.json`（MCP 服务器，可选）、`progress.json`（学习进度，删掉即可重新开始）。

## 后续可以做的
1. 准备一组测试提问，做自动化评估（第 11 课）
2. 课程多了以后，把 `read_lesson` 升级为向量检索（RAG，第 7 课）
3. 更像 Claude Code：读取练习目录里的说明文件、对话自动总结压缩、会话保存与恢复
4. 发布到 npm，让别人 `npm install -g agent-tutor` 就能用
