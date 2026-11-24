# 参考答案（给维护者和自动化评估用，不会发给学生）
import re

DANGEROUS_COMMANDS = ["rm -rf", "sudo", "mkfs"]
SECRET_FILES = [".env", "config.json", "id_rsa"]
TRANSFER_LIMIT = 1000
READ_ONLY_TOOLS = {"read_file", "list_files", "web_search", "get_weather"}
WRITE_TOOLS = {"write_file", "edit_file", "run_command", "send_email"}


def classify_tool_call(name, args):
    command = str(args.get("command", "")) if name == "run_command" else ""
    if any(d in command for d in DANGEROUS_COMMANDS):
        return "deny"
    target = str(args.get("path", "")) if name == "read_file" else command
    if any(s in target for s in SECRET_FILES):
        return "deny"
    if name == "transfer_money":
        return "deny" if args.get("amount", 0) > TRANSFER_LIMIT else "ask"
    if name in READ_ONLY_TOOLS:
        return "allow"
    if name in WRITE_TOOLS:
        return "ask"
    return "deny"


ELEMENTS = [("private_data", "私有数据"), ("untrusted_content", "不可信内容"), ("external_comm", "对外发送")]


def check_trifecta(agent_config):
    tools = agent_config.get("tools", [])
    missing = [label for key, label in ELEMENTS if not any(t.get(key) for t in tools)]
    return {"dangerous": not missing, "missing": missing}


def wrap_untrusted(content, source):
    safe = re.sub(r"<(/?untrusted)", r"&lt;\1", content, flags=re.IGNORECASE)
    return '<untrusted source="{}">\n{}\n</untrusted>'.format(source.replace('"', "&quot;"), safe)


def run_with_approval(tool_calls, approve, execute):
    results = []
    for call in tool_calls:
        level = classify_tool_call(call["name"], call.get("args", {}))
        if level == "deny":
            results.append("已拒绝：{} 风险太高，没有执行".format(call["name"]))
        elif level == "ask" and not approve(call):
            results.append("用户不同意执行 {}，没有执行".format(call["name"]))
        else:
            results.append(execute(call))
    return results
