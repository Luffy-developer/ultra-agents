# 第 13 课作业的检查脚本（留在导师这边，不发给学生）
# 用法：python3 check.py <学生的作业文件夹>
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from checklib import expect, load, run  # noqa: E402


def setup(folder):
    return load(folder, "evaluate.py")


def grade_of(m, exp, reply, tools=()):
    out = m.grade({"name": "题", "input": "问", "expect": exp}, {"reply": reply, "tools": list(tools)})
    expect(isinstance(out, tuple) and len(out) == 2, "grade 应该返回 (是否通过, 原因) 两个值，实际返回 {!r}".format(out))
    return out


def test_grade_pass(m):
    ok, reason = grade_of(m, {"contains": ["北京"], "not_contains": ["不知道"], "tools": ["get_weather"]}, "北京明天有小雨", ["get_weather"])
    expect(ok is True, "回答和工具都符合要求，应该判通过，实际判了不通过（原因：{}）".format(reason))
    expect(reason == "", "通过时原因应该是空字符串，实际是 {!r}".format(reason))
    ok, _ = grade_of(m, {}, "随便什么回答")
    expect(ok is True, "expect 里什么要求都没写时，应该判通过")


def test_grade_contains(m):
    ok, reason = grade_of(m, {"contains": ["北京", "带伞"]}, "北京明天有小雨")
    expect(ok is False, "回答里没有「带伞」，应该判不通过")
    expect("带伞" in str(reason), "原因里要写出缺了哪段文字（带伞），实际原因：{!r}".format(reason))


def test_grade_not_contains(m):
    ok, reason = grade_of(m, {"not_contains": ["我不知道"]}, "这个问题我不知道")
    expect(ok is False, "回答里出现了不该有的「我不知道」，应该判不通过")
    expect("我不知道" in str(reason), "原因里要写出是哪段不该出现的文字（我不知道），实际原因：{!r}".format(reason))


def test_grade_tools(m):
    ok, reason = grade_of(m, {"tools": ["get_weather"]}, "北京明天有小雨", [])
    expect(ok is False, "没有调用必须调用的工具 get_weather，应该判不通过")
    expect("get_weather" in str(reason), "原因里要写出缺了哪个工具（get_weather），实际原因：{!r}".format(reason))


def simple_grader(case, result):
    return (result["reply"] == case["expect"]["answer"], "" if result["reply"] == case["expect"]["answer"] else "答案不对")


CASES = [
    {"name": "一", "input": "1", "expect": {"answer": "1"}},
    {"name": "二", "input": "2", "expect": {"answer": "二"}},
    {"name": "三", "input": "3", "expect": {"answer": "3"}},
    {"name": "四", "input": "4", "expect": {"answer": "四"}},
]


def echo_agent(question):
    return {"reply": question, "tools": []}


def test_run_eval(m):
    report = m.run_eval(CASES, echo_agent, simple_grader)
    expect(isinstance(report, dict), "run_eval 应该返回一个字典，实际返回 {!r}".format(report))
    expect(report.get("total") == 4, "4 道题，total 应该是 4，实际是 {!r}".format(report.get("total")))
    expect(report.get("passed") == 2, "4 道题里过了 2 道（一、三），passed 应该是 2，实际是 {!r}".format(report.get("passed")))
    expect(abs(float(report.get("rate", -1)) - 0.5) < 1e-9, "通过率应该是 0.5（2/4），实际是 {!r}".format(report.get("rate")))
    names = [f.get("name") for f in report.get("failures", [])]
    expect(names == ["二", "四"], "failures 应该按顺序列出没通过的题 [二, 四]，实际是 {}".format(names))
    expect(all(f.get("reason") == "答案不对" for f in report["failures"]), "failures 里每道题的 reason 应该是评分器给的原因")


def test_run_eval_empty(m):
    report = m.run_eval([], echo_agent, simple_grader)
    expect(report.get("total") == 0 and report.get("passed") == 0, "没有题时 total 和 passed 都应该是 0")
    expect(report.get("rate") == 0.0, "没有题时 rate 应该是 0.0，实际是 {!r}".format(report.get("rate")))


def test_run_eval_crash(m):
    def crashy(question):
        if question == "2":
            raise RuntimeError("连不上接口")
        return {"reply": question, "tools": []}

    cases = [CASES[0], CASES[1], CASES[2]]
    try:
        report = m.run_eval(cases, crashy, simple_grader)
    except NotImplementedError:
        raise
    except RuntimeError:
        expect(False, "Agent 在第二道题出错时，整个评估停下了。应该把这道题算没通过，接着跑下一道")
    expect(report.get("passed") == 2 and report.get("total") == 3, "第二道题出错算没通过，3 道过 2 道，实际 passed={!r}，total={!r}".format(report.get("passed"), report.get("total")))
    reasons = [f.get("reason", "") for f in report.get("failures", [])]
    expect(len(reasons) == 1 and "出错" in reasons[0] and "连不上接口" in reasons[0], "出错的题，原因里要有「出错」和错误信息（连不上接口），实际是 {}".format(reasons))


RESULTS = {"问天气": [True, True, False], "订机票": [True, True, True], "退款": [False, False, False]}


def close(a, b):
    return isinstance(a, (int, float)) and abs(a - b) < 1e-9


def test_pass_at_k(m):
    value = m.pass_at_k(RESULTS)
    expect(close(value, 2 / 3), "问天气、订机票至少成功过一次，退款一次都没成功，pass@k 应该是 2/3，实际是 {!r}".format(value))
    expect(m.pass_at_k({}) == 0.0, "没有题时 pass_at_k 应该返回 0.0")


def test_pass_pow_k(m):
    value = m.pass_pow_k(RESULTS)
    expect(close(value, 1 / 3), "只有订机票每次都成功，pass^k 应该是 1/3，实际是 {!r}".format(value))
    expect(m.pass_pow_k({}) == 0.0, "没有题时 pass_pow_k 应该返回 0.0")


def test_compare(m):
    before = {"甲": True, "乙": True, "丙": False, "丁": True, "戊": True}
    after = {"甲": True, "乙": False, "丙": True, "丁": False, "己": False}
    value = m.compare(before, after)
    expect(sorted(value) == ["丁", "乙"], "改动前通过、改动后没通过的是乙和丁（戊在改动后没跑，不算），实际返回 {!r}".format(value))
    expect(list(value) == sorted(value), "返回的列表要按名字排序")


run(
    [
        ("评分器：符合要求时判通过", "基础", test_grade_pass),
        ("评分器：缺了必须有的文字", "基础", test_grade_contains),
        ("评分器：出现了不该有的文字", "基础", test_grade_not_contains),
        ("评分器：没调用必须调用的工具", "基础", test_grade_tools),
        ("跑评估：通过数、通过率、失败清单", "基础", test_run_eval),
        ("跑评估：没有题时", "基础", test_run_eval_empty),
        ("跑评估：Agent 出错不能让评估停下", "基础", test_run_eval_crash),
        ("进阶：pass@k", "进阶", test_pass_at_k),
        ("进阶：pass^k", "进阶", test_pass_pow_k),
        ("进阶：找出回归题", "进阶", test_compare),
    ],
    setup,
)
