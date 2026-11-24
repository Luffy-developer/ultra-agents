# 第 13 课作业：写一个迷你评估程序

改了 Prompt、换了模型，Agent 是变好了还是变差了？靠感觉不行，要用一组测试题来量。
这份作业里，你来写一个迷你版的 `agent-tutor --eval`。打开 `evaluate.py`，把标了 `TODO` 的函数写出来。

## 用到的数据长什么样

**测试题** `case`：一个字典
```python
{
    "name": "问天气要调用工具",
    "input": "北京明天下雨吗？",
    "expect": {
        "contains": ["北京"],        # 回答里必须有的文字（可以不写这一项）
        "not_contains": ["我不知道"], # 回答里不能有的文字（可以不写）
        "tools": ["get_weather"],    # 必须调用过的工具（可以不写）
    },
}
```

**Agent** `agent`：一个函数，`agent(题目的 input)` 返回这次的运行记录：
```python
{"reply": "北京明天有小雨", "tools": ["get_weather"]}   # 最终回答 + 调用过的工具
```

## 基础要求

1. **写代码评分器 `grade(case, result)`**：按 `case["expect"]` 检查运行记录 `result`，返回 `(是否通过, 原因)`
   - `contains` 里的每段文字都要出现在 `reply` 里
   - `not_contains` 里的每段文字都不能出现在 `reply` 里
   - `tools` 里的每个工具都要出现在 `result["tools"]` 里
   - 通过时原因写空字符串 `""`；没通过时，原因里要**写出是哪段文字或哪个工具出了问题**，方便你读报告时一眼看出错在哪
2. **写 `run_eval(cases, agent, grader)`**：把每道题交给 `agent` 跑一遍，再用 `grader` 评分，返回
   ```python
   {"passed": 通过几道, "total": 一共几道, "rate": 通过率, "failures": [{"name": 题目名, "reason": 原因}, ...]}
   ```
   - `rate` 是 0~1 之间的小数（比如 3 道过了 2 道就是 2/3）；没有题时是 `0.0`
   - `failures` 按题目原来的顺序排列
   - **Agent 运行出错（抛出异常）时，不要让整个评估停下**：这道题算没通过，原因里要有「出错」两个字和错误信息，然后接着跑下一道

## 进阶要求（进阶档）

同一道题让 Agent 做好几次，每次的结果记成 `True`/`False`：
```python
results = {"问天气": [True, True, False], "订机票": [True, True, True], "退款": [False, False, False]}
```

3. **`pass_at_k(results)`**：至少成功一次的题，占所有题的比例（上面的例子是 2/3）
4. **`pass_pow_k(results)`**：每次都成功的题，占所有题的比例（上面的例子是 1/3）
   - 两个函数在没有题时都返回 `0.0`
5. **`compare(before, after)`**：找出**回归题**——改动前通过、改动后没通过的题
   - `before`、`after` 都是 `{题目名: 是否通过}`；只看两边都有的题
   - 返回题目名的列表，按名字排序

## 怎么检查

- 自己跑跑看：`python3 try_it.py`
- 写完告诉导师「写好了」，导师会运行检查脚本告诉你哪些通过了
