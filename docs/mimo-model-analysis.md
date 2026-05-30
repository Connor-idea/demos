# MiMo 模型深度分析 + Hello-Agents 配置优化

> 基于 Xiaomi MiMo 官方文档 + Hello-Agents 框架
> 版本：v1.0
> 日期：2026-05-30

---

## 一、MiMo 模型矩阵

### 1.1 模型对比

| 模型 | 最佳场景 | 上下文 | 最大输出 | 参数规模 | 定位 |
|------|----------|--------|----------|----------|------|
| **mimo-v2.5-pro** | 旗舰推理、编码Agent、工具密集型长任务 | 1M | 128K | 1T总参/42B活跃 | 旗舰级 |
| **mimo-v2.5** | 全模态理解（文本/图像/音频/视频） | 1M | 128K | - | 全能型 |
| **mimo-v2-pro** | V2 Pro长上下文推理 | 1M | 128K | - | 推理型 |
| **mimo-v2-omni** | V2全模态理解 | 256K | 128K | - | 全模态 |
| **mimo-v2-flash** | 高效编码、Agent、通用文本 | 256K | 64K | - | 经济型 |

### 1.2 选择决策树

```
需要图像/音频/视频理解？
├─ 是 → mimo-v2.5 (1M ctx) 或 mimo-v2-omni (256K ctx)
└─ 否 → 需要最高质量推理？
    ├─ 是 → mimo-v2.5-pro (1M ctx, 128K out)
    └─ 否 → 成本敏感？
        ├─ 是 → mimo-v2-flash (256K ctx, 64K out)
        └─ 否 → mimo-v2.5-pro (默认选择)
```

---

## 二、模型深度分析

### 2.1 mimo-v2.5-pro（当前使用）

**优势**：
- 1M 上下文窗口，支持超长对话和文档处理
- 128K 最大输出，适合生成长篇内容
- 1T 总参数/42B 活跃参数，推理能力强
- 支持 thinking 模式（深度推理）
- 支持 function calling（工具调用）
- 支持 web search（联网搜索）

**劣势**：
- Token Plan 2x 消耗（比 mimo-v2.5 贵一倍）
- 429 速率限制（RPM 100, TPM 10M）
- thinking + tool_calls 不稳定（官方文档确认）
- 不支持 Responses API（仅 Chat Completions）

**适用场景**：
- 复杂推理任务
- 长文档分析
- 多轮工具调用
- 高质量内容生成

### 2.2 mimo-v2-flash

**优势**：
- 成本低（mimo-v2.5-pro 的 1/10）
- 速度快（适合实时交互）
- 256K 上下文足够大多数场景
- 支持 function calling

**劣势**：
- 推理深度不如 pro
- 64K 最大输出限制
- 不支持 thinking 模式

**适用场景**：
- 快速响应场景
- 成本敏感场景
- 简单工具调用
- 实时聊天

---

## 三、参数调优指南

### 3.1 Temperature 设置

| 场景 | mimo-v2.5-pro | mimo-v2-flash |
|------|---------------|---------------|
| 编码/函数调用 | 1.0 (默认) | 0.3 |
| 通用对话 | 1.0 | 0.8 |
| 创意写作 | 1.0 | 0.8 |
| 数学推理 | 1.0 | 1.0 |
| WebDev | 1.0 | 0.8 |

**关键发现**：
- mimo-v2.5-pro 默认 temperature=1.0，不需要调整
- mimo-v2-flash 需要根据场景调整：编码用 0.3，对话用 0.8

### 3.2 Top-p 设置

所有模型默认 top_p=0.95，范围 [0.01, 1.0]。

**建议**：保持默认 0.95，除非有特殊需求。

### 3.3 Thinking 模式

**开启方式**：
```json
{
  "thinking": {
    "type": "enabled"
  }
}
```

**重要限制**：
- thinking + tool_calls 不稳定（官方确认）
- 需要回传 reasoning_content（多轮对话）
- temperature 强制 1.0

