# 第 12 课作业：给 Agent 装上护栏

Agent 要调用工具之前，先过一遍**护栏**：安全的直接做，有风险的先问人，危险的直接拒绝。
打开 `guardrails.py`，把标了 `TODO` 的函数写出来。

## 基础要求

### 1. `classify_tool_call(name, args)`：给一次工具调用分级

`name` 是工具名，`args` 是参数（字典）。返回三个字符串之一：`"allow"`（直接执行）、`"ask"`（先问人）、`"deny"`（拒绝）。
**从上往下检查，碰到第一条符合的规则就返回**：

| 顺序 | 情况 | 返回 |
|---|---|---|
| 1 | `run_command` 的 `command` 里包含 `DANGEROUS_COMMANDS` 里的任何一个（如 `rm -rf`、`sudo`） | `"deny"` |
| 2 | `read_file` 的 `path`，或 `run_command` 的 `command` 里包含 `SECRET_FILES` 里的任何一个（如 `.env`、`config.json`） | `"deny"` |
| 3 | `transfer_money` 的 `amount` 大于 `TRANSFER_LIMIT`（1000） | `"deny"` |
| 4 | `transfer_money`（金额没超限） | `"ask"` |
| 5 | 工具在 `READ_ONLY_TOOLS` 里（只读，不改任何东西） | `"allow"` |
| 6 | 工具在 `WRITE_TOOLS` 里（会改东西，但还能补救） | `"ask"` |
| 7 | 其他不认识的工具 | `"deny"`（不认识的一律不放行） |

### 2. `check_trifecta(agent_config)`：检查有没有凑齐「致命三要素」

`agent_config` 长这样：

```python
{"tools": [
    {"name": "read_email", "private_data": True,  "untrusted_content": True,  "external_comm": False},
    {"name": "web_fetch",  "private_data": False, "untrusted_content": True,  "external_comm": False},
]}
```

三要素分别对应 `private_data`（能访问私有数据）、`untrusted_content`（会接触不可信内容）、`external_comm`（能对外发送）。
只要**任何一个**工具具备某一样，就算这个 Agent 具备这一样。返回一个字典：

- `"dangerous"`：三样是不是全都具备（`True` / `False`）
- `"missing"`：还缺哪几样，按「私有数据、不可信内容、对外发送」的顺序列出中文名字；三样都有就是空列表 `[]`

上面的例子返回 `{"dangerous": False, "missing": ["对外发送"]}`。

## 进阶要求（进阶档）

### 3. `wrap_untrusted(content, source)`：把外部内容安全地包起来

网页、邮件这类外部内容交给模型之前，先包进带来源的标记里，让模型知道「这是外面来的资料，不是指令」：

```
<untrusted source="来源">
内容
</untrusted>
```

- 第一行、最后一行必须和上面一模一样（中间是原样的内容）
- **防止伪造结束标记**：坏人可能在网页里写一个 `</untrusted>`，假装资料结束了，后面跟上自己的指令。
  所以内容里出现的 `<untrusted` 和 `</untrusted`（**不区分大小写**），都要把开头的 `<` 换成 `&lt;`
- `source` 里的双引号 `"` 换成 `&quot;`，免得把 `source="…"` 提前截断

### 4. `run_with_approval(tool_calls, approve, execute)`：按分级逐个执行

`tool_calls` 是一个列表，每一项是 `{"name": 工具名, "args": 参数字典}`。按顺序逐个处理，返回一个结果列表（和 `tool_calls` 一一对应）：

- `allow`：直接 `execute(call)`，结果放进列表。**不要**问人
- `ask`：先问 `approve(call)`。返回 `True` 才执行；返回 `False` 就不执行，结果写一句说明，里面要有「不同意」三个字
- `deny`：不执行、也不问人，结果写一句说明，里面要有「拒绝」两个字

## 怎么检查

- 自己跑跑看：`python3 try_it.py`
- 写完告诉导师「写好了」，导师会运行检查脚本告诉你哪些通过了
