# 第 8 课作业：亲手写一个迷你知识库（题目见 README.md）


def similarity(query, text):
    """相似度：问题里的「两个字的词组」，有多少比例也出现在 text 里（0~1，越大越像）。
    真实项目里这一步用 Embedding 向量来比较，这里为了不花钱用这个简单的办法代替。已经写好了，直接用。
    """
    pairs = {query[i:i + 2] for i in range(len(query) - 1) if query[i:i + 2].strip()}
    if not pairs:
        return 0.0
    return sum(1 for p in pairs if p in text) / len(pairs)


def chunk(text, size=100, overlap=20):
    """把 text 切成每块最多 size 个字的块，相邻两块重叠 overlap 个字，返回块的列表"""
    # TODO 1：写出切块，写完把下面这行删掉
    raise NotImplementedError("chunk 还没写")


def search(chunks, query, k=3):
    """从 chunks 里找出和 query 最相关的 k 块，分数高的排在前面"""
    # TODO 2：写出检索，写完把下面这行删掉
    raise NotImplementedError("search 还没写")


def build_prompt(question, chunks):
    """（进阶）把检索到的块和问题拼成发给模型的 Prompt"""
    # TODO 3（进阶）：写完把下面这行删掉
    raise NotImplementedError("build_prompt 还没写")
