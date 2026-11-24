# 第 10 课：MCP 与 A2A

> **学完你能**：说清楚 MCP 解决什么问题、是怎么工作的；在本项目里接上一个 MCP 服务器；分清 MCP 和 A2A 各管什么；知道接第三方 MCP 服务器有哪些风险。

## 基础

### 1. 为什么需要 MCP
- 前面几课，我们的工具都是**直接写在 Agent 代码里**的：读讲义、写文件、上网搜索……
  问题是：想加一个新能力（查地图、操作数据库、读 GitHub），就得自己写一遍。别人的 Agent 也得再写一遍。
- **MCP（Model Context Protocol，模型上下文协议）** 是一个统一标准：
  - 工具被做成一个独立的程序，叫 **MCP 服务器**
  - Agent 这一边叫 **MCP 客户端**，按标准连上服务器，就能问它"你有哪些工具"，然后调用
  - 一个 MCP 服务器写好了，Claude Code、Cursor、本项目……所有支持 MCP 的 Agent 都能直接用

比喻：以前的工具 = **焊死在电器上的零件**，只有这台电器能用；MCP 工具 = **带标准插头的电器**，插到哪个插座（Agent）上都能用。MCP 就是那个"插头和插座的国家标准"。

### 2. 它是怎么工作的
1. **启动**：Agent 按配置启动 MCP 服务器（本地的就运行一个程序，远程的就通过网络连接）
2. **握手**：双方打个招呼，确认都说"MCP 这门语言"
3. **问工具**：Agent 问"你有哪些工具？"，服务器回答每个工具的名字、用途、参数——就是第 4 课「工具调用」里的"工具说明书"
4. **调用**：模型决定用某个工具时，Agent 把请求转给服务器，服务器干完活把结果送回来

你会发现：第 3、4 步和 Function Calling 一模一样，MCP 只是把"工具"搬到了 Agent 外面，并统一了说话的格式。
除了工具（Tools，能调用的动作），MCP 服务器还可以提供资源（Resources，只读的数据）和提示模板（Prompts）（来自微软 AI Agents for Beginners 第 11 课）。

### 3. 看看本项目
- 打开 agent-tutor 源码里的 `src/mcp.ts`，这就是一个 MCP 客户端
- 配置文件：`~/.agent-tutor/mcp.json`，格式和 Claude Code 一样，网上找到的配置可以直接复制
- 在 agent-tutor 里输入 `/mcp`，能看到连上了哪些服务器、各有哪些工具
- MCP 工具在导师这里的名字是 `mcp__服务器名__工具名`，终端里出现「⎿ [mcp]服务器名/工具名」就是在用 MCP 工具

### 4. 动手试试
1. 用编辑器创建 `~/.agent-tutor/mcp.json`，写入（这是 MCP 官方的演示服务器，不需要 key）：
   ```json
   {
     "mcpServers": {
       "everything": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"] }
     }
   }
   ```
2. 重启 agent-tutor，看第一屏「MCP：」那一行，再输入 `/mcp` 看看有哪些工具
3. 对导师说：「用 MCP 工具帮我算一下 2 加 3」，观察它调用了哪个工具

不想手动改 JSON 文件的话，在 agent-tutor 里输入：
- `/mcp add 名字 npx -y 包名`：添加本地服务器（需要 key 就写成 `/mcp add 名字 -e KEY=值 npx -y 包名`）
- `/mcp add 名字 https://网址`：添加远程服务器
- `/mcp remove 名字`：删除

添加后**马上连接**，导师当场就能用上新工具；配置也会写进 `mcp.json`，下次启动自动连接。这和 Claude Code 的 `claude mcp add` 是一个意思。

### 5. A2A：Agent 和 Agent 之间的标准
- MCP 管的是 **Agent ↔ 工具和数据**：Agent 去调用一个工具
- **A2A（Agent-to-Agent，Agent 间协议）** 管的是 **Agent ↔ Agent**：一个 Agent 把任务交给另一个 Agent，哪怕它们是不同公司、用不同技术做的（来自微软 AI Agents for Beginners 第 11 课；Google 的 5 天 Agent 集训第 5 天也把它和部署放在一起讲）
- 比喻：MCP 像员工使用公司里的各种**工具**（打印机、报销系统）；A2A 像两家公司的**员工之间**对接工作——对方有自己的判断，不是一个按一下就出结果的按钮
- A2A 里的几个概念：
  - **Agent Card（名片）**：写明这个 Agent 叫什么、会做哪些事、地址在哪、支持哪些能力，别的 Agent 看名片决定找不找它
  - **Artifact（成果）**：对方 Agent 干完活交回来的结果
  - 任务可能要做很久，所以协议支持在做完之前持续发进度消息
