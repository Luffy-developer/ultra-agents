# 跑一遍看看：用假模型演一段「查天气」的对话，打印循环的每一步
# 运行：python3 demo.py
import json

from agent import run_agent
from fake_llm import FakeLLM, answer, call


def run_tool(name, arguments):
    print("  [执行工具] {}({})".format(name, arguments))
    city = json.loads(arguments)["city"]
    return {"北京": "晴，3~12°C", "上海": "小雨，10~15°C"}.get(city, "查不到这个城市")


class LoggingLLM(FakeLLM):
    def chat(self, messages, tools=None):
        print("[第 {} 次问模型] 对话里有 {} 条消息".format(len(self.calls) + 1, len(messages)))
        reply = super().chat(messages, tools)
        print("  [模型回复] {}".format(reply["content"] or "想调用工具"))
        return reply


llm = LoggingLLM([
    call(("get_weather", {"city": "北京"}), ("get_weather", {"city": "上海"})),
    answer("北京晴，上海有小雨，去上海记得带伞。"),
])
print("\n最终回答：", run_agent(llm, run_tool, "北京和上海今天天气怎么样？"))
