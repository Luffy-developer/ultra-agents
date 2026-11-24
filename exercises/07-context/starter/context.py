# 第 7 课作业：给对话「瘦身」（题目见 README.md）
import json

PLACEHOLDER = "（旧的工具结果已清除，需要的话请重新调用工具）"
SUMMARY_PREFIX = "（之前的对话已压缩成下面这份摘要）\n"


def size(messages):
    """消息列表有多少个字符（已经写好了，直接用）"""
    return len(json.dumps(messages, ensure_ascii=False))


def trim_history(messages, max_chars):
    """超过 max_chars 时，保留 system 消息，从最老的一组开始删。返回新列表，不改动 messages"""
    # TODO 1：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("trim_history 还没写")


def compact(messages, max_chars, summarize, keep_recent=4):
    """（进阶）先清掉旧的工具结果；还超限，再把旧对话交给 summarize 压成一条摘要。返回新列表，不改动 messages"""
    # TODO 2：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("compact 还没写")
