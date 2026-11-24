# 跑一遍看看：用假模型演一遍三种工作流，打印每次问模型的提示词和回答
# 运行：python3 demo.py
from fake_llm import FakeLLM
from workflow import evaluate_optimize, route, write_and_translate


class LoggingLLM(FakeLLM):
    def ask(self, prompt):
        reply = super().ask(prompt)
        print("  [问模型] {}".format(prompt.replace("\n", " ")[:80]))
        print("  [模型答] {}".format(reply))
        return reply


def show(title, run):
    print("\n== " + title)
    try:
        print("结果：", run())
    except NotImplementedError as e:
        print("（还没写：{}）".format(e))


show("提示链：文案合格", lambda: write_and_translate(LoggingLLM(["暖心保温杯，一杯热水暖一天", "A warm cup keeps you warm all day"]), "保温杯", "暖"))
show("提示链：文案太长", lambda: write_and_translate(LoggingLLM(["这是一款非常非常好用的保温杯，" * 5]), "保温杯", "暖"))
handlers = {"退款": lambda q: "转给退款组", "技术问题": lambda q: "转给技术支持"}
show("路由：认识的类别", lambda: route(LoggingLLM(["退款"]), "我买的杯子漏水，想退货", handlers, lambda q: "转给人工客服"))
show("路由：不认识的类别", lambda: route(LoggingLLM(["闲聊"]), "你吃饭了吗", handlers, lambda q: "转给人工客服"))
show("评估者-优化者", lambda: evaluate_optimize(LoggingLLM(["初稿：保温杯好", "不通过：太短了，写出卖点", "第二版：保温 12 小时的轻便保温杯", "通过"]), "写一句保温杯广告"))
