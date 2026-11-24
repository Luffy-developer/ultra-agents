# 参考答案（给维护者和自动化评估用，不会发给学生）
import json

FORECAST = {
    "北京": ["晴，3~12°C", "多云，2~10°C", "小雪，-3~2°C"],
    "上海": ["小雨，10~15°C", "阴，11~16°C", "晴，12~18°C"],
    "广州": ["多云，18~25°C", "晴，19~27°C", "雷阵雨，20~26°C"],
}


def get_weather(city, days=1):
    if city not in FORECAST:
        return None
    return "\n".join("{}第 {} 天：{}".format(city, i + 1, w) for i, w in enumerate(FORECAST[city][:days]))


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询某个城市未来几天的天气预报。用户问到天气、要不要带伞、穿什么衣服时使用",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名，如：北京"},
                    "days": {"type": "integer", "minimum": 1, "maximum": 3, "description": "查未来几天，默认 1"},
                },
                "required": ["city"],
            },
        },
    }
]


def run_tool(name, arguments):
    if name != "get_weather":
        return "没有工具 {}，可用的工具：get_weather".format(name)
    try:
        args = json.loads(arguments)
    except json.JSONDecodeError:
        return '参数不是合法的 JSON，正确的写法如：{"city": "北京"}'
    city = args.get("city")
    if not city:
        return '缺少参数 city，正确的写法如：{"city": "北京"}'
    days = args.get("days", 1)
    if not isinstance(days, int) or not 1 <= days <= 3:
        return "days 只能是 1~3 的整数"
    result = get_weather(city, days)
    if result is None:
        return "查不到 {} 的天气，支持的城市：{}".format(city, "、".join(FORECAST))
    return result
