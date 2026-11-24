# 第 7 课作业：给对话「瘦身」

对话越聊越长，超过上限就要瘦身。打开 `context.py`，把标了 `TODO` 的函数写出来。
这份作业不用大模型，只处理消息列表（格式和 OpenAI 接口一样）。

## 先认识「一组」消息

对话里的消息，有的必须**绑在一起**：

```python
{"role": "assistant", "content": None, "tool_calls": [{"id": "c1", ...}]}   # 模型想调用工具
{"role": "tool", "tool_call_id": "c1", "content": "北京晴"}                  # 工具结果
```

带 `tool_calls` 的 assistant 消息，和紧跟在它后面的 `tool` 消息是**一组**，要留一起留、要删一起删。
只剩下工具结果、找不到对应的调用，接口会报错。其他消息（user、不带 `tool_calls` 的 assistant）各自单独算一组。

`context.py` 里已经给你写好了 `size(messages)`：算出消息列表有多少个字符。

## 基础要求

### `trim_history(messages, max_chars)`：删掉最老的
- `messages[0]` 是 system 消息，**永远保留**
- `size(messages)` 不超过 `max_chars`：原样返回
- 超过了：从**最老的一组**开始，一组一组地删，直到不超过 `max_chars`
- 最近的一组**至少要留下**：就算只剩 system 和最近一组还是超限，也不能再删了
- 返回一个新列表，**不要改动传进来的 `messages`**

## 进阶要求（进阶档）

### `compact(messages, max_chars, summarize, keep_recent=4)`：先轻后重
- 不超过 `max_chars`：原样返回，不调用 `summarize`
- **第一步（最轻）**：除了最近 `keep_recent` 条消息以外，把旧的 `tool` 消息的 `content` 换成 `PLACEHOLDER`（一句占位说明），其他都不动。
  这样已经不超限了，就返回这个结果，**不调用 `summarize`**
- **第二步（还超限）**：把最近的 `keep_recent` 条消息留下（如果这样切会把一组拆开，就往前多留几条，让留下的部分从一组的开头开始），
  中间的旧消息交给 `summarize(旧消息列表)`，它会返回一段摘要文字。返回：
  `[system 消息, {"role": "user", "content": SUMMARY_PREFIX + 摘要}, ...留下的最近消息]`
- 同样**不要改动传进来的 `messages`**

## 怎么检查

- 自己跑跑看：`python3 try_it.py`
- 写完告诉导师「写好了」，导师会运行检查脚本告诉你哪些通过了
