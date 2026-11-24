# 第 14 课作业：会「暂停等人」的 Agent

真实的 Agent 常常要等人：问客户一个问题、等经理批准退款……一等可能就是几个小时。
程序不能一直开着干等，正确的做法是：**把状态存下来、先退出；人回复了，再读出状态接着跑**。
打开 `human_loop.py`，把 `run` 和 `resume` 写出来。

这份作业用的是**假的大模型**（`fake_llm.py`，和第 5 课作业的一样）：不联网、不花钱，按写好的剧本一句句回复。

## 用到的东西

- **工具** `tools`：一个字典，`{工具名: 函数}`。函数收到参数字典，返回结果文字，如 `tools["get_order"]({"order_id": "A1"})`
  - `human_loop.py` 里已经写好了 `execute(tools, name, arguments)`，直接用它执行工具就行
- **问人的工具** `request_human_input`：不在 `tools` 里，由你的循环特殊处理。模型调用它时的参数如：
  ```json
  {"question": "您要退哪个订单？", "urgency": "low", "format": "free_text"}
  ```
- `run` 和 `resume` 都返回下面两种结果之一：
  ```python
  {"status": "done", "answer": "最终回答"}                       # 跑完了
  {"status": "waiting", "question": "要问人的问题", "state": 状态}  # 停下来等人
  ```
  `state` 是一个字典，里面存什么由你决定（至少要有整段对话 `messages`，和正在等结果的那次调用的 `tool_call_id`）

## 基础要求

1. `run(llm, tools, user_input)`：和第 5 课一样跑 Agent 循环（模型直接回答就返回 `done`；调用普通工具就执行、把结果交回给模型）
2. 模型调用 `request_human_input` 时，**马上停下**，返回 `waiting`：
   - `question` 是模型要问的问题（参数里的 `question`）
   - `state` 必须能用 `json.dumps` 转成文字（这样才能存进文件或数据库）
   - 不要接着问模型，也不要用 `input()` 卡在那里等
3. `resume(llm, tools, state, human_reply)`：把人的回复作为**那次 `request_human_input` 调用的结果**放回对话
   （`{"role": "tool", "tool_call_id": 那次调用的 id, "content": 人的回复}`），然后接着跑，直到结束或又要等人
4. 最多问模型 `max_steps` 次，次数用完返回 `{"status": "done", "answer": STOP_MESSAGE}`

## 进阶要求（进阶档）

5. **模拟程序重启**：把 `state` 用 `json.dumps` 存成文字、再用 `json.loads` 读回来，交给 `resume` 也要能照样接着跑。
   一次任务里可能要停下来好几次（比如先问客户，再等经理审批）
6. **高风险工具要先审批**：`HIGH_RISK` 里的工具（如 `refund` 退款），模型调用时**先不执行**，同样返回 `waiting`：
   - `question` 里要写出工具名和参数，如「是否同意执行 refund({"order_id": "A1", "amount": 50})？」
   - `resume` 时人回复「同意」才真正执行，把执行结果交回给模型
   - 人回复别的（如「不同意，金额太大」），**不执行**，交回给模型的结果里要有「拒绝」两个字和人的回复，让模型自己换个做法

## 怎么检查

- 自己跑跑看：`python3 demo.py`，会演一段客服退款的对话，需要你在终端里扮演人来回复
- 写完告诉导师「写好了」，导师会运行检查脚本告诉你哪些通过了
