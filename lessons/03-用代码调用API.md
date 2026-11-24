# 第 3 课：用代码调用大模型 API

> **学完你能**：用几行代码调用大模型；说清 `messages` 里每种角色的作用；自己写出能"记住"上下文的多轮对话；让模型按 JSON 格式回答，格式不对时让它重来。

## 基础

### 1. API 就是"用代码点外卖"
- 你按格式下单（**请求**），服务商把结果送回来（**响应**）。
- OpenAI 兼容接口需要三样东西：
  - `base_url`：店铺地址（服务商的网址）
  - `api_key`：会员卡（证明你是谁、从你的账户扣钱）
  - `model`：点哪道菜（用哪个模型）
- 很多国内外服务商（DeepSeek、通义千问、Kimi 等）都提供"OpenAI 兼容"的接口，代码一样，换这三样就行。本项目第一次运行时让你填的，就是这三样。

### 2. messages：一张按顺序排好的"对话记录"
- 发给模型的不是一句话，而是一个列表 `messages`，每条消息都标明是谁说的（`role`）：
  - `system`：规则和人设，放在最前面（第 2 课「Prompt 怎么写」）
  - `user`：用户说的话
  - `assistant`：模型之前的回答
  - （第 4 课「工具调用」还会学到 `tool`：工具执行的结果）
- 模型拿到整张记录，接着写出下一条 `assistant` 消息。

### 3. 最小代码
Python 版（先运行 `pip install openai` 安装）：
```python
from openai import OpenAI

# 练习用：把 key 和地址换成你自己的。含 key 的文件不要发给别人、不要传到网上
client = OpenAI(api_key="你的key", base_url="你的地址")
resp = client.chat.completions.create(
    model="你的模型",
    messages=[
        {"role": "system", "content": "你是一个友好的助手"},
        {"role": "user", "content": "用一句话介绍你自己"},
    ],
)
print(resp.choices[0].message.content)
```
JavaScript 版（本项目用的就是它）：在练习目录新建 `hello.mjs`，先 `npm install openai`，再 `node hello.mjs`：
```js
import OpenAI from "openai";
const client = new OpenAI({ apiKey: "你的key", baseURL: "你的地址" });
const resp = await client.chat.completions.create({
  model: "你的模型",
  messages: [
    { role: "system", content: "你是一个友好的助手" },
    { role: "user", content: "用一句话介绍你自己" },
  ],
});
console.log(resp.choices[0].message.content);
```
动手试试：改改 `system` 的内容（比如"你是一只说话带喵的猫"），看回答风格怎么变。

### 4. 多轮对话：历史要自己带上
- 第 1 课说过，模型**没有记忆**。第二轮只发"那它多大了？"，模型根本不知道"它"是谁。
- 做法：每一轮都把之前的 `user` 和 `assistant` 消息一起发过去：
```python
history = [{"role": "system", "content": "你是一个友好的助手"}]

def chat(user_input):
    history.append({"role": "user", "content": user_input})
    resp = client.chat.completions.create(model="你的模型", messages=history)
    reply = resp.choices[0].message.content
    history.append({"role": "assistant", "content": reply})   # 模型的回答也要记下来
    return reply
```
- 比喻：每次都把整本聊天记录复印一份递给顾问，他才能接着聊。所以聊得越久，每次要递的纸越多——这也是为什么长对话更贵（第 1 课「大模型是什么」）。
- 看看本项目：`src/agent.ts` 里的 `messages` 数组就是这本聊天记录，你每说一句，导师都把整本发给模型。

### 5. Key 要保管好
- API Key 等于你的钱包，被别人拿到就能用你的额度。
- 练习时可以临时写在代码里，但**不要把含 key 的文件发给别人或传到网上**。正式的做法是放在环境变量或配置文件里（本项目放在 `~/.agent-tutor/config.json`，只有你自己能读）。

## 进阶

### 1. 流式输出：边生成边显示
- 普通调用要等模型全部写完才返回，长回答可能要等十几秒。加上 `stream=True`，模型每写出一小段就发回来一段：
```python
stream = client.chat.completions.create(model="你的模型", messages=history, stream=True)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```
- 看看本项目：导师的回答一个字一个字地出现，就是流式输出（`src/agent.ts` 的 `createStream`）。流式时默认拿不到 token 用量，要加 `stream_options: { include_usage: true }`；有的服务商不认这个参数，本项目报错一次后就不再带它。

### 2. 结构化输出：让模型按 JSON 回答
- 程序要用模型的回答（存数据库、传给下一步），需要固定的格式，而不是一段自由发挥的文字。常见做法：
  1. 在 Prompt 里写清楚要输出什么 JSON、有哪些字段，最好给一个例子
  2. 很多服务商支持 `response_format={"type": "json_object"}`，强制模型输出合法的 JSON（具体支持情况看服务商文档）
  3. **拿到后一定要校验**：能不能解析、该有的字段有没有
  4. 校验不通过，把错误说明发回给模型让它重来，并**设上重试次数**
- 这和第 4 课「工具调用」的思路一样：出错时告诉模型错在哪、该怎么改，它往往就能改对。

### 3. 出错与重试
- 调用 API 常见的错误：
  - **401/403**：key 不对或没权限 → 重试没用，要改配置
  - **404**：地址或模型名写错了 → 重试没用
  - **429 限流**：请求太快或额度用完 → 等一会儿再试
  - **超时、5xx 服务器错误、网络断了** → 可以重试
- 重试要**等待逐渐变长**（比如等 1 秒、2 秒、4 秒，叫"指数退避"），并且有次数上限，否则服务已经很忙了还在狂发请求。
- OpenAI 的官方 SDK 默认会对限流、超时、服务器错误自动重试 2 次，所以你自己的代码主要处理"重试也没用"的错误。
- 看看本项目：`src/index.ts` 把常见错误翻译成了小白能看懂的提示，比如 401/403 提示"API Key 不对或没有权限，输入 /setup 修改"。

## 常见误区
- ❌ "模型会自动记住上一轮对话" → ✅ 每次都要把历史消息一起发过去，模型的回答也要加进历史
- ❌ "只要把用户说的话记下来就行" → ✅ `assistant` 的回答也要记，否则模型不知道自己说过什么
- ❌ "让模型输出 JSON，拿到就能直接用" → ✅ 模型可能输出不合法的 JSON 或缺字段，一定要校验，失败时让它重来
- ❌ "出错了就一直重试" → ✅ key 错、地址错重试没用；能重试的错误也要设次数上限、逐渐延长等待
- ❌ "把 key 写进代码传到网上没关系" → ✅ key 等于钱包，泄露了别人就能花你的钱

## 动手作业（作业名：03-call-api）
用一个按剧本回复的假大模型（不联网、不花钱），亲手写一个多轮对话函数 `chat`：把用户的话和模型的回答都记进历史，多轮之后历史正确累积。
进阶档还要写 `ask_json`：要求模型输出 JSON，解析失败或缺字段时把错误说明发回去让它重试，超过次数就放弃。

## 参考资料
- OpenAI《A practical guide to building agents》：https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- Hugging Face Agents Course 第 1 单元（消息和聊天模板）：https://huggingface.co/learn/agents-course/unit1/introduction
