# 第 14 课作业：会「暂停等人」的 Agent（题目见 README.md）
import json

STOP_MESSAGE = "抱歉，步骤太多，我先停下来了。"
ASK_HUMAN = "request_human_input"  # 问人的工具名
HIGH_RISK = {"refund"}  # 高风险工具：执行前要人审批（进阶档）


def execute(tools, name, arguments):
    """执行一个普通工具（已经写好了）。arguments 是模型给的 JSON 文本，返回结果文字"""
    if name not in tools:
        return "没有工具 {}，可用的工具：{}".format(name, "、".join(tools))
    try:
        return tools[name](json.loads(arguments))
    except Exception as e:
        return "工具出错：{}".format(e)


def run(llm, tools, user_input, max_steps=8):
    """开始一个新任务。返回 {"status": "done", "answer": ...} 或 {"status": "waiting", "question": ..., "state": ...}"""
    messages = [{"role": "user", "content": user_input}]
    # TODO 1：写出 Agent 循环，模型调用 request_human_input 时停下来返回 waiting。写完把下面这行删掉
    raise NotImplementedError("run 还没写")


def resume(llm, tools, state, human_reply, max_steps=8):
    """人回复了：把回复放回对话，接着跑。返回值和 run 一样"""
    # TODO 2：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("resume 还没写")
