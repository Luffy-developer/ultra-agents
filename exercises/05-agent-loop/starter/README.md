# 第 5 课作业：亲手写一个 Agent 循环

Agent 循环就是：**问模型 → 模型要调用工具就去执行、把结果交回给它 → 再问模型……直到它给出最终回答**。
打开 `agent.py`，把 `run_agent` 函数写出来。

这份作业用的是**假的大模型**（`fake_llm.py`）：它不联网、不花钱，按写好的剧本一句句回复。
它返回的格式和真的 OpenAI 接口一模一样，所以你写的循环以后换成真模型也能用。

## 模型的回复长什么样

`reply = llm.chat(messages)` 返回一个字典，有两种情况：

```python
# ① 直接回答：tool_calls 是 None
{"role": "assistant", "content": "北京今天晴。", "tool_calls": None}

# ② 想调用工具：content 是 None，tool_calls 是一个列表（可能一次调好几个）
{"role": "assistant", "content": None, "tool_calls": [
    {"id": "call_1", "type": "function",
     "function": {"name": "get_weather", "arguments": "{\"city\": \"北京\"}"}}
]}
```

## 基础要求

1. 模型直接回答时，返回它的 `content`
2. 模型想调用工具时：
   - 先把模型的这条回复**原样**加进 `messages`
   - 对每个工具调用，执行 `run_tool(名字, 参数)`，再把结果加进 `messages`，格式是
     `{"role": "tool", "tool_call_id": 这次调用的 id, "content": 结果}`
   - 然后再问一次模型
3. **防止死循环**：最多问模型 `max_steps` 次。次数用完还没得到最终回答，就返回 `STOP_MESSAGE`

## 进阶要求（进阶档）

4. **工具出错时不要让整个 Agent 崩掉**：`run_tool` 可能抛出异常。把错误变成一段文字交回给模型
   （tool 消息的 content 里要包含「出错」两个字和错误信息），让模型自己想办法改正
5. **连续出错就停下**：工具**连续** 3 次出错，说明模型自己改不好了，返回 `ERROR_STOP_MESSAGE`，交给人来处理。
   中间只要有一次成功，就重新计数

## 怎么检查

- 自己跑跑看：`python3 demo.py`，会打印出循环的每一步
- 写完告诉导师「写好了」，导师会运行检查脚本告诉你哪些通过了
