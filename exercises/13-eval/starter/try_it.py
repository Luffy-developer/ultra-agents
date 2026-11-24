# 自己试一试：用一个假的天气 Agent 跑 3 道测试题
# 运行：python3 try_it.py
from evaluate import grade, run_eval


def fake_agent(question):
    """假的 Agent：问天气会调用工具，问别的就说不知道，问股票会出错"""
    if "股票" in question:
        raise RuntimeError("连不上股票接口")
    if "天气" in question or "下雨" in question:
        return {"reply": "北京明天有小雨，记得带伞", "tools": ["get_weather"]}
    return {"reply": "我不知道", "tools": []}


cases = [
    {"name": "问天气要调用工具", "input": "北京明天下雨吗？", "expect": {"contains": ["北京"], "tools": ["get_weather"]}},
    {"name": "问路不能说不知道", "input": "去天安门怎么走？", "expect": {"not_contains": ["我不知道"]}},
    {"name": "查股票", "input": "茅台股票多少钱？", "expect": {"contains": ["元"]}},
]

report = run_eval(cases, fake_agent, grade)
print("通过 {}/{}，通过率 {:.0%}".format(report["passed"], report["total"], report["rate"]))
for f in report["failures"]:
    print("  ✗ {}：{}".format(f["name"], f["reason"]))
