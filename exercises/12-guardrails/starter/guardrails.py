# 第 12 课作业：给 Agent 装上护栏（题目见 README.md）

DANGEROUS_COMMANDS = ["rm -rf", "sudo", "mkfs"]
SECRET_FILES = [".env", "config.json", "id_rsa"]
TRANSFER_LIMIT = 1000
READ_ONLY_TOOLS = {"read_file", "list_files", "web_search", "get_weather"}
WRITE_TOOLS = {"write_file", "edit_file", "run_command", "send_email"}


def classify_tool_call(name, args):
    """给一次工具调用分级，返回 "allow" / "ask" / "deny"（规则表见 README.md，从上往下查）"""
    # TODO 1：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("classify_tool_call 还没写")


def check_trifecta(agent_config):
    """检查 Agent 有没有凑齐致命三要素，返回 {"dangerous": ..., "missing": [...]}"""
    # TODO 2：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("check_trifecta 还没写")


def wrap_untrusted(content, source):
    """（进阶）把外部内容包进 <untrusted source="..."> ... </untrusted>，并防止伪造结束标记"""
    # TODO 3：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("wrap_untrusted 还没写")


def run_with_approval(tool_calls, approve, execute):
    """（进阶）按分级逐个处理工具调用，返回结果列表

    approve(call)：问人同不同意，返回 True / False
    execute(call)：真正执行工具，返回结果
    """
    # TODO 4：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("run_with_approval 还没写")
