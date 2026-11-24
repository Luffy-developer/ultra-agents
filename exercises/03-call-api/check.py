# 第 3 课作业的检查脚本（留在导师这边，不发给学生）
# 用法：python3 check.py <学生的作业文件夹>
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from checklib import expect, load, run  # noqa: E402


class Env:
    def __init__(self, fake, chat):
        self.FakeLLM, self.answer = fake.FakeLLM, fake.answer
        self.chat_module = chat


def setup(folder):
    return Env(load(folder, "fake_llm.py"), load(folder, "chat.py"))


def brief(messages):
    return [(m.get("role"), m.get("content")) for m in messages]


SYSTEM = {"role": "system", "content": "你是一个友好的助手"}


def test_reply(e):
    llm = e.FakeLLM([e.answer("你好！")])
    result = e.chat_module.chat(llm, [dict(SYSTEM)], "你好")
    expect(result == "你好！", "chat 应该返回模型回答的文字。期望 '你好！'，实际返回 {!r}".format(result))
    expect(len(llm.calls) == 1, "每调用一次 chat 应该问模型 1 次，实际问了 {} 次".format(len(llm.calls)))


def test_history(e):
    llm = e.FakeLLM([e.answer("你好！")])
    history = [dict(SYSTEM)]
    e.chat_module.chat(llm, history, "你好")
    expect(
        brief(history) == [("system", SYSTEM["content"]), ("user", "你好"), ("assistant", "你好！")],
        "chat 之后，history 里应该依次是：原来的 system、用户的话、模型的回答。实际是：{}".format(brief(history)),
    )
    sent = brief(llm.calls[0])
    expect(sent[:2] == [("system", SYSTEM["content"]), ("user", "你好")], "问模型时要发整个 history（system + 用户的话）。实际发的是：{}".format(sent))


def test_multi_turn(e):
    llm = e.FakeLLM([e.answer("你好，小明！"), e.answer("你叫小明。")])
    history = [dict(SYSTEM)]
    e.chat_module.chat(llm, history, "我叫小明")
    result = e.chat_module.chat(llm, history, "我叫什么？")
    expect(result == "你叫小明。", "第二轮应该返回第二句回答，实际返回 {!r}".format(result))
    expect(len(llm.calls) == 2, "两轮对话应该问模型 2 次，实际 {} 次".format(len(llm.calls)))
    expected = [("system", SYSTEM["content"]), ("user", "我叫小明"), ("assistant", "你好，小明！"), ("user", "我叫什么？")]
    sent = brief(llm.calls[1])
    expect(sent == expected, "第二轮问模型时，要把第一轮的问答一起带上，模型才「记得」。期望发 {}，实际发 {}".format(expected, sent))
    expect(len(history) == 5, "两轮之后 history 应该有 5 条消息（system + 两问两答），实际 {} 条".format(len(history)))


def ask(e, script, keys=("city", "weather"), retries=2):
    llm = e.FakeLLM(script)
    try:
        result = e.chat_module.ask_json(llm, "明天北京天气怎么样？", list(keys), max_retries=retries)
    except RuntimeError as err:
        if "剧本用完" not in str(err):
            raise
        expect(False, "问模型的次数太多了（剧本都用完了）。最多只能问 1 + max_retries 次")
    return llm, result


def test_json_ok(e):
    llm, result = ask(e, [e.answer('{"city": "北京", "weather": "晴"}')])
    expect(result == {"city": "北京", "weather": "晴"}, "模型第一次就回答了正确的 JSON，应该返回解析后的字典，实际返回 {!r}".format(result))
    expect(len(llm.calls) == 1, "第一次就对了，不用再问，实际问了 {} 次".format(len(llm.calls)))
    first = llm.calls[0]
    expect(any(m.get("role") == "user" and "明天北京天气怎么样？" in str(m.get("content")) for m in first), "第一次问模型时，user 消息里要包含问题本身")


def test_json_invalid(e):
    llm, result = ask(e, [e.answer("明天北京晴"), e.answer('{"city": "北京", "weather": "晴"}')])
    expect(len(llm.calls) == 2, "第一次回答不是 JSON，应该再问一次，总共 2 次，实际 {} 次".format(len(llm.calls)))
    second = llm.calls[1]
    expect(any(m.get("role") == "assistant" and m.get("content") == "明天北京晴" for m in second), "重试时要把模型上一次的回答（assistant 消息）也放进对话")
    last = second[-1]
    expect(last.get("role") == "user" and "JSON" in str(last.get("content")), "重试时最后一条应该是说明错误的 user 消息，里面要包含「JSON」。实际是：{}".format(last))
    expect(result == {"city": "北京", "weather": "晴"}, "第二次回答对了，应该返回解析后的字典，实际返回 {!r}".format(result))


def test_json_missing(e):
    llm, result = ask(e, [e.answer('{"city": "北京"}'), e.answer('{"city": "北京", "weather": "晴"}')])
    expect(len(llm.calls) == 2, "第一次回答缺了字段，应该再问一次，总共 2 次，实际 {} 次".format(len(llm.calls)))
    last = llm.calls[1][-1]
    expect(last.get("role") == "user" and "weather" in str(last.get("content")), "缺字段时，说明里要写出缺了哪个字段（weather）。实际是：{}".format(last))
    expect(result == {"city": "北京", "weather": "晴"}, "第二次回答对了，应该返回解析后的字典，实际返回 {!r}".format(result))


def test_json_give_up(e):
    llm, result = ask(e, [e.answer("不知道")] * 5, retries=2)
    expect(len(llm.calls) == 3, "max_retries=2 时最多问 3 次（第一次 + 重试 2 次），实际问了 {} 次".format(len(llm.calls)))
    expect(result is None, "一直不对时应该返回 None，实际返回 {!r}".format(result))


run(
    [
        ("返回模型的回答", "基础", test_reply),
        ("用户的话和模型的回答都记进历史", "基础", test_history),
        ("多轮对话：第二轮带上第一轮的问答", "基础", test_multi_turn),
        ("进阶：第一次就是正确的 JSON", "进阶", test_json_ok),
        ("进阶：不是 JSON 时说明错误并重试", "进阶", test_json_invalid),
        ("进阶：缺字段时说出缺了哪个", "进阶", test_json_missing),
        ("进阶：一直不对就放弃，返回 None", "进阶", test_json_give_up),
    ],
    setup,
)
