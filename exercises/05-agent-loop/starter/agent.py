# 第 5 课作业：亲手写一个 Agent 循环（题目见 README.md）
import json

STOP_MESSAGE = "抱歉，步骤太多，我先停下来了。"
ERROR_STOP_MESSAGE = "工具连续出错，我先停下来了，请人工看看。"


def run_agent(llm, run_tool, user_input, max_steps=5):
    """运行一次 Agent 循环，返回最终回答。

    llm：大模型，用 llm.chat(messages) 问它，返回一条回复（字典，格式见 README.md）
    run_tool：执行工具的函数，run_tool(工具名, 参数JSON文本) 返回结果文字
    user_input：用户说的话
    max_steps：最多问模型几次
    """
    messages = [{"role": "user", "content": user_input}]

    # TODO：写出 Agent 循环，写完把下面这行删掉
    raise NotImplementedError("run_agent 还没写")
