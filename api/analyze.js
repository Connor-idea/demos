export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const MODEL = 'meta/llama-3.3-70b-instruct';
const API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// ═══════════════════════════════════════
// 1. LLM 调用层
// ═══════════════════════════════════════
async function callLLM(messages, apiKey, { maxTokens = 1500, temperature = 0.3 } = {}) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature }),
  });
  if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
  const d = await r.json();
  return { content: d.choices?.[0]?.message?.content || '', tokens: d.usage?.total_tokens || 0 };
}

// ═══════════════════════════════════════
// 2. 系统提示词（真实业务场景 · 上下文整合）
// ═══════════════════════════════════════
const SYSTEM_PROMPT = `你是 JD Copilot，一个 HR 需求对齐助手。

## 你的核心价值
HR 没有时间整理分散的上下文。用人部门在走廊随口说"我要一个前端"，HR 有 5 分钟，不是 30 分钟。你要帮 HR 从碎片信息中整合出一份靠谱的 JD。

## 真实业务场景
- 用人部门不会主动讲业务上下文，你要从历史数据中推断
- HR 记不住会议里的所有信息，你要帮她结构化
- 公司有历史招聘数据、在职人员画像、团队结构，你要利用

## 工作流程

### 第 1 步：接收碎片信息
用户可能提供：
- 岗位名称（如"前端工程师"）
- 会议记录/聊天记录（粘贴一大段文字）
- 零散的描述（"用人部门说要一个厉害的人"）

### 第 2 步：识别已知和未知
基于用户提供的信息，识别：
- **已知**：从用户输入中提取的事实
- **可推断**：基于公司历史数据可以推断的信息
- **未知**：需要追问的关键信息

### 第 3 步：精准追问
不要一次问 6 个问题。只问**最关键**的 1-2 个问题，基于：
- 从已知信息中推断出的差距
- 对 JD 质量影响最大的缺失信息

### 第 4 步：生成 JD
当信息足够时，直接生成完整 JD。

## 输出要求

**如果信息不足，追问：**
只问 1-2 个最关键的问题，不要一次问太多。

**如果信息足够，输出：**

第 1 步：输出上下文分析 JSON
\`\`\`json
{
  "phase": "context_analysis",
  "data": {
    "known_facts": ["从用户输入中提取的事实"],
    "inferred": ["基于历史数据推断的信息"],
    "unknown": ["需要追问的关键信息"],
    "gap_analysis": {"critical": ["缺失的关键信息"], "nice_to_have": ["缺失的加分信息"]}
  }
}
\`\`\`

第 2 步：输出完整 JD 文档
直接写在消息中，用以下格式：

**【{岗位名称} · {公司名}】**

**为什么这个角色重要？**
{业务背景和挑战}

**你将做什么？**
- {具体工作 1}
- {具体工作 2}

**你将和谁合作？**
{团队构成}

**硬性条件（必须满足）**
- {条件 1}

**软性条件（优先考虑）**
- {条件 1}

**我们能给你什么**
- {吸引点}
- 薪资：{范围}

第 3 步：输出质量自检 JSON
\`\`\`json
{
  "phase": "quality_check",
  "data": {
    "coverage": 85,
    "candidate_appeal": 70,
    "specificity": 80,
    "confidence": 0.82,
    "unconfirmed_items": ["待确认项"],
    "missing_for_candidate": ["候选人还想知道的"]
  }
}
\`\`\`

## 绝对禁止
- 不要写"有竞争力的薪资""良好的沟通能力"这种废话
- 不要编造用户未提及的信息
- 不要一次问太多问题（最多 2 个）
- 不要把所有要求都堆成"硬性条件"
`;

// ═══════════════════════════════════════
// 3. 对话管理
// ═══════════════════════════════════════
function buildMessages(history, userMessage) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

// ═══════════════════════════════════════
// 4. JSON 提取（从 LLM 回复中提取结构化数据）
// ═══════════════════════════════════════
function extractJSON(text) {
  const results = [];
  const regex = /```json\s*([\s\S]*?)\s*```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try { results.push(JSON.parse(match[1])); } catch {}
  }
  return results;
}

function extractPlainMessage(text) {
  return text.replace(/```json\s*[\s\S]*?\s*```/g, '').trim();
}

// ═══════════════════════════════════════
// 5. 评估模式（Golden Examples）
// ═══════════════════════════════════════
const GOLDEN = [
  { id: 'G1', input: '前端工程师', scenario: '标准岗位', expectQuestions: ['项目类型', '技术栈', '团队角色'], minRounds: 3 },
  { id: 'G2', input: '产品经理', scenario: '复合岗位', expectQuestions: ['产品方向', '技术背景', '行业'], minRounds: 3 },
  { id: 'G3', input: '数据分析师', scenario: '技术岗位', expectQuestions: ['分析方向', '工具要求', '业务理解'], minRounds: 2 },
  { id: 'G4', input: '我要一个厉害的人', scenario: '模糊需求', expectQuestions: ['岗位方向', '核心能力'], minRounds: 3 },
  { id: 'G5', input: 'AI 算法工程师', scenario: '前沿岗位', expectQuestions: ['模型方向', '论文要求', '工程能力'], minRounds: 3 },
];

// ═══════════════════════════════════════
// 6. HTTP Handler
// ═══════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: CORS });

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'No API key' }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }); }

  const { message, history = [], mode } = body;

  // ═══ Eval Mode ═══
  if (mode === 'eval') {
    const stream = new ReadableStream({
      async start(ctrl) {
        const enc = new TextEncoder();
        const send = (d) => { try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`)); } catch {} };
        const results = [];

        for (const golden of GOLDEN) {
          send({ type: 'eval_progress', id: golden.id, status: 'running', scenario: golden.scenario });
          try {
            const messages = buildMessages([], golden.input);
            const { content, tokens } = await callLLM(messages, apiKey, { maxTokens: 800, temperature: 0.2 });
            const extracted = extractJSON(content);
            const plainMsg = extractPlainMessage(content);
            const hasQuestion = plainMsg.includes('?') || plainMsg.includes('？');
            const hasStructure = extracted.length > 0;
            results.push({
              id: golden.id,
              scenario: golden.scenario,
              input: golden.input,
              has_question: hasQuestion,
              has_structure: hasStructure,
              json_blocks: extracted.length,
              tokens,
              pass: hasQuestion || hasStructure,
            });
          } catch (e) {
            results.push({ id: golden.id, pass: false, error: e.message });
          }
          send({ type: 'eval_progress', id: golden.id, status: 'done' });
        }

        const passed = results.filter(r => r.pass).length;
        send({ type: 'eval_result', results, accuracy: passed / results.length, total: results.length, passed });
        ctrl.close();
      }
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS } });
  }

  // ═══ Chat Mode ═══
  if (!message) return new Response(JSON.stringify({ error: '请提供 message' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } });

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (d) => { try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`)); } catch {} };

      try {
        const messages = buildMessages(history, message);
        const { content, tokens } = await callLLM(messages, apiKey);

        // 提取结构化 JSON 块
        const jsonBlocks = extractJSON(content);
        const plainMessage = extractPlainMessage(content);

        // 发送纯文本消息部分
        if (plainMessage) {
          send({ type: 'message', content: plainMessage });
        }

        // 发送结构化数据
        for (const block of jsonBlocks) {
          send({ type: block.phase || 'data', data: block.data || block });
        }

        send({ type: 'meta', tokens_used: tokens, model: 'Llama 3.3 70B (NVIDIA NIM)' });
      } catch (e) {
        send({ type: 'error', message: e.message });
      }
      ctrl.close();
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS } });
}
