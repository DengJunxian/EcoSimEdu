"""Match classroom questions to topics with evidence at the current stage."""

import re
from unicodedata import normalize


STORY = (
    ("observe", r"怎么观察|怎样观察|看哪里|先看什么|从哪开始|怎么开始|如何开始|怎么读图|how (?:do i|to) (?:start|observe)"),
    ("threshold", r"阈值|门槛|怎么数|怎么算|如何计算|怎么计|空格.*(?:算|计入)|分母|已占|邻居怎么算|没有邻居|threshold|vacan|denominator"),
    ("setting", r"角色|我是谁|a001|我可以|我能做|故事|背景|什么是居住隔离|role|who am i|what can i"),
)
REPLAY = (
    ("impact", r"影响.*(?:邻居|住户)|哪些邻居|哪些住户"),
    ("hint", r"怎么观察|怎样观察|怎么看|先看什么|看哪里|给.*提示|how (?:do i|to) observe|hint"),
    ("cause", r"为什么.*(?:搬|迁)|为何.*(?:搬|迁)|怎么会搬|触发|约束|能搬吗|为什么选|why.*mov|rule for mov"),
    ("formula", r"怎么算|如何计算|分母|口径|公式|怎么算出的|how.*calculat|formula|denominator"),
    ("system", r"全图|宏观|整体|同组邻接|达标率|满意率|相似度|overall|city.wide|satisf"),
    ("impact", r"邻居|邻域|影响|这个事件|此次搬|本次搬|这次搬|这笔搬|neighbou?r|this move|affected"),
)
PAIR = (
    ("stop", r"停止|为什么停|轮数|为什么结束|收尾|停下|stop|why.*end"),
    ("controls", r"控制|固定|种子|开局|改变了什么|改了哪|唯一.*变|公平|seed|control|same start"),
    ("inspect", r"怎么核对|怎么回查|先看什么|如何查看|给.*提示|how.*check|hint"),
    ("measure", r"怎么算|如何计算|分母|公式|百分点|口径|达标.*邻接|邻接.*达标|how.*calculat|formula"),
    ("outcome", r"对照|结果|差异|差距|期末|干预|基线|这两组|阈值|compare|difference|result|threshold"),
)
GUIDANCE = {
    1: "现在可以问 A001 有哪些选择、怎么数已占邻格，或如何读开局阈值。",
    2: "可以问这次搬迁为何发生、影响了哪些邻居，或怎样核对当前指标。",
    3: "可以问这次搬迁为何发生、邻域怎样变化，或全图指标如何计算。",
    4: "可以问本组对照保持了哪些条件、两组的期末差值，或各自为什么停止。",
}

_OUTSIDE = re.compile(r"api\s*key|密钥|系统指令|隐藏提示词|私密|隐私|他人私有|另(?:一|个)(?:种子|案例)|真实数据|"
                      r"private (?:data|information)|system prompt|another (?:case|seed)")
_UNREVEALED = re.compile(r"期末|最终|最后|结局|后来|后续|后面|下一(?:轮|笔|个|次)|未揭示|未来|收尾|"
                         r"final|future|unrevealed|next (?:round|event|move)")
_NEW_OUTCOME = re.compile(r"(?:如果|假如|what if).*(?:结果|会怎样|会怎么样|would happen|outcome)|"
                          r"未来|未揭示|下一(?:轮|组|次)|future|unrevealed|next (?:round|run)")
_EVENT = re.compile(r"(?:事件|event\s*#?)\s*(\d+)|第\s*(\d+)\s*(?:个|条)?\s*事件")


def topic(stage, question, event_seqs=()):
    text = normalize("NFKC", question).casefold()
    if _OUTSIDE.search(text) or _NEW_OUTCOME.search(text) or (stage < 4 and _UNREVEALED.search(text)):
        return None
    if any(int(first or second) not in event_seqs for first, second in _EVENT.findall(text)):
        return None
    patterns = STORY if stage == 1 else PAIR if stage == 4 else REPLAY
    return next((name for name, pattern in patterns if re.search(pattern, text)), None)