**建议**：
- 纯对话任务：开启 thinking
- 工具调用任务：关闭 thinking
- 编码任务：根据复杂度决定

---

## 四、Hello-Agents 框架应用

### 4.1 上下文管理（GSSC 流水线）

**问题**：1M 上下文窗口虽然大，但上下文过长会导致：
- 推理质量下降（上下文腐烂）
- 成本增加（Token Plan 2x 消耗）
- 响应变慢

**解决方案**：GSSC 流水线

1. **Gather**：收集所有相关信息
2. **Select**：按相关性×时效性评分，保留高价值内容
3. **Structure**：组织成固定模板
4. **Compress**：超限时压缩，保留结构

**实施建议**：
- 对话历史限制在最近 5-10 轮
- 关键信息每轮带上（不要依赖模型记忆）
- 使用外部笔记存储长期状态

### 4.2 工具调用优化

**问题**：thinking + tool_calls 不稳定

**解决方案**：
1. 工具调用时关闭 thinking
2. 保持 tool_choice 为 auto
3. 验证 tool-call JSON 参数
4. 多轮工具调用时保留 reasoning_content

**配置示例**：
```json
{
  "model": "mimo-v2.5-pro",
  "messages": [...],
  "tools": [...],
  "tool_choice": "auto",
  "thinking": {
    "type": "disabled"
  }
}
```

### 4.3 幻觉防控

**MiMo 幻觉风险**：
- 编造未提及的信息
- 编造行业数据
- 格式漂移

**防控措施**：
1. **Prompt 层**：明确要求"不编造未提及信息"
2. **结构层**：JSON Schema + 6 层兜底解析
3. **输出层**：自检 checklist + 置信度评分
4. **来源标注**：每条信息标注"来自对话"或"待确认"

### 4.4 速率限制处理

**问题**：429 错误（每分钟请求次数超限）

**解决方案**：
1. **指数退避**：遇到 429 时等待 1 分钟后重试
2. **请求间隔**：连续 API 调用之间加入 2-3 秒间隔
3. **并发控制**：限制同时请求数量
4. **模型切换**：非关键任务使用 mimo-v2-flash

**配置建议**：
```yaml
# config.yaml
agent:
  api_max_retries: 3
  retry_delay: 60  # 429 时等待 60 秒
  request_interval: 3  # 请求间隔 3 秒
```

---

## 五、场景化配置方案

### 5.1 日常对话场景

```yaml
model: mimo-v2-flash
temperature: 0.8
top_p: 0.95
thinking: disabled
max_completion_tokens: 4096
```

**理由**：
- 成本低（mimo-v2.5-pro 的 1/10）
- 速度快
- 256K 上下文足够

### 5.2 复杂推理场景

```yaml
model: mimo-v2.5-pro
temperature: 1.0
top_p: 0.95
thinking: enabled
max_completion_tokens: 32768
```

**理由**：
- 需要深度推理
- 1M 上下文支持长文档
- thinking 模式提升推理质量

### 5.3 工具调用场景

```yaml
model: mimo-v2.5-pro
temperature: 1.0
top_p: 0.95
thinking: disabled
tool_choice: auto
max_completion_tokens: 8192
```

**理由**：
- thinking + tool_calls 不稳定
- 关闭 thinking 提升稳定性
- 保持 tool_choice 为 auto

### 5.4 编码场景

```yaml
model: mimo-v2-flash
temperature: 0.3
top_p: 0.95
thinking: disabled
max_completion_tokens: 16384
```

**理由**：
- 编码需要确定性（低 temperature）
- mimo-v2-flash 成本低
- 256K 上下文足够大多数编码任务

### 5.5 长文档分析场景

```yaml
model: mimo-v2.5-pro
temperature: 1.0
top_p: 0.95
thinking: enabled
max_completion_tokens: 65536
```

**理由**：
- 需要 1M 上下文窗口
- 需要 128K 最大输出
- thinking 模式提升分析质量

---

## 六、成本优化策略

### 6.1 Token Plan 消耗

