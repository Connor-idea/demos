# 技术负责人视角：智聘助手项目评审

> 身份设定：某大厂 T9/T10 级技术负责人，主导过多个 AI Agent 平台的架构设计，深谙 LLM 应用工程化的坑。以下是以该身份对「智聘助手」项目的深度技术评审。

---

## 一、架构设计：你实现的不是 Agent，是 Prompt Pipeline

你在页面上写了"ReAct + Tool-Based 架构"，但我看了代码，**你实现的是一个预定义的 5 步 Prompt Pipeline，不是 Agent。**

### 1.1 "ReAct" 是假的

真正的 ReAct（Yao et al., 2022）是什么？

```
Thought: 我需要先解析简历
Action: call resume_parser(resume_text)
Observation: {"name": "张三", "skills": ["产品管理", "数据分析"]}
Thought: 简历已解析，现在我需要分析 JD
Action: call jd_analyzer(jd_text)
Observation: {"hard_requirements": ["3年以上电商经验"]}
Thought: 现在我有了两边的结构化数据，我可以做匹配了
→ 但等一下，简历里没有提到电商经验，我应该先确认一下...
Action: call skill_matcher(skills=resume_skills, requirements=jd_requirements)
```

**关键区别：Thought 可以改变后续的 Action。** 如果 Observe 发现简历缺少关键信息，Agent 可以决定"先问用户补充信息"而不是"继续往下走"。

你的实现：
```
Step 1: resume_parser (固定)
Step 2: jd_analyzer (固定)
Step 3: skill_matcher (固定)
Step 4: experience_evaluator (固定)
Step 5: report_generator (固定)
```

**这是 Chain，不是 Agent。** 没有条件分支、没有动态规划、没有根据中间结果调整策略的能力。

### 我想看到的

真正的 Agent 应该具备：
- **条件分支**：如果简历信息不足，先调用 resume_parser 补充解析
- **动态规划**：根据 JD 的复杂度决定分析步骤（简单 JD 可以跳过 experience_evaluator）
- **错误恢复**：如果某个工具返回异常，Agent 能重试或选择替代方案
- **置信度驱动**：如果 skill_matcher 的置信度低于 0.6，触发人工审核流程

---

## 二、"Tool-Based 架构"只是多个 Prompt

### 2.1 Hello-Agents 的 Tool 抽象

Hello-Agents 第 7 章定义的 Tool 接口：

```python
class Tool:
    name: str           # 工具名称
    description: str    # 工具描述（供 Agent 理解何时使用）
    
    def run(self, parameters: dict) -> str:
        # 1. 参数校验
        # 2. 执行逻辑
        # 3. 结果格式化
        # 4. 错误处理
        pass
```

**Tool 的核心价值是：统一接口 + 参数校验 + 错误处理。** Agent 不需要知道 Tool 的内部实现，只需要知道"我能传什么参数、会得到什么结果"。

### 2.2 你的实现

你的每个"工具"只是不同的 system prompt：

```javascript
// resume_parser — 其实就是一个 prompt
const prompt = `从以下简历中提取结构化信息...`;

// jd_analyzer — 另一个 prompt
const prompt = `从以下岗位描述中提取...`;
```

**没有 Tool 抽象，没有参数校验，没有错误处理。**

### 2.3 应该怎么做

```javascript
class Tool {
  constructor(name, description, schema) {
    this.name = name;
    this.description = description;
    this.schema = schema;  // JSON Schema 定义输入输出
  }
  
  async run(params) {
    // 1. 参数校验
    this.validate(params);
    // 2. 执行
    const result = await this.execute(params);
    // 3. 结果校验
    this.validateOutput(result);
    // 4. 返回
    return result;
  }
  
  validate(params) {
    // 检查必需参数是否存在
    // 检查参数类型是否正确
    // 如果校验失败，返回明确的错误信息
  }
}

class ResumeParserTool extends Tool {
  constructor() {
    super('resume_parser', '从简历中提取结构化信息', {
      input: { resume_text: 'string' },
      output: { name: 'string|null', skills: 'array', ... }
    });
  }
  
  async execute(params) {
    // 调用 LLM，带 JSON 解析兜底
    // 如果 LLM 输出不是 JSON，重试一次（temperature=0）
    // 如果仍然失败，返回部分结果 + warning
  }
}
```

