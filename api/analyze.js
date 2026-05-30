export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

// MiMo v2.5 Pro 配置
const MODEL = 'mimo-v2.5-pro';
const API_URL = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions';

// ═══════════════════════════════════════
// 1. LLM 调用层
// ═══════════════════════════════════════
async function callLLM(messages, apiKey, { maxTokens = 4000, temperature = 0.7 } = {}) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      model: MODEL, 
      messages, 
      max_tokens: maxTokens, 
      temperature,
      stream: false
    }),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`LLM HTTP ${r.status}: ${errText}`);
  }
  const d = await r.json();
  return { 
    content: d.choices?.[0]?.message?.content || '', 
    tokens: d.usage?.total_tokens || 0 
  };
}

// ═══════════════════════════════════════
// 2. 工具执行
// ═══════════════════════════════════════
async function executeTool(tool, input, llmCall) {
  switch (tool) {
    case 'analyze_requirements': {
      const messages = [
        { role: 'system', content: '你是需求分析专家。分析岗位需求，输出 JSON 格式：{"known":[],"inferred":[],"unknown":[],"critical_questions":[]}' },
        { role: 'user', content: `分析这个岗位需求: ${input}` }
      ];
      const { content } = await llmCall(messages, { maxTokens: 800, temperature: 0.3 });
      const match = content.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : { known: [input], inferred: [], unknown: ['详情'], critical_questions: ['请补充'] };
    }
    
    case 'generate_jd': {
      const messages = [
        { role: 'system', content: '你是 JD 写作专家。根据需求生成专业 JD，包含：岗位名称、职责、要求、薪资范围。' },
        { role: 'user', content: `根据以下需求生成 JD:\n${input}` }
      ];
      const { content } = await llmCall(messages, { maxTokens: 2000, temperature: 0.7 });
      return { jd: content };
    }
    
    case 'validate_jd': {
      const messages = [
        { role: 'system', content: '你是 JD 质量评审专家。评估 JD 质量，输出 JSON：{"coverage":0-100,"specificity":0-100,"issues":[],"suggestions":[]}' },
        { role: 'user', content: `评估这个 JD:\n${input}` }
      ];
      const { content } = await llmCall(messages, { maxTokens: 500, temperature: 0.3 });
      const match = content.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : { coverage: 70, specificity: 60, issues: [], suggestions: [] };
    }
    
    default:
      return { error: `未知工具: ${tool}` };
  }
}

// ═══════════════════════════════════════
// 3. ReAct Agent（MiMo v2.5 Pro 优化版）
// ═══════════════════════════════════════

function buildSystemPrompt() {
  return `你是 JD Copilot，一个 HR 需求对齐助手，基于 ReAct 范式工作。

## ReAct 工作流程
每次回复必须严格按以下格式：

Thought: [你的思考过程]
Action: [工具名][参数]

## 可用工具
1. analyze_requirements[input] - 分析需求，提取已知/未知信息
2. generate_jd[requirements_json] - 根据需求生成 JD
3. validate_jd[jd_content] - 校验 JD 质量
4. Finish[最终答案] - 完成任务

## 示例
用户: 前端工程师
Thought: 用户只说了岗位名称"前端工程师"，信息不足。我需要先分析需求，了解已知和未知信息。
Action: analyze_requirements[前端工程师]

（工具返回分析结果后）
Thought: 分析完成，已知岗位名称，但缺少具体工作内容、团队构成等关键信息。我需要追问用户。
Action: Finish[为了生成完整的 JD，我需要更多信息。请回答：
1. 这个前端工程师的主要工作内容是什么？
2. 他将与哪些团队合作？]

## 重要规则
1. 每次输出必须包含 Thought: 和 Action: 两行
2. Action 必须是以下之一：analyze_requirements[...], generate_jd[...], validate_jd[...], Finish[...]
3. 当信息足够时，调用 generate_jd 生成 JD
4. 生成 JD 后，调用 validate_jd 校验质量
5. 最终用 Finish[...] 输出结果`;
}