| 模型 | 消耗倍数 | 说明 |
|------|----------|------|
| mimo-v2.5-pro | 2x | Token Plan 按 2 倍计算 |
| mimo-v2.5 | 1x | 标准消耗 |
| mimo-v2-flash | 1x | 标准消耗 |
| TTS 系列 | 0x | 限时免费 |

**优化建议**：
- 非关键任务使用 mimo-v2-flash
- 利用离峰时段（00:00-08:00 北京时间）0.8x 消耗
- 合理设置 max_completion_tokens 避免浪费

### 6.2 缓存利用

- Cache hit 价格：输入价格的 1/5
- 重复内容利用缓存降低成本
- 系统提示词保持稳定以利用缓存

### 6.3 请求优化

- 合并多个小请求为一个大请求
- 使用流式输出减少等待时间
- 避免不必要的重试

---

## 七、常见问题解决

### 7.1 429 错误

**原因**：每分钟请求次数超限（RPM 100）

**解决**：
1. 等待 1 分钟后重试
2. 减少并发请求
3. 使用指数退避策略
4. 考虑升级 Token Plan

### 7.2 工具调用不稳定

**原因**：thinking + tool_calls 不稳定（官方确认）

**解决**：
1. 工具调用时关闭 thinking
2. 保持 tool_choice 为 auto
3. 验证 tool-call JSON 参数
4. 多轮工具调用时保留 reasoning_content

### 7.3 上下文过长

**原因**：1M 上下文窗口虽然大，但过长会导致推理质量下降

**解决**：
1. 使用 GSSC 流水线管理上下文
2. 对话历史限制在最近 5-10 轮
3. 关键信息每轮带上
4. 使用外部笔记存储长期状态

### 7.4 幻觉问题

**原因**：模型编造未提及信息

**解决**：
1. Prompt 层：明确要求"不编造未提及信息"
2. 结构层：JSON Schema + 6 层兜底解析
3. 输出层：自检 checklist + 置信度评分
4. 来源标注：每条信息标注来源

---

## 八、配置建议总结

### 8.1 当前配置优化

```yaml
# ~/.hermes/config.yaml
model:
  default: mimo-v2.5-pro
  base_url: https://token-plan-cn.xiaomimimo.com/v1
  provider: xiaomi
  context_length: 1000000

agent:
  max_turns: 90
  api_max_retries: 3
  retry_delay: 60  # 429 时等待 60 秒
  request_interval: 3  # 请求间隔 3 秒
```

### 8.2 场景化切换策略

| 场景 | 模型 | 温度 | Thinking | 备注 |
|------|------|------|----------|------|
| 日常对话 | mimo-v2-flash | 0.8 | 关闭 | 成本低，速度快 |
| 复杂推理 | mimo-v2.5-pro | 1.0 | 开启 | 需要深度思考 |
| 工具调用 | mimo-v2.5-pro | 1.0 | 关闭 | 稳定性优先 |
| 编码任务 | mimo-v2-flash | 0.3 | 关闭 | 确定性优先 |
| 长文档 | mimo-v2.5-pro | 1.0 | 开启 | 需要大上下文 |

### 8.3 监控指标

1. **429 错误率**：监控速率限制
2. **Token 消耗**：监控成本
3. **响应时间**：监控性能
4. **工具调用成功率**：监控稳定性
5. **幻觉率**：监控质量

---

## 九、下一步行动

1. **立即实施**：
   - 配置请求间隔（3 秒）
   - 配置 429 重试策略（60 秒）
   - 工具调用时关闭 thinking

2. **短期优化**：
   - 实现场景化模型切换
   - 建立成本监控
   - 优化上下文管理

3. **长期改进**：
   - 建立评估体系
   - 持续优化提示词
   - 积累最佳实践

---

## 十、参考资源

- **官方文档**：https://platform.xiaomimimo.com/docs/zh-CN/welcome
- **GitHub Skill**：https://github.com/AlcoholTobaccoCode/Xiaomi-mimo-skill
- **Hello-Agents 框架**：https://hello-agents.datawhale.cc
- **本项目**：https://demos.connor.zone
