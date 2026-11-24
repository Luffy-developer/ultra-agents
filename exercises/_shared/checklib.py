"""检查脚本共用的小工具：导入学生的代码，跑一组测试，最后输出一行 JSON 给导师看。

输出格式（参考 Exercism 的测试运行器）：
{
  "status": "pass" | "fail" | "error",    # error = 代码根本跑不起来（比如语法错误）
  "basic": "pass" | "fail",               # 基础档只要求基础测试通过
  "advanced": "pass" | "fail",            # 进阶档要求进阶测试也通过
  "tests": [{"name", "level", "status", "message"}],
  "output": "学生代码打印的内容（最多 500 字）"
}
要求 Python 3.8 以上，只用标准库。
"""
import contextlib
import importlib.util
import io
import json
import sys
import traceback
from pathlib import Path

MAX_OUTPUT = 500


class CheckFailed(Exception):
    """测试没通过：message 是给学生看的原因"""


def expect(ok, message):
    if not ok:
        raise CheckFailed(message)


def where(error, folder):
    """从报错里找出学生自己代码的哪一行出的错（不甩一大串调用栈给小白看）"""
    frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename.startswith(str(folder))]
    if not frames:
        return ""
    f = frames[-1]
    return "（{} 第 {} 行：{}）".format(Path(f.filename).name, f.lineno, (f.line or "").strip())


def describe(error, folder):
    if isinstance(error, NotImplementedError):
        return "还没写完：{}".format(error or "有函数还是 NotImplementedError")
    return "运行出错：{}: {}{}".format(type(error).__name__, error, where(error, folder))


def load(folder, filename):
    """导入学生写的某个 .py 文件"""
    path = Path(folder) / filename
    if not path.exists():
        raise CheckFailed("找不到 {}，作业文件是不是被删掉或改名了？".format(filename))
    sys.path.insert(0, str(folder))  # 让学生的文件能互相 import（比如 import fake_llm）
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[path.stem] = module
    spec.loader.exec_module(module)
    return module


def run(tests, setup):
    """tests：[(名字, "基础"/"进阶", 测试函数)]；setup(folder) 导入学生代码，返回值会传给每个测试函数"""
    folder = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    real_stdout = sys.stdout
    printed = io.StringIO()
    results = []
    status = "pass"
    with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
        try:
            module = setup(folder)
        except CheckFailed as e:
            module, status = None, "error"
            results.append({"name": "导入代码", "level": "基础", "status": "error", "message": str(e)})
        except SyntaxError as e:
            module, status = None, "error"
            message = "语法错误：{}（{} 第 {} 行：{}）".format(e.msg, Path(e.filename or "").name, e.lineno, (e.text or "").strip())
            results.append({"name": "导入代码", "level": "基础", "status": "error", "message": message})
        except Exception as e:
            module, status = None, "error"
            results.append({"name": "导入代码", "level": "基础", "status": "error", "message": describe(e, folder)})
        if module is not None:
            for name, level, test in tests:
                try:
                    test(module)
                    results.append({"name": name, "level": level, "status": "pass", "message": ""})
                except CheckFailed as e:
                    results.append({"name": name, "level": level, "status": "fail", "message": str(e)})
                except Exception as e:
                    results.append({"name": name, "level": level, "status": "fail", "message": describe(e, folder)})

    def passed(level):
        return all(r["status"] == "pass" for r in results if r["level"] == level)

    if status != "error":
        status = "pass" if all(r["status"] == "pass" for r in results) else "fail"
    output = printed.getvalue()
    if len(output) > MAX_OUTPUT:
        output = output[:MAX_OUTPUT] + "\n…（太长，已截断）"
    report = {
        "status": status,
        "basic": "pass" if status != "error" and passed("基础") else "fail",
        "advanced": "pass" if status != "error" and passed("进阶") else "fail",
        "tests": results,
        "output": output,
    }
    real_stdout.write(json.dumps(report, ensure_ascii=False) + "\n")
