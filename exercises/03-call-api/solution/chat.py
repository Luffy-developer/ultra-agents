# 第 3 课作业（给维护者和自动化评估用的参考写法，不会发给学生）
import json


def chat(llm, history, user_input):
    history.append({"role": "user", "content": user_input})
    reply = llm.chat(history)
    history.append({"role": "assistant", "content": reply["content"]})
    return reply["content"]


def ask_json(llm, question, required_keys, max_retries=2):
    keys = "、".join(required_keys)
    messages = [{"role": "user", "content": "{}\n请只输出一个 JSON 对象，包含这些字段：{}".format(question, keys)}]
    for _ in range(1 + max_retries):
        content = llm.chat(messages)["content"]
        try:
            data = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            error = "你的回答不是合法的 JSON，请只输出一个 JSON 对象，包含这些字段：{}".format(keys)
        else:
            missing = [k for k in required_keys if not isinstance(data, dict) or k not in data]
            if not missing:
                return data
            error = "JSON 缺少字段：{}，请补上后重新输出完整的 JSON".format("、".join(missing))
        messages.append({"role": "assistant", "content": content})
        messages.append({"role": "user", "content": error})
    return None
