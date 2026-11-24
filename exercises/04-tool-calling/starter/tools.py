# 第 4 课作业：给 Agent 做一个「查天气」工具（题目见 README.md）
import json

# 假的天气数据（真实项目里，这里会去调用天气网站的 API）
FORECAST = {
    "北京": ["晴，3~12°C", "多云，2~10°C", "小雪，-3~2°C"],
    "上海": ["小雨，10~15°C", "阴，11~16°C", "晴，12~18°C"],
    "广州": ["多云，18~25°C", "晴，19~27°C", "雷阵雨，20~26°C"],
}


def get_weather(city, days=1):
    """查天气。查不到这个城市就返回 None。days 是查几天（这个函数不检查范围，检查要在 run_tool 里做）"""
    if city not in FORECAST:
        return None
    return "\n".join("{}第 {} 天：{}".format(city, i + 1, w) for i, w in enumerate(FORECAST[city][:days]))


# TODO 1：补全工具说明书（格式和 OpenAI 的 tools 参数一样）
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "",  # 写清楚这个工具做什么、什么时候该用
            "parameters": {
                "type": "object",
                "properties": {
                    # 在这里写参数 city
                },
                "required": [],  # 哪些参数是必填的
            },
        },
    }
]


def run_tool(name, arguments):
    """执行模型想调用的工具，返回交回给模型的文字。

    name：工具名，如 "get_weather"
    arguments：模型给的参数，是一段 JSON 文本，如 '{"city": "北京"}'
    出错时不要抛出异常，而是返回一段说明，告诉模型错在哪、该怎么改
    """
    # TODO 2：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("run_tool 还没写")
