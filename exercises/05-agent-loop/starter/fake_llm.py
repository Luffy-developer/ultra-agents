# 假的大模型：不联网、不花钱，按写好的剧本一句句回复（作业和检查脚本都用它，不用改这个文件）
import copy
import json


class FakeLLM:
    def __init__(self, script):
        """script：剧本，一个列表，每一项是模型的一次回复（用下面的 answer、call 生成）"""
        self.script = list(script)
        self.calls = []  # 每次被调用时收到的 messages，检查脚本靠它看你的循环发了什么

    def chat(self, messages, tools=None):
        """和真的 API 一样：传入整段对话，返回模型的一条回复"""
        self.calls.append(copy.deepcopy(messages))
        if not self.script:
            raise RuntimeError("假模型的剧本用完了：你的循环问模型的次数比预期多")
        return copy.deepcopy(self.script.pop(0))


def answer(text):
    """剧本里的一句：模型直接回答"""
    return {"role": "assistant", "content": text, "tool_calls": None}


def call(*calls):
    """剧本里的一句：模型想调用工具。每个参数是 (工具名, 参数字典)，可以一次调好几个"""
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {"id": "call_{}".format(i + 1), "type": "function", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}
            for i, (name, args) in enumerate(calls)
        ],
    }
