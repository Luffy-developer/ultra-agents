# 自己试一试：切块 → 检索 → 拼 Prompt，看看每一步的结果
# 运行：python3 try_it.py
from pathlib import Path

from rag import build_prompt, chunk, search, similarity

text = (Path(__file__).parent / "knowledge.md").read_text(encoding="utf-8")
question = "出差住酒店每晚最多能报多少钱？"

try:
    chunks = chunk(text, size=120, overlap=30)
    print("切成了 {} 块，前两块：".format(len(chunks)))
    for c in chunks[:2]:
        print("  ---", c.replace("\n", " "))
except NotImplementedError as e:
    raise SystemExit("还没写完：{}".format(e))

try:
    found = search(chunks, question, k=2)
    print("\n问题：", question)
    for c in found:
        print("  [{:.2f}] {}".format(similarity(question, c), c.replace("\n", " ")))
except NotImplementedError as e:
    raise SystemExit("还没写完：{}".format(e))

try:
    print("\n拼好的 Prompt：\n" + build_prompt(question, found))
except NotImplementedError as e:
    print("\n（进阶）{}".format(e))
