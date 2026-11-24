# 第 7 课作业的检查脚本（留在导师这边，不发给学生）
# 用法：python3 check.py <学生的作业文件夹>
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from checklib import expect, load, run  # noqa: E402


def setup(folder):
    return load(folder, "context.py")


def size(messages):
    return len(json.dumps(messages, ensure_ascii=False))


def call(id, city):
    return {"role": "assistant", "content": None, "tool_calls": [{"id": id, "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "%s"}' % city}}]}


def result(id, text):
    return {"role": "tool", "tool_call_id": id, "content": text}


def conversation():
    """0 system, 1 user, 2-3 一组(c1), 4 assistant, 5 user, 6-7 一组(c2), 8 assistant, 9 user"""
    return [
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


def describe(messages):
    return " → ".join(m["role"] + ("(调用 {})".format(m["tool_calls"][0]["id"]) if m.get("tool_calls") else "(结果 {})".format(m["tool_call_id"]) if m["role"] == "tool" else "") for m in messages)


def no_orphan(messages, what):
    """每条 tool 消息前面都要有对应的调用"""
    called = set()
    for m in messages:
        for c in m.get("tool_calls") or []:
            called.add(c["id"])
        if m["role"] == "tool":
            expect(m["tool_call_id"] in called, "{}：留下了工具结果 {}，却删掉了对应的调用，一组被拆开了。留下的消息：{}".format(what, m["tool_call_id"], describe(messages)))


def same_input(m, original, what):
    expect(m == original, "{}：传进来的 messages 被改动了，要返回一个新列表，不能改原来的".format(what))


# ---------- trim_history ----------
def test_trim_under(m):
    msgs = conversation()
    out = m.trim_history(msgs, size(msgs) + 10)
    expect(out == conversation(), "没超过上限时应该原样返回，实际返回：{}".format(describe(out)))


def test_trim_over(m):
    msgs = conversation()
    limit = size(conversation()[:1] + conversation()[5:]) + 5  # 删掉前两组半刚好够
    out = m.trim_history(msgs, limit)
    expect(isinstance(out, list) and out, "trim_history 应该返回一个消息列表，实际返回 {!r}".format(out))
    expect(out[0] == conversation()[0], "第一条 system 消息要永远保留")
    expect(size(out) <= limit, "删完应该不超过 {} 个字符，实际还有 {} 个".format(limit, size(out)))
    expect(out[1:] == conversation()[len(conversation()) - len(out) + 1:], "要从最老的开始删，留下的应该是最近的连续几条。留下的消息：{}".format(describe(out)))
    no_orphan(out, "删掉最老的消息")
    expect(out == [conversation()[0]] + conversation()[5:], "删到刚好不超限就该停，不要多删。期望留下：{}；实际留下：{}".format(describe(conversation()[:1] + conversation()[5:]), describe(out)))


def test_trim_group(m):
    msgs = conversation()
    limit = size(conversation()[:1] + conversation()[3:])  # 只删 c1 的调用、留下它的结果刚好不超限——但那样会拆开一组
    out = m.trim_history(msgs, limit)
    no_orphan(out, "删到一组的中间时")
    expect(out == [conversation()[0]] + conversation()[4:], "删掉 c1 的调用时，它的工具结果要一起删。期望留下：{}；实际留下：{}".format(describe(conversation()[:1] + conversation()[4:]), describe(out)))


def test_trim_keep_last(m):
    out = m.trim_history(conversation(), 10)
    expect(out == [conversation()[0], conversation()[-1]], "就算还是超限，也要留下 system 和最近的一组。期望留下：system → user；实际留下：{}".format(describe(out)))
    msgs = conversation()[:8]  # 最后一组是 c2 的调用 + 结果
    out = m.trim_history(msgs, 10)
    expect(out == [msgs[0]] + msgs[6:8], "最近的一组是「调用 + 工具结果」时，两条都要留下。实际留下：{}".format(describe(out)))


def test_trim_no_mutate(m):
    msgs = conversation()
    m.trim_history(msgs, 600)
    same_input(msgs, conversation(), "trim_history")


# ---------- compact ----------
class Summarize:
    def __init__(self):
        self.calls = []

    def __call__(self, old):
        self.calls.append(copy.deepcopy(old))
        return "用户问过北京天气，是晴天"


def light(m, keep_recent=4):
    msgs = conversation()
    cut = len(msgs) - keep_recent
    return [dict(x, content=m.PLACEHOLDER) if i < cut and x["role"] == "tool" else x for i, x in enumerate(msgs)]


def test_compact_under(m):
    s = Summarize()
    out = m.compact(conversation(), size(conversation()) + 10, s)
    expect(out == conversation(), "没超过上限时应该原样返回")
    expect(not s.calls, "没超过上限时不该调用 summarize")


def test_compact_light(m):
    s = Summarize()
    msgs = conversation()
    expected = light(m)
    limit = size(expected) + 5
    expect(limit < size(msgs), "（检查脚本自己的问题，请告诉导师）")
    out = m.compact(msgs, limit, s)
    expect(not s.calls, "只清掉旧的工具结果就够了，这时不该调用 summarize（压缩要先轻后重）")
    expect(out == expected, "第一步应该只把最近 4 条以外的 tool 消息换成 PLACEHOLDER，其他都不动。期望：{}；实际：{}".format(
        [x.get("content") for x in expected if x["role"] == "tool"], [x.get("content") for x in out if x.get("role") == "tool"]))
    same_input(msgs, conversation(), "compact")


def test_compact_summary(m):
    s = Summarize()
    msgs = conversation()
    out = m.compact(msgs, 300, s)
    expect(len(s.calls) == 1, "清掉旧工具结果还超限时，应该调用一次 summarize，实际调用了 {} 次".format(len(s.calls)))
    old = s.calls[0]
    expect(old and old[0] == conversation()[1] and old[-1] == conversation()[5], "交给 summarize 的应该是 system 之后、最近 4 条之前的旧消息（第 2~6 条），实际交了：{}".format(describe(old)))
    expect(out[0] == conversation()[0], "第一条 system 消息要保留")
    expect(len(out) > 1 and out[1] == {"role": "user", "content": m.SUMMARY_PREFIX + "用户问过北京天气，是晴天"}, "第二条应该是 {{'role': 'user', 'content': SUMMARY_PREFIX + 摘要}}，实际是 {!r}".format(out[1] if len(out) > 1 else None))
    expect(out[2:] == conversation()[6:], "后面应该原样留下最近的 4 条消息。实际留下：{}".format(describe(out[2:])))
    same_input(msgs, conversation(), "compact")


def test_compact_align(m):
    s = Summarize()
    out = m.compact(conversation(), 300, s, keep_recent=3)
    no_orphan(out, "keep_recent=3 时（最近 3 条从工具结果 c2 开始）")
    expect(out[2:] == conversation()[6:], "最近 3 条会从工具结果开始，要往前多留一条，把 c2 的调用也留下。实际留下：{}".format(describe(out[2:])))
    expect(s.calls and s.calls[0][-1] == conversation()[5], "多留下的那条调用就不用交给 summarize 了")


run(
    [
        ("trim_history：没超限就原样返回", "基础", test_trim_under),
        ("trim_history：从最老的开始删", "基础", test_trim_over),
        ("trim_history：调用和工具结果一起删", "基础", test_trim_group),
        ("trim_history：至少留下最近一组", "基础", test_trim_keep_last),
        ("trim_history：不改动传进来的列表", "基础", test_trim_no_mutate),
        ("进阶：compact 没超限就原样返回", "进阶", test_compact_under),
        ("进阶：compact 先清掉旧的工具结果", "进阶", test_compact_light),
        ("进阶：compact 还超限就总结旧对话", "进阶", test_compact_summary),
        ("进阶：compact 不把一组拆开", "进阶", test_compact_align),
    ],
    setup,
)