---

## 三、提示词工程：你展示的是 v1，不是经过迭代的版本

### 3.1 你声称有 4 个版本的迭代

你展示了提示词迭代记录（v1→v4），但：
- **没有展示每个版本的具体 prompt 长什么样**（只有改了什么的描述）
- **没有展示评估结果对比**（v1 准确率多少？v4 准确率多少？）
- **没有展示 A/B 测试数据**

面试官会问："你说 v2 添加了'标记 null，不编造'，幻觉率降低了 40%。这个 40% 是怎么测的？测试了多少个样本？"

### 3.2 你没有讲的关键技术点

**JSON 格式漂移问题：**
- DeepSeek V4 Pro 输出的 JSON 偶尔会包含注释（`// xxx`）或尾逗号
- 你需要一个健壮的 JSON 解析器，而不是简单的 `JSON.parse`
- 正确做法：正则清理 → JSON.parse → 失败则用宽松解析 → 仍然失败则提取 key-value

**上下文窗口管理：**
- 你的 resume_parser 输入的是完整简历文本（可能 2000+ 字）
- 你的 jd_analyzer 输入的是完整 JD（可能 1000+ 字）
- 你的 report_generator 输入的是前面所有结果的 JSON（可能 3000+ 字）
- 总输入可能达到 6000+ 字，加上 System Prompt，很容易超过上下文窗口
- **你没有提到任何上下文压缩策略**

**Temperature 的影响：**
- 你用 temperature=0.2，但没有解释为什么
- Temperature=0 会更稳定但可能更"死板"
- Temperature=0.2 允许少量随机性，但可能导致相同输入不同输出
- **你做过温度实验吗？什么温度下 JSON 输出最稳定？**

---

## 四、Eval 体系：2 个 Golden Examples 不是"体系"

### 4.1 Hello-Agents 第 12 章的评估框架

```
Dataset（数据集）→ Evaluator（评估器）→ Metrics（指标）→ Report（报告）
```

- **Dataset**：至少 50+ 样本，覆盖不同场景（高匹配/低匹配/边界情况/异常输入）
- **Evaluator**：自动化评估流程，不是人工看一眼
- **Metrics**：准确率、精确率、召回率、F1、分类准确率
- **Report**：自动生成评估报告，包含错误分析

### 4.2 你的实现

- **Dataset**：2 个 Golden Examples（一个高匹配、一个低匹配）
- **Evaluator**：没有自动化，只是"运行 Eval"按钮
- **Metrics**：只有"准确率"（而且定义不清晰）
- **Report**：没有错误分析

### 4.3 你缺少的关键能力

**评估数据集构建：**
- 至少需要 20+ 样本，按类型分层：
  - 高匹配（应该推荐）：5 个
  - 低匹配（不推荐）：5 个
  - 边界情况（部分匹配）：5 个
  - 异常输入（简历为空、JD 不完整、英文简历）：5 个
- 每个样本需要标注 ground truth（期望的分数区间和推荐级别）

**评估指标定义：**
- **准确率**：推荐结果与 ground truth 一致的比例
- **分数偏差**：AI 给分与人工评分的平均绝对偏差（MAE）
- **分类准确率**：在"推荐/待定/不推荐"三个类别上的准确率
- **JSON 解析成功率**：输出能被正确解析为 JSON 的比例

