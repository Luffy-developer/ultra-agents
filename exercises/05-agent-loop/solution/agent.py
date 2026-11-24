# 参考答案（给维护者和自动化评估用，不会发给学生）
STOP_MESSAGE = "抱歉，步骤太多，我先停下来了。"
ERROR_STOP_MESSAGE = "工具连续出错，我先停下来了，请人工看看。"
MAX_ERRORS = 3


def run_agent(llm, run_tool, user_input, max_steps=5):
    messages = [{"role": "user", "content": user_input}]
    errors = 0
    for _ in range(max_steps):
        reply = llm.chat(messages)
        if not reply.get("tool_calls"):
            return reply["content"]
        messages.append(reply)
        for tool_call in reply["tool_calls"]:
            fn = tool_call["function"]
            try:
                result = run_tool(fn["name"], fn["arguments"])
                errors = 0
            except Exception as e:
                result = "工具出错：{}".format(e)
                errors += 1
            messages.append({"role": "tool", "tool_call_id": tool_call["id"], "content": result})
        if errors >= MAX_ERRORS:
            return ERROR_STOP_MESSAGE
    return STOP_MESSAGE
