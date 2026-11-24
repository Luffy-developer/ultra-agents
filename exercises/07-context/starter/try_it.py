# 自己试一试：造一段带工具调用的长对话，看看瘦身后剩下什么
# 运行：python3 try_it.py
from context import compact, size, trim_history


def call(id, city):
    return {"role": "assistant", "content": None, "tool_calls": [{"id": id, "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "%s"}' % city}}]}


def result(id, text):
    return {"role": "tool", "tool_call_id": id, "content": text}


messages = [
    {"role": "system", "content": "你是天气助手"},
    {"role": "user", "content": "北京天气？"},
    call("c1", "北京"),
    result("c1", "北京晴。" + "（很长的天气详情）" * 50),
    {"role": "assistant", "content": "北京晴。"},
    {"role": "user", "content": "上海呢？"},
    call("c2", "上海"),
    result("c2", "上海小雨。" + "（很长的天气详情）" * 50),
    {"role": "assistant", "content": "上海小雨，记得带伞。"},
    {"role": "user", "content": "谢谢"},
]


def show(title, msgs):
    print("\n== {}（{} 个字符）".format(title, size(msgs)))
    for m in msgs:
        text = m.get("content") or "调用工具 {}".format([c["id"] for c in m.get("tool_calls") or []])
        print("  {:<9} {}".format(m["role"], text.replace("\n", " ")[:40]))


show("原来的对话", messages)
try:
    show("trim_history 到 800 字符", trim_history(messages, 800))
except NotImplementedError as e:
    print("\n（还没写：{}）".format(e))
try:
    show("compact 到 1000 字符", compact(messages, 1000, lambda old: "用户问过北京天气，是晴天"))
    show("compact 到 400 字符", compact(messages, 400, lambda old: "用户问过北京天气，是晴天"))
except NotImplementedError as e:
    print("\n（还没写：{}）".format(e))
