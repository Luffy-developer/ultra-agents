# 假的大模型：不联网、不花钱，按写好的剧本一句句回复（作业和检查脚本都用它，不用改这个文件）
# 工作流里不用工具调用，所以这个假模型更简单：给它一段提示词，它回一段文字


class FakeLLM:
    def __init__(self, script):
        """script：剧本，一个字符串列表，每一项是模型的一次回复"""
        self.script = list(script)
        self.prompts = []  # 每次收到的提示词，检查脚本靠它看你给模型发了什么

    def ask(self, prompt):
        """问模型一次：传入提示词（字符串），返回模型的回答（字符串）"""
        self.prompts.append(prompt)
        if not self.script:
            raise RuntimeError("假模型的剧本用完了：你问模型的次数比预期多")
        return self.script.pop(0)
