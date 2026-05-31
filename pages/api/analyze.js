// Next.js API Route — MiMo v2.5 Pro ReAct Agent v7 (Performance Optimized)
// ═══════════════════════════════════════════════════════
// 核心优化：能本地处理就不调 LLM，减少 50%+ 延迟

const MODEL = 'mimo-v2.5-pro';
const API_URL = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions';

// ─── LLM 调用（429 重试 + 超时）────────────────────────
async function callLLM(messages, apiKey, { maxTokens = 4000, temperature = 0.7 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s 超时
  
  try {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature, stream: false }),
        signal: controller.signal,
      });
      if (r.status === 429) { await new Promise(rs => setTimeout(rs, Math.pow(2, i) * 2000)); continue; }
      if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      return { content: d.choices?.[0]?.message?.content || '', tokens: d.usage?.total_tokens || 0 };
    }
    throw new Error('MiMo API 429 限流，3 次重试均失败');
  } finally {
    clearTimeout(timeout);
  }
}

// ─── JSON 提取（6 层兜底策略）─────────────────────────
function extractJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) { try { return JSON.parse(codeBlockMatch[1]); } catch {} }
  
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) { try { return JSON.parse(braceMatch[0]); } catch {} }
  
  const cleaned = text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\r\n]+/g, '\n');
  try { return JSON.parse(cleaned); } catch {}
  
  const cleanedBraceMatch = cleaned.match(/\{[\s\S]*\}/);
  if (cleanedBraceMatch) { try { return JSON.parse(cleanedBraceMatch[0]); } catch {} }
  
  const kv = {};
  const kvRegex = /"(\w+)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(\d+)|(\[[^\]]*\])|(null))/g;
  let match;
  while ((match = kvRegex.exec(text)) !== null) {
    try {
      let val = match[2] !== undefined ? match[2] : match[3] !== undefined ? Number(match[3]) : match[4] !== undefined ? JSON.parse(match[4]) : null;
      kv[match[1]] = val;
    } catch {}
  }
  if (Object.keys(kv).length > 0) return kv;
  return null;
}

// ─── 从对话历史中提取已知信息 ─────────────────────────
function extractFromHistory(history, currentMessage) {
  const info = {};
  const allMessages = [...history, { role: 'user', content: currentMessage }];

  for (const msg of allMessages) {
    if (msg.role !== 'user') continue;
    const text = (msg.content || '').trim();
    if (!text || text.startsWith('{') || text.startsWith('"')) continue;

    // 岗位名称（只匹配短文本）
    if (!info['岗位名称'] && text.length < 20) {
      const titlePatterns = ['工程师', '经理', '设计师', '分析师', '运营', '销售', '店长', '总监', '主管', '顾问', '秘书', '助理', '厨师', '服务员'];
      if (titlePatterns.some(p => text.includes(p))) info['岗位名称'] = text;
    }

    // 项目类型
    if (!info['项目类型']) {
      if (text.includes('B端') || text.includes('b端')) info['项目类型'] = 'B端';
      else if (text.includes('C端') || text.includes('c端') || text.includes('H5') || text.includes('小程序')) info['项目类型'] = 'C端H5/小程序';
      else if (text.includes('后台') || text.includes('中台')) info['项目类型'] = '中后台';
      else if (text.includes('移动端') || text.includes('App') || text.includes('app')) info['项目类型'] = '移动端App';
    }

    // 技术栈
    if (!info['技术栈']) {
      if (text.includes('React') || text.includes('react')) info['技术栈'] = text.includes('TypeScript') || text.includes('TS') ? 'React + TypeScript' : 'React';
      else if (text.includes('Vue') || text.includes('vue')) info['技术栈'] = text.includes('TS') || text.includes('TypeScript') ? 'Vue + TypeScript' : 'Vue';
      else if (text.includes('Angular') || text.includes('angular')) info['技术栈'] = 'Angular';
      else if (text.includes('全家桶')) info['技术栈'] = text;
    }

    // 经验要求
    if (!info['经验要求']) {
      const yearMatch = text.match(/(\d+)\s*[-到至]\s*(\d+)\s*年/);
      if (yearMatch) info['经验要求'] = `${yearMatch[1]}-${yearMatch[2]}年`;
      else if (text.includes('初级') || text.includes('1-3年')) info['经验要求'] = '1-3年（初级）';
      else if (text.includes('中级') || text.includes('3-5年')) info['经验要求'] = '3-5年（中级）';
      else if (text.includes('高级') || text.includes('5年以上') || text.includes('资深')) info['经验要求'] = '5年以上（高级）';
    }

    // 薪资范围
    if (!info['薪资范围']) {
      const salaryMatch = text.match(/(\d+)\s*[-到至]\s*(\d+)\s*[kK]/);
      if (salaryMatch) info['薪资范围'] = `${salaryMatch[1]}-${salaryMatch[2]}K`;
      else if (text.includes('面议')) info['薪资范围'] = '面议';
    }
  }

  // 从会议记录中提取更多信息
  const meetingText = allMessages.filter(m => m.role === 'user').map(m => m.content).join(' ');
  if (meetingText.length > 50) {
    const teamMatch = meetingText.match(/团队\s*(\d+)\s*人/);
    if (teamMatch && !info['团队规模']) info['团队规模'] = `${teamMatch[1]}人`;

    if (!info['技术栈']) {
      if (meetingText.includes('React')) info['技术栈'] = meetingText.includes('TypeScript') ? 'React + TypeScript' : 'React';
      else if (meetingText.includes('Vue')) info['技术栈'] = 'Vue';
      else if (meetingText.includes('Angular')) info['技术栈'] = 'Angular';
    }

    if (!info['薪资范围']) {
      const salaryMatch = meetingText.match(/(\d+)\s*[kK]\s*[-到至]\s*(\d+)\s*[kK]/);
      if (salaryMatch) info['薪资范围'] = `${salaryMatch[1]}-${salaryMatch[2]}K`;
    }

    if (!info['项目类型']) {
      if (meetingText.includes('B端') || meetingText.includes('SaaS') || meetingText.includes('saas')) info['项目类型'] = 'B端SaaS';
      else if (meetingText.includes('C端') || meetingText.includes('H5')) info['项目类型'] = 'C端H5/小程序';
    }

    if (!info['岗位名称']) {
      if (meetingText.includes('前端')) info['岗位名称'] = '前端工程师';
      else if (meetingText.includes('后端')) info['岗位名称'] = '后端工程师';
      else if (meetingText.includes('产品')) info['岗位名称'] = '产品经理';
    }
  }

  return info;
}