function parseOutput(text) {
  // 提取 Thought
  const thoughtMatch = text.match(/Thought:\s*(.*?)(?=\nAction:|\nFinish:|$)/s);
  const thought = thoughtMatch ? thoughtMatch[1].trim() : null;

  // 提取 Action
  const actionMatch = text.match(/Action:\s*(\w+)\[(.*?)\]/s);
  const action = actionMatch ? { tool: actionMatch[1], input: actionMatch[2].trim() } : null;

  // 检查是否是 Finish
  const finishMatch = text.match(/Finish\[(.*?)\]/s);
  const finish = finishMatch ? finishMatch[1].trim() : null;

  return { thought, action, finish };
}

async function* reactAgent(userMessage, history, apiKey) {
  const llmCall = async (msgs, opts) => callLLM(msgs, apiKey, opts);
  
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ];

  let totalTokens = 0;

  for (let step = 0; step < 5; step++) {
    const { content, tokens } = await callLLM(messages, apiKey, { maxTokens: 2000, temperature: 0.7 });
    totalTokens += tokens;

    const parsed = parseOutput(content);

    // 发送 Thought
    if (parsed.thought) {
      yield { type: 'thought', content: parsed.thought, step: step + 1 };
    }

    // 处理 Finish
    if (parsed.finish) {
      yield { type: 'finish', content: parsed.finish, step: step + 1 };
      break;
    }

    // 处理 Action
    if (parsed.action) {
      const { tool, input } = parsed.action;
      yield { type: 'action', tool, input, step: step + 1 };

      try {
        const result = await executeTool(tool, input, llmCall);
        yield { type: 'observation', content: JSON.stringify(result, null, 2), step: step + 1 };

        // 更新消息历史
        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: `工具 ${tool} 返回结果: ${JSON.stringify(result)}\n请根据结果继续下一步。` });
      } catch (e) {
        yield { type: 'error', content: `工具错误: ${e.message}`, step: step + 1 };
        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: `工具错误。请直接用 Finish[...] 输出结果。` });
      }
    } else {
      // 解析失败，将内容作为最终答案
      yield { type: 'finish', content: content, step: step + 1 };
      break;
    }
  }

  yield { type: 'meta', tokens_used: totalTokens, model: 'MiMo v2.5 Pro', steps: 5 };
}

// ═══════════════════════════════════════
// 4. 评估模式
// ═══════════════════════════════════════
const GOLDEN = [
  { id: 'G1', input: '前端工程师', scenario: '标准岗位' },
  { id: 'G2', input: '产品经理', scenario: '复合岗位' },
  { id: 'G3', input: '数据分析师', scenario: '技术岗位' },
  { id: 'G4', input: '我要一个厉害的人', scenario: '模糊需求' },
  { id: 'G5', input: 'AI 算法工程师', scenario: '前沿岗位' },
];

// ═══════════════════════════════════════
// 5. HTTP Handler
// ═══════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: CORS });

  const apiKey = process.env.MIMO_API_KEY;
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
            const messages = [
              { role: 'system', content: buildSystemPrompt() },
              { role: 'user', content: golden.input }
            ];
            const { content, tokens } = await callLLM(messages, apiKey, { maxTokens: 1000, temperature: 0.7 });
            const parsed = parseOutput(content);
            results.push({
              id: golden.id,
              scenario: golden.scenario,
              input: golden.input,
              has_thought: !!parsed.thought,
              has_action: !!parsed.action || !!parsed.finish,
              tokens,
              pass: !!parsed.thought && (!!parsed.action || !!parsed.finish),
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
        for await (const step of reactAgent(message, history, apiKey)) {
          send(step);
        }
      } catch (e) {
        send({ type: 'error', message: e.message });
      }
      ctrl.close();
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS } });
}
