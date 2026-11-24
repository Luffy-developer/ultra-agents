# 跑一遍看看：用假模型演一段多轮对话，打印每次发给模型的消息条数
# 运行：python3 try_it.py
from chat import ask_json, chat
from fake_llm import FakeLLM, answer


class LoggingLLM(FakeLLM):
    def chat(self, messages, tools=None):
        print("  [发给模型 {} 条消息] 最后一条：{}".format(len(messages), messages[-1]["content"]))
        return super().chat(messages, tools)


print("=== 多轮对话 ===")
llm = LoggingLLM([answer("你好，我是小助手！"), answer("你刚才说你叫小明。")])
history = [{"role": "system", "content": "你是一个友好的助手"}]
try:
    for text in ["你好，我叫小明", "我叫什么名字？"]:
        print("用户：", text)
        print("模型：", chat(llm, history, text))
    print("现在历史里有 {} 条消息".format(len(history)))
except NotImplementedError as e:
    print("（还没写：{}）".format(e))

print("\n=== 进阶：按 JSON 回答 ===")
llm = LoggingLLM([answer("好的，明天北京晴"), answer('{"city": "北京"}'), answer('{"city": "北京", "weather": "晴"}')])
try:
    print("结果：", ask_json(llm, "明天北京天气怎么样？", ["city", "weather"]))
except NotImplementedError as e:
    print("（还没写：{}）".format(e))
