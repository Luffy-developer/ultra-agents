# 第 14 课作业的检查脚本（留在导师这边，不发给学生）
# 用法：python3 check.py <学生的作业文件夹>
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from checklib import expect, load, run  # noqa: E402


class Env:
    def __init__(self, fake, loop):
        self.FakeLLM, self.answer, self.call = fake.FakeLLM, fake.answer, fake.call
        self.loop = loop


def setup(folder):
    return Env(load(folder, "fake_llm.py"), load(folder, "human_loop.py"))


class Tools(dict):
    """假的工具箱：记下每次执行了什么"""

    def __init__(self):
        super().__init__()
        self.calls = []
        self["get_order"] = lambda args: self.log("get_order", args, "订单 {}：耳机，50 元".format(args.get("order_id")))
        self["refund"] = lambda args: self.log("refund", args, "已退款 {} 元".format(args.get("amount")))

    def log(self, name, args, result):
        self.calls.append((name, args))
        return result


ASK = ("request_human_input", {"question": "您要退哪个订单？", "urgency": "low", "format": "free_text"})


def tool_messages(messages):
    return [m for m in messages if m.get("role") == "tool"]


def check_waiting(result, what):
    expect(isinstance(result, dict), "{}：应该返回一个字典，实际返回 {!r}".format(what, result))
    expect(result.get("status") == "waiting", "{}：应该停下来返回 status 为 waiting，实际是 {!r}".format(what, result.get("status")))
    expect(isinstance(result.get("state"), dict), "{}：waiting 的结果里要有 state（一个字典）".format(what))


def check_done(result, answer, what):
    expect(isinstance(result, dict), "{}：应该返回一个字典，实际返回 {!r}".format(what, result))
    expect(result.get("status") == "done", "{}：应该跑完返回 status 为 done，实际是 {!r}（{}）".format(what, result.get("status"), result.get("question", "")))
    expect(result.get("answer") == answer, "{}：answer 应该是 {!r}，实际是 {!r}".format(what, answer, result.get("answer")))


def test_direct(e):
    llm = e.FakeLLM([e.call(("get_order", {"order_id": "A1"})), e.answer("您的订单是耳机。")])
    tools = Tools()
    result = e.loop.run(llm, tools, "查一下订单 A1")
    check_done(result, "您的订单是耳机。", "调用普通工具后给出回答")
    expect(tools.calls == [("get_order", {"order_id": "A1"})], "普通工具 get_order 应该执行一次，实际执行了：{}".format(tools.calls))


def test_pause(e):
    llm = e.FakeLLM([e.call(ASK), e.answer("好的。")])
    result = e.loop.run(llm, Tools(), "我要退款")
    check_waiting(result, "模型调用 request_human_input 时")
    expect(result.get("question") == "您要退哪个订单？", "question 应该是模型要问的问题「您要退哪个订单？」，实际是 {!r}".format(result.get("question")))
    expect(len(llm.calls) == 1, "停下来等人时不要接着问模型，应该只问了 1 次，实际问了 {} 次".format(len(llm.calls)))
    try:
        json.dumps(result["state"], ensure_ascii=False)
    except TypeError as err:
        expect(False, "state 要能用 json.dumps 转成文字，才能存进文件或数据库。现在转不了：{}".format(err))


def test_resume(e):
    llm = e.FakeLLM([e.call(ASK), e.call(("get_order", {"order_id": "A1"})), e.answer("A1 是耳机，已为您登记。")])
    tools = Tools()
    waiting = e.loop.run(llm, tools, "我要退款")
    check_waiting(waiting, "模型调用 request_human_input 时")
    result = e.loop.resume(llm, tools, waiting["state"], "订单 A1")
    expect(len(llm.calls) >= 2, "resume 之后应该接着问模型")
    msgs = tool_messages(llm.calls[1])
    expect(msgs and msgs[0].get("tool_call_id") == "call_1", "人的回复要作为那次 request_human_input 调用（id 为 call_1）的结果放回对话，tool_call_id 要对上")
    expect(msgs[0].get("content") == "订单 A1", "tool 消息的 content 应该是人的回复「订单 A1」，实际是 {!r}".format(msgs[0].get("content")))
    expect(any(m.get("role") == "user" and m.get("content") == "我要退款" for m in llm.calls[1]), "resume 后对话里应该还有最开始用户说的话（state 里要存整段对话）")
    check_done(result, "A1 是耳机，已为您登记。", "resume 后接着跑完")
    expect(("get_order", {"order_id": "A1"}) in tools.calls, "resume 后模型调用的 get_order 应该被执行")


