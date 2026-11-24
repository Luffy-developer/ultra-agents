# 参考答案（给维护者和自动化评估用，不会发给学生）
import json

PLACEHOLDER = "（旧的工具结果已清除，需要的话请重新调用工具）"
SUMMARY_PREFIX = "（之前的对话已压缩成下面这份摘要）\n"


def size(messages):
    return len(json.dumps(messages, ensure_ascii=False))


def groups(messages):
    """把消息切成一组一组：带 tool_calls 的 assistant 和后面紧跟的 tool 消息算一组"""
    result = []
    for m in messages:
        if m["role"] == "tool" and result:
            result[-1].append(m)
        else:
            result.append([m])
    return result


def trim_history(messages, max_chars):
    system, rest = messages[0], groups(messages[1:])
    while len(rest) > 1 and size([system] + [m for g in rest for m in g]) > max_chars:
        rest.pop(0)
    return [system] + [m for g in rest for m in g]


def compact(messages, max_chars, summarize, keep_recent=4):
    if size(messages) <= max_chars:
        return list(messages)
    cut = max(1, len(messages) - keep_recent)
    light = [dict(m, content=PLACEHOLDER) if i < cut and m["role"] == "tool" else m for i, m in enumerate(messages)]
    if size(light) <= max_chars:
        return light
    while cut > 1 and messages[cut]["role"] == "tool":
        cut -= 1
    if cut <= 1:
        return light
    summary = summarize(messages[1:cut])
    return [messages[0], {"role": "user", "content": SUMMARY_PREFIX + summary}] + messages[cut:]
