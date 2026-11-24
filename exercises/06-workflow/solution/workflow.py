# 参考答案（给维护者和自动化评估用，不会发给学生）


def write_and_translate(llm, product, keyword, max_len=50):
    copy = llm.ask("给「{}」写一句中文广告文案，不超过 {} 个字，必须包含「{}」。只输出文案。".format(product, max_len, keyword)).strip()
    if len(copy) > max_len:
        return {"ok": False, "copy": copy, "reason": "文案太长：{} 个字，上限 {} 个字".format(len(copy), max_len)}
    if keyword not in copy:
        return {"ok": False, "copy": copy, "reason": "文案里缺少关键词「{}」".format(keyword)}
    english = llm.ask("把下面这句广告文案翻译成英文，只输出译文：\n{}".format(copy))
    return {"ok": True, "copy": copy, "english": english}


def route(llm, question, handlers, default):
    names = "、".join(handlers)
    category = llm.ask("判断下面的问题属于哪一类，只回答类别名（{}）：\n{}".format(names, question)).strip()
    handler = handlers.get(category, default)
    return handler(question)


def evaluate_optimize(llm, task, max_rounds=3):
    draft = llm.ask("任务：{}\n请写出第一版。".format(task))
    rounds = 1
    while True:
        verdict = llm.ask("请评价下面这一版是否完成了任务「{}」。合格就只回答「通过」，否则写出修改意见：\n{}".format(task, draft))
        if verdict.strip().startswith("通过") or rounds >= max_rounds:
            return {"result": draft, "rounds": rounds}
        draft = llm.ask("任务：{}\n上一版：\n{}\n修改意见：\n{}\n请按意见改出新的一版。".format(task, draft, verdict))
        rounds += 1
