# 第 5 课作业的检查脚本（留在导师这边，不发给学生）
# 用法：python3 check.py <学生的作业文件夹>
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from checklib import expect, load, run  # noqa: E402


class Env:
    def __init__(self, fake, agent):
        self.FakeLLM, self.answer, self.call = fake.FakeLLM, fake.answer, fake.call
        self.agent = agent


def setup(folder):
    return Env(load(folder, "fake_llm.py"), load(folder, "agent.py"))


class Tools:
    """假的工具：记下被调用了什么。fail 是一个列表，依次决定每次调用是否抛出异常"""

    def __init__(self, fail=()):
        self.calls = []
        self.fail = list(fail)

    def __call__(self, name, arguments):
        self.calls.append((name, arguments))
        if self.fail and self.fail.pop(0):
            raise ValueError("城市名不对")
        return "{} 的结果".format(name)


def tool_messages(messages):
    return [m for m in messages if m.get("role") == "tool"]


def test_direct(e):
    llm = e.FakeLLM([e.answer("你好！")])
    result = e.agent.run_agent(llm, Tools(), "你好")
    expect(result == "你好！", "模型直接回答时，应该返回它的 content。期望 '你好！'，实际返回 {!r}".format(result))
    expect(len(llm.calls) == 1, "模型直接回答后就该结束，但你问了模型 {} 次".format(len(llm.calls)))


def test_one_tool(e):
    llm = e.FakeLLM([e.call(("get_weather", {"city": "北京"})), e.answer("北京晴。")])
    tools = Tools()
    result = e.agent.run_agent(llm, tools, "北京天气？")
    expect(tools.calls == [("get_weather", '{"city": "北京"}')], "应该执行一次 run_tool('get_weather', '{{\"city\": \"北京\"}}')，实际执行了：{}".format(tools.calls))
    expect(len(llm.calls) == 2, "执行完工具应该再问一次模型，总共问 2 次，实际问了 {} 次".format(len(llm.calls)))
    second = llm.calls[1]
    expect(any(m.get("role") == "assistant" and m.get("tool_calls") for m in second), "第二次问模型时，对话里应该有模型上一次那条想调用工具的回复（原样加进 messages）")
    tool_msgs = tool_messages(second)
    expect(len(tool_msgs) == 1, "第二次问模型时，对话里应该有 1 条 role 为 tool 的消息，实际有 {} 条".format(len(tool_msgs)))
    expect(tool_msgs[0].get("tool_call_id") == "call_1", "tool 消息的 tool_call_id 要和模型那次调用的 id（call_1）一样，模型才知道这是哪次调用的结果")
    expect(tool_msgs[0].get("content") == "get_weather 的结果", "tool 消息的 content 应该是 run_tool 返回的结果")
    expect(result == "北京晴。", "最后应该返回模型的最终回答 '北京晴。'，实际返回 {!r}".format(result))


def test_parallel(e):
    llm = e.FakeLLM([e.call(("get_weather", {"city": "北京"}), ("get_weather", {"city": "上海"})), e.answer("都查到了。")])
    tools = Tools()
    e.agent.run_agent(llm, tools, "北京和上海天气？")
    expect(len(tools.calls) == 2, "模型一次调用了 2 个工具，两个都要执行，实际执行了 {} 个".format(len(tools.calls)))
    ids = [m.get("tool_call_id") for m in tool_messages(llm.calls[1])]
    expect(ids == ["call_1", "call_2"], "两个工具的结果都要交回给模型，tool_call_id 依次是 call_1、call_2，实际是 {}".format(ids))


def test_max_steps(e):
    llm = e.FakeLLM([e.call(("get_weather", {"city": "北京"}))] * 10)
    try:
        result = e.agent.run_agent(llm, Tools(), "北京天气？", max_steps=3)
    except NotImplementedError:
        raise
    except RuntimeError:
        expect(False, "模型一直要调用工具时，你的循环停不下来（问了模型 {} 次还在问）。要用 max_steps 限制最多问几次".format(len(llm.calls)))
    expect(len(llm.calls) == 3, "max_steps=3 时最多问模型 3 次，实际问了 {} 次".format(len(llm.calls)))
    expect(result == e.agent.STOP_MESSAGE, "次数用完时应该返回 STOP_MESSAGE，实际返回 {!r}".format(result))


def test_tool_error(e):
    llm = e.FakeLLM([e.call(("get_weather", {"city": "背景"})), e.answer("城市名写错了，已改正。")])
    result = e.agent.run_agent(llm, Tools(fail=[True]), "背景天气？")
    tool_msgs = tool_messages(llm.calls[1]) if len(llm.calls) > 1 else []
    expect(tool_msgs, "工具出错后，应该把错误作为 tool 消息交回给模型，再问一次模型")
    content = str(tool_msgs[0].get("content"))
    expect("出错" in content and "城市名不对" in content, "tool 消息里要包含「出错」和错误信息（城市名不对），实际是：{}".format(content))
    expect(result == "城市名写错了，已改正。", "模型看到错误后给出的回答应该正常返回，实际返回 {!r}".format(result))


def test_error_stop(e):
    llm = e.FakeLLM([e.call(("get_weather", {"city": "背景"}))] * 10)
    result = e.agent.run_agent(llm, Tools(fail=[True] * 10), "背景天气？", max_steps=8)
    expect(result == e.agent.ERROR_STOP_MESSAGE, "工具连续 3 次出错应该返回 ERROR_STOP_MESSAGE，实际返回 {!r}".format(result))
    expect(len(llm.calls) == 3, "连续 3 次出错就该停下，只问模型 3 次，实际问了 {} 次".format(len(llm.calls)))


def test_error_reset(e):
    # 出错、成功、出错、出错 —— 没有连续 3 次，不该停
    llm = e.FakeLLM([e.call(("get_weather", {"city": "北京"}))] * 4 + [e.answer("好了。")])
    result = e.agent.run_agent(llm, Tools(fail=[True, False, True, True]), "北京天气？", max_steps=8)
    expect(result == "好了。", "中间有一次成功就要重新计数，这里没有连续 3 次出错，不该停下。实际返回 {!r}".format(result))


run(
    [
        ("模型直接回答", "基础", test_direct),
        ("调用一个工具，把结果交回给模型", "基础", test_one_tool),
        ("一次调用两个工具", "基础", test_parallel),
        ("防止死循环：最多问 max_steps 次", "基础", test_max_steps),
        ("进阶：工具出错时把错误交回给模型", "进阶", test_tool_error),
        ("进阶：连续 3 次出错就停下", "进阶", test_error_stop),
        ("进阶：中间成功一次就重新计数", "进阶", test_error_reset),
    ],
    setup,
)
