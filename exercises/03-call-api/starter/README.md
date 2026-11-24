# 第 3 课作业：让模型"记住"对话，并按 JSON 格式回答

模型没有记忆：想让它记得上一轮说了什么，**程序要自己保存对话历史，每次一起发过去**。
打开 `chat.py`，把标了 `TODO` 的函数写出来。

这份作业用的是**假的大模型**（`fake_llm.py`）：它不联网、不花钱，按写好的剧本一句句回复。
用法和真的 API 一样：`reply = llm.chat(messages)`，`reply["content"]` 就是模型回答的文字。

## 基础要求：写 `chat(llm, history, user_input)`

`history` 是对话历史（一个列表，里面可能已经有一条 system 消息）。每调用一次 `chat`：

1. 把用户这句话加进 `history`：`{"role": "user", "content": user_input}`
2. 用**整个** `history` 问模型：`llm.chat(history)`
3. 把模型的回答也加进 `history`：`{"role": "assistant", "content": 回答的文字}`
4. 返回回答的文字

要直接修改传进来的 `history` 列表（不要新建一个），这样连续调用几次 `chat`，历史会越来越长，模型就能"记得"之前的内容。

## 进阶要求（进阶档）：写 `ask_json(llm, question, required_keys, max_retries=2)`

让模型用 JSON 回答，程序拿到后检查格式，不对就让它重来：

1. 新建一段对话，第一条是 user 消息，内容里要包含 `question`（可以再加上你对格式的要求）
2. 问模型，拿到回答的文字，用 `json.loads` 解析
3. 如果解析成功、是一个字典、并且 `required_keys` 里的字段都有 → 返回这个字典
4. 否则：把模型这次的回答（assistant 消息）和一条说明错误的 user 消息都加进对话，再问一次
   - 不是合法 JSON 时，说明里要包含「JSON」
   - 缺字段时，说明里要写出缺了哪些字段的名字
5. 最多重试 `max_retries` 次（也就是最多问模型 `1 + max_retries` 次），还不对就返回 `None`

## 怎么检查

- 自己跑跑看：`python3 try_it.py`
- 写完告诉导师「写好了」，导师会运行检查脚本告诉你哪些通过了
