# 第 6 课作业的检查脚本（留在导师这边，不发给学生）
# 用法：python3 check.py <学生的作业文件夹>
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from checklib import expect, load, run  # noqa: E402


class Env:
    def __init__(self, fake, workflow):
        self.FakeLLM = fake.FakeLLM
        self.w = workflow


def setup(folder):
    return Env(load(folder, "fake_llm.py"), load(folder, "workflow.py"))


def ask_count(llm, expected, what):
    expect(len(llm.prompts) == expected, "{}：应该问模型 {} 次，实际问了 {} 次".format(what, expected, len(llm.prompts)))


# ---------- 提示链 ----------
def test_chain_pass(e):
    llm = e.FakeLLM(["暖心保温杯，一杯热水暖一天", "A warm cup keeps you warm all day"])
    result = e.w.write_and_translate(llm, "保温杯", "暖")
    expect(isinstance(result, dict), "write_and_translate 应该返回一个字典，实际返回 {!r}".format(result))
    ask_count(llm, 2, "文案合格时（先写文案、再翻译）")
    expect("保温杯" in llm.prompts[0] and "暖" in llm.prompts[0], "第一次问模型（写文案）的提示词里要带上商品名「保温杯」和关键词「暖」。实际提示词：{}".format(llm.prompts[0]))
    expect("暖心保温杯，一杯热水暖一天" in llm.prompts[1], "第二次问模型（翻译）的提示词里要带上写好的文案。实际提示词：{}".format(llm.prompts[1]))
    expect(result.get("ok") is True, "文案合格时 ok 应该是 True，实际是 {!r}".format(result.get("ok")))
    expect(result.get("copy") == "暖心保温杯，一杯热水暖一天", "copy 应该是模型写的文案，实际是 {!r}".format(result.get("copy")))
    expect(result.get("english") == "A warm cup keeps you warm all day", "english 应该是模型翻译的结果，实际是 {!r}".format(result.get("english")))


def test_chain_strip(e):
    llm = e.FakeLLM(["  暖心保温杯\n", "Warm cup"])
    result = e.w.write_and_translate(llm, "保温杯", "暖", max_len=5)
    expect(result.get("ok") is True, "文案前后的空格、换行不算字数（「暖心保温杯」正好 5 个字，应该合格），实际返回 {!r}".format(result))


def test_chain_too_long(e):
    long_copy = "这是一款非常非常好用的保温杯，冬天喝热水暖暖的" * 3
    llm = e.FakeLLM([long_copy])
    result = e.w.write_and_translate(llm, "保温杯", "暖", max_len=20)
    ask_count(llm, 1, "文案太长时（检查关卡不通过，不该再去翻译）")
    expect(result.get("ok") is False, "文案太长时 ok 应该是 False，实际返回 {!r}".format(result))
    expect("太长" in str(result.get("reason", "")), "文案太长时，reason 里要有「太长」两个字，实际是 {!r}".format(result.get("reason")))


def test_chain_no_keyword(e):
    llm = e.FakeLLM(["轻便保温杯，随身带"])
    result = e.w.write_and_translate(llm, "保温杯", "暖")
    ask_count(llm, 1, "文案缺关键词时（检查关卡不通过，不该再去翻译）")
    expect(result.get("ok") is False, "文案缺关键词时 ok 应该是 False，实际返回 {!r}".format(result))
    expect("暖" in str(result.get("reason", "")), "缺关键词时，reason 里要写出缺的关键词「暖」，实际是 {!r}".format(result.get("reason")))


# ---------- 路由 ----------
class Handler:
    def __init__(self, name):
        self.name, self.calls = name, []

    def __call__(self, question):
        self.calls.append(question)
        return "{} 处理了".format(self.name)


def make_handlers():
    return {"退款": Handler("退款组"), "技术问题": Handler("技术支持")}, Handler("人工客服")


def test_route_known(e):
    handlers, default = make_handlers()
    llm = e.FakeLLM(["退款"])
    result = e.w.route(llm, "杯子漏水，我想退货", handlers, default)
    ask_count(llm, 1, "路由（只用问一次模型来分类）")
    prompt = llm.prompts[0]
    expect("杯子漏水，我想退货" in prompt, "分类的提示词里要带上用户的问题。实际提示词：{}".format(prompt))
    expect("退款" in prompt and "技术问题" in prompt, "分类的提示词里要列出所有类别名（退款、技术问题），模型才知道能选哪些。实际提示词：{}".format(prompt))
    expect(handlers["退款"].calls == ["杯子漏水，我想退货"], "模型回答「退款」，应该调用退款的处理函数，并把问题传给它")
    expect(not handlers["技术问题"].calls and not default.calls, "只该调用退款的处理函数，别的不该调用")
    expect(result == "退款组 处理了", "应该返回处理函数的结果，实际返回 {!r}".format(result))


