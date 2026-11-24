# 参考答案（给维护者和自动化评估用，不会发给学生）


def similarity(query, text):
    pairs = {query[i:i + 2] for i in range(len(query) - 1) if query[i:i + 2].strip()}
    if not pairs:
        return 0.0
    return sum(1 for p in pairs if p in text) / len(pairs)


def chunk(text, size=100, overlap=20):
    if overlap >= size:
        raise ValueError("overlap 必须小于 size")
    chunks = []
    start = 0
    while start < len(text):
        chunks.append(text[start:start + size])
        if start + size >= len(text):
            break
        start += size - overlap
    return chunks


def search(chunks, query, k=3, min_score=0):
    scored = [(similarity(query, c), c) for c in chunks]
    scored = [sc for sc in scored if sc[0] >= min_score]
    scored.sort(key=lambda sc: sc[0], reverse=True)
    return [c for _, c in scored[:k]]


def build_prompt(question, chunks):
    docs = "\n".join("[{}] {}".format(i + 1, c) for i, c in enumerate(chunks))
    return (
        "请只根据下面的资料回答问题，回答时标出引用了哪几条资料的编号，如 [1]。\n"
        "资料里找不到答案时，就回答「资料里没有」，不要自己编。\n\n"
        "资料：\n{}\n\n问题：{}".format(docs, question)
    )