def test_max_steps(e):
    llm = e.FakeLLM([e.call(("get_order", {"order_id": "A1"}))] * 10)
    try:
        result = e.loop.run(llm, Tools(), "查订单", max_steps=3)
    except RuntimeError as err:
        if isinstance(err, NotImplementedError):
            raise
        expect(False, "模型一直要调用工具时，你的循环停不下来。要用 max_steps 限制最多问几次")
    expect(len(llm.calls) == 3, "max_steps=3 时最多问模型 3 次，实际问了 {} 次".format(len(llm.calls)))
    check_done(result, e.loop.STOP_MESSAGE, "次数用完时")


def roundtrip(state):
    return json.loads(json.dumps(state, ensure_ascii=False))


def test_roundtrip(e):
    llm = e.FakeLLM([
        e.call(ASK),
        e.call(("request_human_input", {"question": "退款原因是？", "urgency": "low", "format": "multiple_choice"})),
        e.answer("已登记：A1，质量问题。"),
    ])
    tools = Tools()
    first = e.loop.run(llm, tools, "我要退款")
    check_waiting(first, "第一次等人")
    second = e.loop.resume(llm, tools, roundtrip(first["state"]), "订单 A1")
    check_waiting(second, "存档读回来恢复后，模型又问了一个问题")
    expect(second.get("question") == "退款原因是？", "第二次要问的是「退款原因是？」，实际是 {!r}".format(second.get("question")))
    result = e.loop.resume(llm, tools, roundtrip(second["state"]), "质量问题")
    check_done(result, "已登记：A1，质量问题。", "第二次恢复后跑完")
    replies = [m.get("content") for m in tool_messages(llm.calls[-1])]
    expect(replies == ["订单 A1", "质量问题"], "两次人的回复都要按顺序留在对话里，实际是 {}".format(replies))


REFUND = ("refund", {"order_id": "A1", "amount": 50})


def test_approve(e):
    llm = e.FakeLLM([e.call(REFUND), e.answer("已为您退款 50 元。")])
    tools = Tools()
    waiting = e.loop.run(llm, tools, "给 A1 退 50 元")
    check_waiting(waiting, "模型调用高风险工具 refund 时")
    expect(tools.calls == [], "refund 是高风险工具，审批前不能执行，但它已经被执行了")
    question = str(waiting.get("question"))
    expect("refund" in question and "A1" in question and "50" in question, "审批问题里要写出工具名和参数（refund、A1、50），人才知道要批准什么。实际是：{}".format(question))
    result = e.loop.resume(llm, tools, roundtrip(waiting["state"]), "同意")
    expect(tools.calls == [("refund", {"order_id": "A1", "amount": 50})], "人回复「同意」后应该执行 refund，实际执行了：{}".format(tools.calls))
    msgs = tool_messages(llm.calls[-1])
    expect(msgs and msgs[-1].get("content") == "已退款 50 元", "执行结果要交回给模型，实际交回的是 {!r}".format(msgs[-1].get("content") if msgs else None))
    check_done(result, "已为您退款 50 元。", "审批通过后跑完")


def test_reject(e):
    llm = e.FakeLLM([e.call(REFUND), e.answer("经理没有同意，我帮您转人工。")])
    tools = Tools()
    waiting = e.loop.run(llm, tools, "给 A1 退 50 元")
    check_waiting(waiting, "模型调用高风险工具 refund 时")
    result = e.loop.resume(llm, tools, roundtrip(waiting["state"]), "不同意，金额太大")
    expect(tools.calls == [], "人没有同意，refund 不能执行，但它被执行了")
    msgs = tool_messages(llm.calls[-1])
    content = str(msgs[-1].get("content")) if msgs else ""
    expect(msgs and msgs[-1].get("tool_call_id") == "call_1", "被拒绝也要作为这次 refund 调用的结果交回给模型（tool_call_id 为 call_1）")
    expect("拒绝" in content and "金额太大" in content, "交回给模型的结果里要有「拒绝」和人的回复（金额太大），实际是：{}".format(content))
    check_done(result, "经理没有同意，我帮您转人工。", "被拒绝后模型换个做法")


run(
    [
        ("调用普通工具，照常跑完", "基础", test_direct),
        ("问人时马上停下，state 能存成 JSON", "基础", test_pause),
        ("resume：把人的回复放回对话，接着跑完", "基础", test_resume),
        ("防止死循环：最多问 max_steps 次", "基础", test_max_steps),
        ("进阶：存档读回来照样恢复，能连续停两次", "进阶", test_roundtrip),
        ("进阶：高风险工具先审批，同意才执行", "进阶", test_approve),
        ("进阶：人拒绝时把「拒绝」交回给模型", "进阶", test_reject),
    ],
    setup,
)