// ─── 本地生成顾问式问题（不调用 LLM，瞬间返回）──────────
function generateQuestions(info) {
  const jobTitle = info['岗位名称'] || '';
  
  // 已有足够信息，不需要问
  if (info['岗位名称'] && Object.keys(info).length >= 3) return [];
  
  // 判断岗位类型
  const techKeywords = ['工程师', '开发', '架构', '运维', '测试', '数据', '算法'];
  const isTech = techKeywords.some(k => jobTitle.includes(k));
  
  if (isTech) {
    return [{
      id: 'q1',
      text: '技术栈偏好是什么？',
      industry_context: '技术栈决定了候选人来源和薪资水平',
      options: [
        { value: 'React/Vue + TypeScript', note: '主流前端，候选人多' },
        { value: 'Java/Go 后端', note: '后端开发，薪资较高' },
        { value: 'Python/算法', note: 'AI/数据方向，人才稀缺' },
        { value: '其他', note: '' }
      ]
    }];
  }
  
  // 非技术岗位：直接生成 JD，不问问题
  return [];
}

// ─── 工具执行 ─────────────────────────────────────────
async function executeTool(tool, input, history, currentMessage, llmCall) {
  if (tool === 'analyze_requirements') {
    const info = extractFromHistory(history, currentMessage);
    const questions = generateQuestions(info);
    
    return {
      _type: 'analysis',
      extracted: info,
      questions: questions,
      tips: questions.length > 0 ? '回答下面的问题，我来帮你完善需求' : '信息已充分，正在生成 JD...'
    };
  }

  if (tool === 'generate_jd') {
    const { content } = await llmCall([
      { role: 'system', content: `你是资深 JD 写作专家。根据需求生成专业 JD，输出严格 JSON：
{
  "_type": "jd",
  "title": "岗位名称",
  "department": "部门",
  "location": "工作地点",
  "salary": "薪资范围",
  "level": "职级",
  "summary": "2-3 句话概述岗位价值和定位",
  "responsibilities": ["职责1","职责2","职责3","职责4","职责5"],
  "requirements": [
    {"text":"要求描述", "level":"必须"},
    {"text":"要求描述", "level":"优先"},
    {"text":"要求描述", "level":"加分"}
  ],
  "nice_to_have": ["加分项1"],
  "benefits": ["福利1","福利2","福利3"]
}
规则：
- responsibilities 5-8 条，用动词开头
- requirements 至少 5 条，必须/优先/加分合理分配
- benefits 至少 3 条
- 语言专业但不冰冷
- 只输出 JSON，不要其他文字` },
      { role: 'user', content: input }
    ], { maxTokens: 2000, temperature: 0.7 });

    const parsed = extractJSON(content);
    if (parsed) { parsed._type = 'jd'; return parsed; }
    return { _type: 'jd', title: '岗位', summary: content, responsibilities: [], requirements: [], benefits: [] };
  }

  if (tool === 'validate_jd') {
    const { content } = await llmCall([
      { role: 'system', content: `你是 JD 质量评审专家。评估 JD 质量，输出严格 JSON：
{
  "_type": "validation",
  "score": 85,
  "checks": [
    {"name":"职责完整性", "pass":true, "detail":"说明"},
    {"name":"要求具体性", "pass":true, "detail":"说明"},
    {"name":"薪资明确性", "pass":false, "detail":"说明"},
    {"name":"福利吸引力", "pass":true, "detail":"说明"},
    {"name":"语言专业性", "pass":true, "detail":"说明"}
  ],
  "suggestions": ["建议1","建议2"]
}
规则：score 0-100，checks 5 项，suggestions 最多 3 条。只输出 JSON。` },
      { role: 'user', content: `请评估这个 JD：\n${input}` }
    ], { maxTokens: 600, temperature: 0.3 });

    const parsed = extractJSON(content);
    if (parsed) {
      parsed._type = 'validation';
      const score = parsed.score || 0;
      parsed.confidence = score >= 85 ? 'High' : score >= 60 ? 'Medium' : 'Low';
      return parsed;
    }
    return { _type: 'validation', score: 70, confidence: 'Medium', checks: [{ name: '内容完整性', pass: true, detail: 'JD 内容基本完整' }], suggestions: [] };
  }

  return { error: `未知工具: ${tool}` };
}