- 本项目里的子 Agent（第 11 课「多 Agent 与框架」）都在同一个程序里，用 `task` 工具直接派活，不需要 A2A；当 Agent 分布在不同的服务、不同的公司时，才需要 A2A 这样的标准

### 6. 安全：MCP 服务器就是一个程序
- 本地的 MCP 服务器就是**在你电脑上运行的一个程序**，权限和你一样大。只安装官方或可信来源的服务器，就像不乱装来路不明的软件
- 所以本项目每次调用 MCP 工具前，都会先问你「允许吗？」（`src/mcp.ts`：MCP 工具是第三方写的，能做什么全看服务器）
- MCP 工具返回的内容也可能来自网上，和第 9 课「让 Agent 上网」一样，要防范提示词注入

## 进阶

### 1. 工具名前缀
- 接的服务器多了，很容易出现重名的工具（好几个服务器都有 `search`）。本项目给每个 MCP 工具加上 `mcp__服务器名__` 前缀，既避免和自带工具重名，也能让模型一眼看出工具来自哪里
- 这正是第 4 课「工具调用」进阶部分讲的原则：加前缀区分来源（Anthropic 的例子是 `asana_search`、`jira_search`）
- 本项目还会在每个 MCP 工具的说明前加上 `[来自 MCP 服务器 xxx]`

### 2. 工具注解：告诉客户端这个工具危不危险
（来自 Anthropic《Writing effective tools for agents》）
- MCP 允许服务器给工具加**注解**，比如：这个工具会不会做**破坏性修改**（删数据、改文件）、会不会访问**外部的开放世界**（任意网站）
- 客户端可以据此决定策略：只读的工具直接放行，破坏性的工具每次都问人
- 本项目目前比较保守：不看注解，所有 MCP 工具一律先问你。想做得更细，可以按注解分级

### 3. 接第三方 MCP 服务器的风险：回到致命三要素
- 第 9 课的「致命三要素」：私有数据 + 不可信内容 + 对外通信，三样同时具备就可能被偷数据
- 接 MCP 服务器很容易**一下子把三样凑齐**：一个能读你邮箱（私有数据），一个能读网页（不可信内容），一个能发消息（对外通信）——单独看都无害，装在同一个 Agent 上就危险了
- 工具的说明书和返回结果都会进入模型的上下文，一个不可信的服务器也可以在里面藏指令
- 做法：
  - 只装可信来源的服务器，按需开启，不用的及时 `/mcp remove`
  - 装之前想一想：加上它之后，这个 Agent 有没有凑齐三要素
  - 破坏性的、往外发的操作保留人工确认

### 4. 什么时候自己写工具，什么时候用 MCP
- 只有自己的 Agent 用、和业务逻辑紧密相关的：直接写成普通工具最简单
- 想给多个 Agent / 多个客户端共用，或者要用别人已经做好的能力（GitHub、数据库、地图）：用 MCP

## 常见误区
- ❌ "MCP 是一种新的模型能力" → ✅ 它只是一个连接标准，模型那一侧还是普通的工具调用
- ❌ "MCP 和 A2A 是一回事" → ✅ MCP 连工具和数据，A2A 让 Agent 和 Agent 互相派活
- ❌ "网上找到的 MCP 服务器装上就能放心用" → ✅ 它是一个权限和你一样大的程序，只装可信来源的
- ❌ "每个服务器单独看都安全，装在一起也安全" → ✅ 组合起来可能凑齐致命三要素
- ❌ "工具名随便起，模型会分清" → ✅ 服务器多了容易重名、选错，要加前缀

## 参考资料
- MCP 官方网站：https://modelcontextprotocol.io
- 微软 AI Agents for Beginners 第 11 课（MCP、A2A、NLWeb）：https://github.com/microsoft/ai-agents-for-beginners/blob/main/11-agentic-protocols/README.md
- Anthropic《Writing effective tools for agents》：https://www.anthropic.com/engineering/writing-tools-for-agents
- Simon Willison《The lethal trifecta for AI agents》：https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