def test_route_strip(e):
    handlers, default = make_handlers()
    result = e.w.route(e.FakeLLM([" 技术问题\n"]), "打不开 App", handlers, default)
    expect(result == "技术支持 处理了", "模型回答「 技术问题\\n」（带空格和换行），去掉首尾空白后应该走技术问题，实际返回 {!r}".format(result))


def test_route_default(e):
    handlers, default = make_handlers()
    result = e.w.route(e.FakeLLM(["闲聊"]), "你吃饭了吗", handlers, default)
    expect(default.calls == ["你吃饭了吗"], "模型回答了不认识的类别「闲聊」，应该调用 default，并把问题传给它")
    expect(result == "人工客服 处理了", "走默认分支时应该返回 default 的结果，实际返回 {!r}".format(result))


# ---------- 评估者-优化者 ----------
def run_eo(e, script, max_rounds=3):
    llm = e.FakeLLM(script)
    try:
        result = e.w.evaluate_optimize(llm, "写一句保温杯广告", max_rounds=max_rounds)
    except NotImplementedError:
        raise  # 它也是一种 RuntimeError，要先放过去，报「还没写完」
    except RuntimeError:
        expect(False, "问模型的次数太多了（问了 {} 次还在问）：通过了、或写满 max_rounds 版后就该停下".format(len(llm.prompts)))
    expect(isinstance(result, dict), "evaluate_optimize 应该返回一个字典，实际返回 {!r}".format(result))
    return llm, result


def test_eo_first_pass(e):
    llm, result = run_eo(e, ["初稿：保温 12 小时", "通过"])
    ask_count(llm, 2, "第一版就通过时（写一次、评一次）")
    expect("写一句保温杯广告" in llm.prompts[0], "写初稿的提示词里要带上任务。实际提示词：{}".format(llm.prompts[0]))
    expect("初稿：保温 12 小时" in llm.prompts[1], "评价的提示词里要带上这一版的内容。实际提示词：{}".format(llm.prompts[1]))
    expect(result.get("result") == "初稿：保温 12 小时" and result.get("rounds") == 1, "应该返回 {{'result': '初稿：保温 12 小时', 'rounds': 1}}，实际返回 {!r}".format(result))


def test_eo_revise(e):
    llm, result = run_eo(e, ["初稿：保温杯好", "不通过：太短了，写出卖点", "第二版：保温 12 小时", "通过"])
    ask_count(llm, 4, "改一次就通过时（写、评、改、评）")
    expect("初稿：保温杯好" in llm.prompts[2] and "太短了，写出卖点" in llm.prompts[2], "修改的提示词里要带上上一版和修改意见。实际提示词：{}".format(llm.prompts[2]))
    expect(result.get("result") == "第二版：保温 12 小时" and result.get("rounds") == 2, "应该返回第二版、rounds 为 2，实际返回 {!r}".format(result))


def test_eo_max_rounds(e):
    llm, result = run_eo(e, ["v1", "不通过：a", "v2", "不通过：b", "v3", "不通过：c"], max_rounds=2)
    ask_count(llm, 4, "max_rounds=2、一直不通过时（写 v1、评、改出 v2、评，然后停下）")
    expect(result.get("result") == "v2" and result.get("rounds") == 2, "写满 2 版还不通过，应该返回最后一版 v2、rounds 为 2，实际返回 {!r}".format(result))


run(
    [
        ("提示链：文案合格就去翻译", "基础", test_chain_pass),
        ("提示链：文案首尾的空白不算字数", "基础", test_chain_strip),
        ("提示链：文案太长就停下", "基础", test_chain_too_long),
        ("提示链：缺关键词就停下", "基础", test_chain_no_keyword),
        ("路由：按类别调用处理函数", "基础", test_route_known),
        ("路由：去掉模型回答首尾的空白", "基础", test_route_strip),
        ("路由：不认识的类别走默认分支", "基础", test_route_default),
        ("进阶：第一版就通过", "进阶", test_eo_first_pass),
        ("进阶：按意见改一版", "进阶", test_eo_revise),
        ("进阶：写满最大版数就停", "进阶", test_eo_max_rounds),
    ],
    setup,
)
