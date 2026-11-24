# 参考答案（给维护者和自动化评估用，不会发给学生）
import json

STOP_MESSAGE = "抱歉，步骤太多，我先停下来了。"
ASK_HUMAN = "request_human_input"
HIGH_RISK = {"refund"}


def execute(tools, name, arguments):
    if name not in tools:
        return "没有工具 {}，可用的工具：{}".format(name, "、".join(tools))
    try:
        return tools[name](json.loads(arguments))
    except Exception as e:
        return "工具出错：{}".format(e)


def run(llm, tools, user_input, max_steps=8):
    messages = [{"role": "user", "content": user_input}]
    return _loop(llm, tools, messages, [], max_steps)


def resume(llm, tools, state, human_reply, max_steps=8):
    messages = state["messages"]
    fn = state["pending"]["function"]
    if fn["name"] == ASK_HUMAN:
        content = human_reply
    elif human_reply.strip() == "同意":
        content = execute(tools, fn["name"], fn["arguments"])
    else:
        content = "人拒绝了这次操作（{}），回复是：{}".format(fn["name"], human_reply)
    messages.append({"role": "tool", "tool_call_id": state["tool_call_id"], "content": content})
    return _loop(llm, tools, messages, state["rest"], max_steps)


def _pause(messages, tool_call, rest, question):
    state = {"messages": messages, "tool_call_id": tool_call["id"], "pending": tool_call, "rest": rest}
    return {"status": "waiting", "question": question, "state": state}


def _run_calls(tools, messages, calls):
    """依次执行这一轮的工具调用；遇到要等人的就停下，返回 waiting"""
    for i, tool_call in enumerate(calls):
        fn = tool_call["function"]
        if fn["name"] == ASK_HUMAN:
            return _pause(messages, tool_call, calls[i + 1:], json.loads(fn["arguments"]).get("question", ""))
        if fn["name"] in HIGH_RISK:
            return _pause(messages, tool_call, calls[i + 1:], "是否同意执行 {}({})？".format(fn["name"], fn["arguments"]))
        messages.append({"role": "tool", "tool_call_id": tool_call["id"], "content": execute(tools, fn["name"], fn["arguments"])})
    return None


def _loop(llm, tools, messages, rest, max_steps):
    waiting = _run_calls(tools, messages, rest)
    if waiting:
        return waiting
    for _ in range(max_steps):
        reply = llm.chat(messages)
        if not reply.get("tool_calls"):
            return {"status": "done", "answer": reply["content"]}
        messages.append(reply)
        waiting = _run_calls(tools, messages, reply["tool_calls"])
        if waiting:
            return waiting
    return {"status": "done", "answer": STOP_MESSAGE}
