# 第 13 课作业：写一个迷你评估程序（题目见 README.md）


def grade(case, result):
    """代码评分器：按 case["expect"] 检查运行记录 result，返回 (是否通过, 原因)"""
    expect = case.get("expect", {})
    reply = result.get("reply", "")
    tools = result.get("tools", [])
    # TODO 1：检查 contains、not_contains、tools，写完把下面这行删掉
    raise NotImplementedError("grade 还没写")


def run_eval(cases, agent, grader):
    """跑一组测试题，返回 {"passed", "total", "rate", "failures"}"""
    # TODO 2：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("run_eval 还没写")


# ---------- 进阶档 ----------


def pass_at_k(results):
    """至少成功一次的题，占所有题的比例"""
    raise NotImplementedError("pass_at_k 还没写")


def pass_pow_k(results):
    """每次都成功的题，占所有题的比例"""
    raise NotImplementedError("pass_pow_k 还没写")


def compare(before, after):
    """找出改动前通过、改动后没通过的题，返回按名字排序的列表"""
    raise NotImplementedError("compare 还没写")
