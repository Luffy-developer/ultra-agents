# 第 3 课作业：让模型"记住"对话，并按 JSON 格式回答（题目见 README.md）
import json


def chat(llm, history, user_input):
    """多轮对话：把用户的话和模型的回答都记进 history，返回模型回答的文字。

    llm：大模型，用 llm.chat(messages) 问它，返回的字典里 reply["content"] 是回答的文字
    history：对话历史（列表），直接在它上面追加，不要新建
    user_input：用户这一轮说的话
    """
    # TODO：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("chat 还没写")


def ask_json(llm, question, required_keys, max_retries=2):
    """（进阶）让模型用 JSON 回答。格式不对就把错误说明发回去让它重来，最多重试 max_retries 次，还不对返回 None。

    question：要问的问题
    required_keys：回答里必须有的字段，如 ["city", "date"]
    """
    # TODO：进阶档写出这个函数，写完把下面这行删掉
    raise NotImplementedError("ask_json 还没写")