**错误分析：**
- 最常见的错误模式是什么？（幻觉？分数偏差？推荐级别错误？）
- 哪些类型的简历分析准确率最低？（非标准格式？跨行业？应届生？）
- 错误的原因是什么？（模型能力不足？提示词不清晰？上下文太长？）

---

## 五、"为什么不用 Function Calling" 是面试必问问题

### 5.1 你选择了"用提示词模拟工具调用"

这个选择本身可以是正确的，但**你必须说清楚为什么**。

可能的正确理由：
- DeepSeek V4 Pro 的 Function Calling 支持不稳定
- NVIDIA NIM 平台对 Function Calling 的支持有限
- 我需要控制工具调用的格式和输出，Function Calling 的灵活性不够

**但你完全没提这个决策。** 面试官会认为你不知道 Function Calling 是什么。

### 5.2 为什么不用 LangChain / AutoGen？

你选择了自己实现 Agent 循环，而不是用框架。这个选择也可以是正确的，但**你必须说清楚为什么**。

可能的正确理由：
- 学习目的，需要理解 Agent 的底层机制
- LangChain 的抽象层太重，增加调试难度
- 项目需求简单，不需要框架的复杂功能

**但你没提。** 面试官会认为你不知道这些框架的存在。

---

## 六、生产就绪度：离上线还很远

### 6.1 你缺少的关键能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 错误重试 | ❌ | LLM 输出格式错误时没有重试机制 |
| 超时处理 | ❌ | Edge Function 30 秒超时后用户看到什么？ |
| 降级策略 | ❌ | 模型不可用时如何处理？ |
| 日志追踪 | ❌ | 每次分析的完整日志（输入/输出/耗时/token） |
| 监控告警 | ❌ | 准确率下降时如何发现？ |
| A/B 测试 | ❌ | 如何对比不同提示词版本的效果？ |
| 缓存 | ❌ | 相同输入是否应该缓存结果？ |
| 限流 | ❌ | 如何防止滥用？ |

### 6.2 SSE 流式是前端优化，不是架构决策

你把 SSE 流式当作一个重要的技术决策来展示，但它本质上只是**前端用户体验优化**。

真正的架构决策是：
- 为什么选择 Edge Runtime 而不是 Serverless？（冷启动延迟 vs 执行时间限制）
- 为什么选择 NVIDIA NIM 而不是直接调用 DeepSeek API？（免费额度 vs 延迟）
- 为什么选择单次调用而不是流式生成？（SSE 的实现复杂度 vs 用户体验）

---

## 七、我作为面试官会追问的问题

1. 你说这是 ReAct 架构，但代码里是固定步骤。你知道 ReAct 的论文里是怎么定义的吗？
2. 你的 Tool 之间有依赖关系吗？如果 resume_parser 失败了，后面的步骤怎么办？
3. 你用 temperature=0.2，为什么不是 0？做过温度实验吗？
4. 你的 Eval 只有 2 个样本。你怎么知道模型不是在这 2 个样本上过拟合了？
5. 如果简历是英文的，你的 Agent 能处理吗？
6. 你为什么不用 Function Calling？DeepSeek V4 Pro 支持吗？
7. 你的 Agent 遇到一份格式异常的简历（比如纯文本、没有分段），会怎么样？
8. 如果让你重新设计，你会改变什么？

---

## 八、总评

**这个项目展示了一个技术人对 Agent 概念的初步理解，但实现深度不足。**

核心问题：
- "ReAct"和"Tool-Based"是标签，不是实现。代码和概念之间有明显的落差。
- Eval 体系只有 2 个样本，不具备统计意义。
- 没有错误处理、降级策略、日志追踪等生产级能力。
- 关键技术决策（为什么不用 Function Calling、为什么不用框架）没有说明。

**如果这是一个面试项目，我会关注：**
- 你是否真正理解 Agent 的核心机制（而不是只知道概念）
- 你是否具备工程化思维（错误处理、监控、测试）
- 你是否能诚实地说"这个还不完善，但我计划这样做"