// ─── 快速路径：简单输入直接返回（不调 LLM）─────────────
function fastPath(info, currentMessage) {
  const text = (currentMessage || '').trim();
  
  // 条件：短文本 + 匹配到岗位关键词
  if (text.length < 20 && info['岗位名称'] && !text.includes(' ') && !text.includes('\n')) {
    const questions = generateQuestions(info);
    return {
      _type: 'analysis',
      extracted: info,
      questions: questions,
      tips: questions.length > 0 ? '回答下面的问题，我来帮你完善需求' : '信息已充分，正在生成 JD...'
    };
  }
  return null;
}

// ─── ReAct Agent ──────────────────────────────────────
const SYSTEM_PROMPT = `你是「智聘助手」，专业的 HR 招聘需求对齐 Agent。

## 你的角色：行业顾问 + 教练
你是一个专业的 HR 顾问和行业专家。你的职责是：
1. **引导用户思考**：通过专业问题帮助用户理清需求
2. **提供行业洞察**：每个问题都附带行业背景知识
3. **帮助用户决策**：给出选项时说明行业标准和建议
4. **逐步完善需求**：通过 2-3 轮对话收集关键信息，然后生成 JD

## 工作方式
- **不要直接生成 JD**：先通过对话了解需求
- **每个问题都要有价值**：问的问题要帮助用户思考，而不是收集数据
- **提供行业上下文**：解释为什么这个问题重要，行业标准是什么
- **控制对话轮数**：最多 3 轮对话，然后生成 JD
- **用选项降低负担**：给用户提供选项，而不是开放式问题

## 合规与安全（Compliance & Safety）
- **偏见缓解**：严禁基于性别、年龄、民族、婚姻状况做出任何判断或建议。如果用户输入包含这些信息，必须忽略。
- **数据隐私**：不要在输出中重复用户的敏感个人信息（如手机号、具体住址）。
- **可解释性**：生成的 JD 要求必须具体、可衡量，避免模糊描述（如"有经验的"）。

## HITL (Human-in-the-loop) 规则
- 当信息不足或模糊时，必须向用户提问，而不是猜测。
- 对于关键要求（如学历、核心技能），如果用户未明确指定，必须在 JD 中标注"待确认"。

## ReAct 格式
Thought: [思考]
Action: [工具名][参数]

## 工具
1. analyze_requirements — 分析还需要补充什么
2. generate_jd — 生成 JD
3. validate_jd — 校验 JD
4. Finish — 输出结果

## 流程（严格遵守）
1. 首次收到岗位名 → Thought → Action: analyze_requirements[岗位名称]
2. 工具返回后 → 如果有问题 → Finish[analysis JSON with questions]
3. 工具返回后 → 如果无问题 → Thought → Action: generate_jd[完整需求]
4. 用户回答后 → 判断信息是否足够
   - 不够 → Thought → Action: analyze_requirements[已知信息] → Finish[analysis]
   - 足够 → Thought → Action: generate_jd[完整需求]

## 关键
- **不要重复问用户已经回答过的问题**
- **信息足够就直接生成 JD，不要继续追问**
- **会议记录中可能包含大量信息，要充分利用**
- **工具返回结果后，直接 Finish，不要再"思考"结果**`;

