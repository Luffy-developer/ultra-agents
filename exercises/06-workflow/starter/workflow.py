# 第 6 课作业：亲手写两种工作流（题目见 README.md）


def write_and_translate(llm, product, keyword, max_len=50):
    """提示链 + 检查关卡：先写中文文案，检查合格了再翻译成英文。

    合格返回 {"ok": True, "copy": 中文文案, "english": 英文}
    不合格返回 {"ok": False, "copy": 中文文案, "reason": 原因}
    """
    # TODO 1：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("write_and_translate 还没写")


def route(llm, question, handlers, default):
    """路由：先让模型分类，再调用对应的处理函数；类别不认识就调用 default。返回处理函数的结果"""
    # TODO 2：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("route 还没写")


def evaluate_optimize(llm, task, max_rounds=3):
    """（进阶）评估者-优化者：写 → 评 → 按意见改。返回 {"result": 最后一版, "rounds": 一共写了几版}"""
    # TODO 3：写出这个函数，写完把下面这行删掉
    raise NotImplementedError("evaluate_optimize 还没写")
