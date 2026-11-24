# 第 8 课作业的检查脚本（留在导师这边，不发给学生）
# 用法：python3 check.py <学生的作业文件夹>
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from checklib import expect, load, run  # noqa: E402

TEXT = "".join("第{:02d}句话。".format(i) for i in range(40))  # 240 个字，每个字都不一样，方便检查切得对不对

# 检索用的资料：员工手册的几段（和学生的 knowledge.md 内容一样）
SECTIONS = [
    "年假：入职满一年的员工每年有 5 天带薪年假，满五年的有 10 天。当年没休完的年假可以顺延到次年 3 月 31 日，过期作废。",
    "病假：员工生病可以请病假，每年前 10 天病假工资照发。请病假超过 2 天需要提供医院开具的病假证明。",
    "报销：出差的交通费、住宿费可以报销。住宿标准：一线城市每晚不超过 500 元，其他城市每晚不超过 350 元。",
    "加班：工作日加班可以换调休，一小时加班换一小时调休。周末加班按两倍工资计算，或者换两倍时长的调休。",
    "办公用品：笔、本子、电池等办公用品到前台领取，每月每人限领一次。笔记本电脑坏了找 IT 部报修。",
]


def setup(folder):
    return load(folder, "rag.py")


def show(chunks):
    return "、".join("「{}」".format(c[:12] + ("…" if len(c) > 12 else "")) for c in chunks)


def test_chunk_size(m):
    chunks = m.chunk(TEXT, size=50, overlap=10)
    expect(isinstance(chunks, list) and chunks, "chunk 应该返回一个列表（里面是一块块文字），实际返回了 {!r}".format(chunks))
    expect(all(isinstance(c, str) for c in chunks), "列表里的每一块都应该是字符串")
    too_long = [len(c) for c in chunks if len(c) > 50]
    expect(not too_long, "size=50 时每块最多 50 个字，但有的块有 {} 个字".format(too_long[0] if too_long else ""))


def test_chunk_overlap(m):
    chunks = m.chunk(TEXT, size=50, overlap=10)
    expect(len(chunks) >= 2, "240 个字按 size=50 切，应该切成好几块，实际只有 {} 块".format(len(chunks)))
    for i in range(len(chunks) - 1):
        expect(
            chunks[i + 1].startswith(chunks[i][-10:]),
            "第 {} 块的开头应该是第 {} 块的最后 10 个字（overlap=10）。第 {} 块结尾是「{}」，第 {} 块开头是「{}」".format(
                i + 2, i + 1, i + 1, chunks[i][-10:], i + 2, chunks[i + 1][:10]
            ),
        )


def test_chunk_complete(m):
    chunks = m.chunk(TEXT, size=50, overlap=10)
    rebuilt = chunks[0] + "".join(c[10:] for c in chunks[1:])
    expect(rebuilt == TEXT, "把所有块去掉重叠部分拼回去，应该正好是原文（一个字不多、一个字不少）。可能切漏了结尾，或者开头没从第一个字切起")
    expect(all(len(c) > 10 for c in chunks), "最后多出了一块只有重叠部分的块：切到文字结尾就该停")


def test_chunk_edges(m):
    expect(m.chunk("很短的一句话", size=50, overlap=10) == ["很短的一句话"], "文字不超过 size 个字时，整段就是一块：应该返回 ['很短的一句话']，实际返回 {!r}".format(m.chunk("很短的一句话", size=50, overlap=10)))
    expect(m.chunk("", size=50, overlap=10) == [], "空文字应该返回空列表 []，实际返回 {!r}".format(m.chunk("", size=50, overlap=10)))
    try:
        m.chunk(TEXT, size=10, overlap=10)
    except ValueError:
        return
    expect(False, "overlap 大于等于 size 时没法往前切，应该抛出 ValueError")


