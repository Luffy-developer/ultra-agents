# 跑一遍看看：客服 Agent 先问客户要退哪个订单，再申请退款（进阶档会先等你审批）
# 运行：python3 demo.py   需要回复时，在终端里输入你的回复
import json

from fake_llm import FakeLLM, answer, call
from human_loop import resume, run

tools = {
    "get_order": lambda args: "订单 {}：耳机一副，50 元，已签收".format(args["order_id"]),
    "refund": lambda args: "已退款 {} 元".format(args["amount"]),
}
llm = FakeLLM([
    call(("request_human_input", {"question": "您要退哪个订单？", "urgency": "low", "format": "free_text"})),
    call(("get_order", {"order_id": "A1"})),
    call(("refund", {"order_id": "A1", "amount": 50})),
    answer("已经为您申请退款 50 元。"),
])

result = run(llm, tools, "我要退款")
while result["status"] == "waiting":
    saved = json.dumps(result["state"], ensure_ascii=False)  # 存起来（真实项目里存进数据库），程序可以先退出
    print("[Agent 停下来等人] {}".format(result["question"]))
    reply = input("你的回复：")
    result = resume(llm, tools, json.loads(saved), reply)
print("最终回答：", result["answer"])
