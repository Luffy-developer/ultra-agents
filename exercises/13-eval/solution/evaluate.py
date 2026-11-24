# 参考答案（给维护者和自动化评估用，不会发给学生）


def grade(case, result):
    expect = case.get("expect", {})
    reply = result.get("reply", "")
    tools = result.get("tools", [])
    for text in expect.get("contains", []):
        if text not in reply:
            return False, "回答里没有「{}」".format(text)
    for text in expect.get("not_contains", []):
        if text in reply:
            return False, "回答里不该出现「{}」".format(text)
    for tool in expect.get("tools", []):
        if tool not in tools:
            return False, "没有调用工具 {}".format(tool)
    return True, ""


def run_eval(cases, agent, grader):
    failures = []
    for case in cases:
        try:
            ok, reason = grader(case, agent(case["input"]))
        except Exception as e:
            ok, reason = False, "Agent 运行出错：{}".format(e)
        if not ok:
            failures.append({"name": case["name"], "reason": reason})
    total = len(cases)
    passed = total - len(failures)
    return {"passed": passed, "total": total, "rate": passed / total if total else 0.0, "failures": failures}


def pass_at_k(results):
    if not results:
        return 0.0
    return sum(1 for trials in results.values() if any(trials)) / len(results)


def pass_pow_k(results):
    if not results:
        return 0.0
    return sum(1 for trials in results.values() if trials and all(trials)) / len(results)


def compare(before, after):
    return sorted(name for name in before if name in after and before[name] and not after[name])
