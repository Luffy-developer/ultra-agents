# 自己试一试：假装自己是模型，调用你写的工具，看看返回什么
# 运行：python3 try_it.py
from tools import TOOLS, run_tool

print("说明书：", TOOLS[0]["function"]["description"] or "（还没写）")
for name, arguments in [
    ("get_weather", '{"city": "北京"}'),
    ("get_weather", '{"city": "火星"}'),
    ("get_stock", '{"code": "600000"}'),
    ("get_weather", "{city: 北京"),
    ("get_weather", '{"city": "上海", "days": 2}'),
]:
    print("\n模型调用 {}({})".format(name, arguments))
    try:
        print("返回给模型：", run_tool(name, arguments))
    except Exception as e:
        print("程序崩了：", type(e).__name__, e)