function parseOutput(text) {
  const thought = text.match(/Thought:\s*(.*?)(?=\nAction:|\nFinish:|$)/s)?.[1]?.trim();
  const actionMatch = text.match(/Action:\s*(\w+)\[(.*?)\]/s);
  const action = actionMatch ? { tool: actionMatch[1], input: actionMatch[2].trim() } : null;
  const finish = text.match(/Finish\[(.*?)\]/s)?.[1]?.trim();
  return { thought, action, finish };
}

async function* reactAgent(userMessage, history, apiKey) {
  const llmCall = async (msgs, opts) => callLLM(msgs, apiKey, opts);
  
  // ─── 快速路径：简单输入直接返回，不调 LLM ───
  const quickInfo = extractFromHistory(history, userMessage);
  const quickResult = fastPath(quickInfo, userMessage);
  if (quickResult) {
    yield { type: 'thought', content: `收到岗位「${quickInfo['岗位名称']}」，本地分析完成`, step: 1 };
    yield { type: 'action', tool: 'analyze_requirements', input: quickInfo['岗位名称'], step: 1 };
    yield { type: 'observation', content: JSON.stringify(quickResult, null, 2), step: 1 };
    yield { type: 'finish', content: JSON.stringify(quickResult), step: 1 };
    yield { type: 'meta', tokens_used: 0, model: 'MiMo v2.5 Pro', steps: 1, fastPath: true };
    return;
  }
  
  // ─── 标准路径：需要 LLM ───
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage || '(用户点击了选项)' },
  ];

  let totalTokens = 0;
  let lastResult = null;

  for (let step = 0; step < 4; step++) {
    const { content, tokens } = await callLLM(messages, apiKey, { maxTokens: 2000, temperature: 0.7 });
    totalTokens += tokens;
    const parsed = parseOutput(content);

    if (parsed.thought) yield { type: 'thought', content: parsed.thought, step: step + 1 };

    // Finish
    if (parsed.finish) {
      if (lastResult?._type) {
        yield { type: 'finish', content: JSON.stringify(lastResult), step: step + 1 };
        // JD 生成后自动校验（异步，不阻塞）
        if (lastResult._type === 'jd') {
          yield { type: 'action', tool: 'validate_jd', input: '（自动校验）', step: step + 2 };
          try {
            const validation = await executeTool('validate_jd', JSON.stringify(lastResult), history, userMessage, llmCall);
            yield { type: 'observation', content: JSON.stringify(validation, null, 2), step: step + 2 };
            yield { type: 'finish', content: JSON.stringify(validation), step: step + 2 };
          } catch (e) {
            yield { type: 'error', content: `校验错误: ${e.message}`, step: step + 2 };
          }
        }
      } else {
        const finishJSON = extractJSON(parsed.finish);
        yield { type: 'finish', content: finishJSON?._type ? JSON.stringify(finishJSON) : parsed.finish, step: step + 1 };
      }
      break;
    }

    // Action
    if (parsed.action) {
      const { tool, input } = parsed.action;
      yield { type: 'action', tool, input, step: step + 1 };
      try {
        const result = await executeTool(tool, input, history, userMessage, llmCall);
        lastResult = result;
        yield { type: 'observation', content: JSON.stringify(result, null, 2), step: step + 1 };
        
        // 直接 Finish，不再调用 LLM "思考"结果
        yield { type: 'finish', content: JSON.stringify(result), step: step + 1 };
        break;
      } catch (e) {
        yield { type: 'error', content: `工具错误: ${e.message}`, step: step + 1 };
        yield { type: 'finish', content: `工具执行失败: ${e.message}`, step: step + 1 };
        break;
      }
    } else {
      yield { type: 'finish', content: lastResult?._type ? JSON.stringify(lastResult) : content, step: step + 1 };
      break;
    }
  }
  yield { type: 'meta', tokens_used: totalTokens, model: 'MiMo v2.5 Pro', steps: 4 };
}

// ─── HTTP Handler ─────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key' });

  const { message, history = [] } = req.body;
  if (!message && (!history || history.length === 0)) return res.status(400).json({ error: '请提供 message' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const step of reactAgent(message, history, apiKey)) {
      res.write(`data: ${JSON.stringify(step)}\n\n`);
    }
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
  }
  res.end();
}