def test_search_top(m):
    result = m.search(SECTIONS, "年假没休完可以留到明年吗", k=2)
    expect(isinstance(result, list), "search 应该返回一个列表，实际返回了 {!r}".format(result))
    expect(len(result) == 2, "k=2 应该返回 2 块，实际返回了 {} 块".format(len(result)))
    expect(all(isinstance(c, str) for c in result), "返回的列表里应该是块的文字（字符串），不是分数或编号")
    expect(result[0] == SECTIONS[0], "问「年假没休完可以留到明年吗」，排第一的应该是讲年假的那块，实际排第一的是 {}".format(show(result[:1])))


def test_search_order(m):
    query = "出差住酒店每晚最多能报多少钱？病假"
    result = m.search(SECTIONS, query, k=5)
    scores = [m.similarity(query, c) for c in result]
    expect(len(result) == 5, "k=5 应该返回 5 块，实际返回了 {} 块".format(len(result)))
    expect(scores == sorted(scores, reverse=True), "要按分数从高到低排，实际的分数顺序是 {}".format([round(s, 2) for s in scores]))
    result = m.search(SECTIONS[:2], query, k=5)
    expect(len(result) == 2, "只有 2 块资料、k=5 时，有几块返回几块（2 块），实际返回了 {} 块".format(len(result)))


def test_min_score(m):
    try:
        result = m.search(SECTIONS, "年假没休完可以留到明年吗", k=3, min_score=0.2)
    except TypeError:
        expect(False, "search 还不支持参数 min_score：要给它加一个参数 min_score（默认 0）")
    expect(result == [SECTIONS[0]], "min_score=0.2 时，只有讲年假的那块分数够（0.36），其余都不到 0.2，应该只返回那一块。实际返回：{}".format(show(result)))
    result = m.search(SECTIONS, "火星基地的氧气够用多久", k=3, min_score=0.1)
    expect(result == [], "问「火星基地的氧气够用多久」，所有块分数都是 0，低于门槛，应该返回空列表 []。实际返回：{}".format(show(result)))
    result = m.search(SECTIONS, "火星基地的氧气够用多久", k=3)
    expect(len(result) == 3, "不填 min_score 时（默认 0），应该照常返回 k 块，实际返回了 {} 块".format(len(result)))


def test_prompt(m):
    chunks = SECTIONS[2:4]
    question = "出差住酒店每晚最多能报多少钱？"
    prompt = m.build_prompt(question, chunks)
    expect(isinstance(prompt, str), "build_prompt 应该返回字符串，实际返回了 {!r}".format(prompt))
    expect("[1]" in prompt and "[2]" in prompt, "每块资料前面要标上编号 [1]、[2]")
    i1, i2 = prompt.find("[1]"), prompt.find("[2]")
    expect(prompt.find(chunks[0]) > i1 and prompt.find(chunks[1]) > i2 > i1, "第一块资料要放在 [1] 后面，第二块放在 [2] 后面，而且资料要原样放进去")
    expect(question in prompt, "Prompt 里要有用户的问题原文")
    expect("引用" in prompt, "要在 Prompt 里要求模型回答时标出引用了哪几条资料（Prompt 里要有「引用」两个字）")
    expect("资料里没有" in prompt, "要在 Prompt 里要求模型：找不到答案时回答「资料里没有」（这五个字要原样写进去）")


run(
    [
        ("切块：每块不超过 size 个字", "基础", test_chunk_size),
        ("切块：相邻两块重叠 overlap 个字", "基础", test_chunk_overlap),
        ("切块：不漏字、不多切", "基础", test_chunk_complete),
        ("切块：短文字、空文字、overlap 太大", "基础", test_chunk_edges),
        ("检索：找出最相关的 k 块", "基础", test_search_top),
        ("检索：按分数从高到低排", "基础", test_search_order),
        ("进阶：相关度门槛 min_score", "进阶", test_min_score),
        ("进阶：拼出带编号、要求引用的 Prompt", "进阶", test_prompt),
    ],
    setup,
)
