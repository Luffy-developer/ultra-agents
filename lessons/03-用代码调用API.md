# 第 3 课：用代码调用大模型 API

## 核心概念
- API 就是"用代码点外卖"：你按格式下单（请求），服务商送回结果（响应）。
- OpenAI 兼容接口需要三样东西：`base_url`（店铺地址）、`api_key`（会员卡）、`model`（点哪道菜）。
- `messages` 是一个列表，每条消息有角色：`system`（规则）、`user`（用户）、`assistant`（模型的回答）。

## 最小代码
在练习目录新建 `hello.mjs`（`.mjs` 是 JavaScript 文件，Node.js 可以直接运行）：
```js
import OpenAI from "openai";
// 练习用：把 key 和地址换成你自己的，含 key 的文件不要发给别人
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
运行：先 `npm install openai` 安装依赖，再 `node hello.mjs`。

## 动手练习
把上面代码跑起来，然后试着修改 system 的内容，观察回答风格的变化。

## 小测验
问：想让模型"记得"上一轮对话，代码里该怎么做？
答：把上一轮的 user 和 assistant 消息都追加到 messages 列表里，再一起发送。
