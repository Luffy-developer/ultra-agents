# 第 4 课作业的检查脚本（留在导师这边，不发给学生）
# 用法：python3 check.py <学生的作业文件夹>
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from checklib import expect, load, run  # noqa: E402


def setup(folder):
    return load(folder, "tools.py")


def schema(m):
    expect(isinstance(m.TOOLS, list) and m.TOOLS, "TOOLS 应该是一个列表，里面至少有一个工具")
    fn = m.TOOLS[0].get("function", {})
    expect(fn.get("name") == "get_weather", "第一个工具的 name 应该是 get_weather")
    return fn


def test_description(m):
    fn = schema(m)
    expect(len(fn.get("description", "").strip()) >= 10, "description 太短了：要写清楚这个工具做什么、什么时候该用（至少 10 个字）")


def test_city_param(m):
    params = schema(m).get("parameters", {})
    expect(params.get("type") == "object", 'parameters 的 type 应该是 "object"')
    city = params.get("properties", {}).get("city")
    expect(isinstance(city, dict), "properties 里还没有参数 city")
    expect(city.get("type") == "string", 'city 的 type 应该是 "string"（城市名是文字）')
    expect("city" in params.get("required", []), "city 是必填参数，要写进 required")


def text(result, what):
    expect(isinstance(result, str), "{}：run_tool 应该返回字符串（交回给模型的文字），实际返回了 {!r}".format(what, result))
    return result


def test_normal(m):
    result = text(m.run_tool("get_weather", '{"city": "北京"}'), "查北京天气")
    expect("晴" in result, "查北京天气，返回的文字里应该有北京的天气（晴，3~12°C），实际返回：{}".format(result))


def test_unknown_city(m):
    result = text(m.run_tool("get_weather", '{"city": "火星"}'), "查火星天气")
    expect("北京" in result and "上海" in result, "查不到的城市，返回的说明里要列出支持哪些城市，模型才知道该怎么改。实际返回：{}".format(result))


def test_unknown_tool(m):
    result = text(m.run_tool("get_stock", '{"code": "600000"}'), "调用不存在的工具 get_stock")
    expect("get_weather" in result, "工具名不认识时，返回的说明里要写出有哪些工具可用（get_weather）。实际返回：{}".format(result))


def test_bad_arguments(m):
    result = text(m.run_tool("get_weather", "{city: 北京"), "参数不是合法的 JSON")
    expect("city" in result, "参数不是合法的 JSON 时，说明里要提到正确的参数 city。实际返回：{}".format(result))
    result = text(m.run_tool("get_weather", "{}"), "缺少参数 city")
    expect("city" in result, "缺少 city 时，说明里要提到 city。实际返回：{}".format(result))


def test_days_param(m):
    days = schema(m).get("parameters", {}).get("properties", {}).get("days")
    expect(isinstance(days, dict), "properties 里还没有可选参数 days")
    expect(days.get("type") == "integer", 'days 的 type 应该是 "integer"（整数）')
    expect(days.get("minimum") == 1 and days.get("maximum") == 3, "days 要写上范围：minimum 为 1，maximum 为 3")
    expect("days" not in schema(m)["parameters"].get("required", []), "days 是可选参数，不要放进 required")


def test_days(m):
    result = text(m.run_tool("get_weather", '{"city": "上海", "days": 2}'), "查上海两天的天气")
    expect("小雨" in result and "阴" in result, "days=2 时应该返回两天的天气。实际返回：{}".format(result))
    result = text(m.run_tool("get_weather", '{"city": "上海", "days": 5}'), "days=5 超出范围")
    expect("1~3" in result, "days 超出范围时，说明里要写出允许的范围「1~3」。实际返回：{}".format(result))


run(
    [
        ("说明书：description 写清楚了", "基础", test_description),
        ("说明书：参数 city 写对了", "基础", test_city_param),
        ("正常查天气", "基础", test_normal),
        ("查不到的城市：说明支持哪些城市", "基础", test_unknown_city),
        ("不认识的工具：说明有哪些工具", "基础", test_unknown_tool),
        ("参数写错：提醒正确的参数", "基础", test_bad_arguments),
        ("进阶：说明书里有 days 参数", "进阶", test_days_param),
        ("进阶：按 days 返回多天、超出范围给说明", "进阶", test_days),
    ],
    setup,
)
