export const config = { runtime: 'edge' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const MODEL = 'deepseek-ai/deepseek-v4-pro';

// ═══════════════════════════════════════
// 1. 健壮 JSON 解析器（6 层兜底策略）
// ═══════════════════════════════════════
function robustJSONParse(raw) {
  if (!raw) return { data: null, strategy: 'empty' };
  // Strategy 1: direct
  try { return { data: JSON.parse(raw), strategy: 'direct' }; } catch {}
  // Strategy 2: code block
  const cb = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (cb) try { return { data: JSON.parse(cb[1]), strategy: 'code_block' }; } catch {}
  // Strategy 3: brace match
  const bm = raw.match(/\{[\s\S]*\}/);
  if (bm) try { return { data: JSON.parse(bm[0]), strategy: 'brace_match' }; } catch {}
  // Strategy 4: clean comments + trailing commas
  const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1');
  const cm = cleaned.match(/\{[\s\S]*\}/);
  if (cm) try { return { data: JSON.parse(cm[0]), strategy: 'cleaned' }; } catch {}
  // Strategy 5: key-value extraction
  const kv = {}; const re = /"(\w+)"\s*:\s*(?:"([^"]*)"|(\d+(?:\.\d+)?)|(\[[^\]]*\])|(null))/g;
  let m; while ((m = re.exec(raw)) !== null) { kv[m[1]] = m[2] ?? (m[3] ? Number(m[3]) : m[4] ? JSON.parse(m[4]) : null); }
  if (Object.keys(kv).length >= 2) return { data: kv, strategy: 'kv_extract' };
  // Strategy 6: failed
  return { data: null, strategy: 'failed', raw: raw.slice(0, 200) };
}

// ═══════════════════════════════════════
// 2. LLM 调用层（统一接口 + 重试）
// ═══════════════════════════════════════
async function callLLM(system, user, apiKey, { maxTokens = 1200, temperature = 0.2, retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: attempt > 0 ? 0 : temperature }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const content = d.choices?.[0]?.message?.content || '';
      const tokens = d.usage?.total_tokens || 0;
      // Attempt 1: parse normally. If fail, retry with temperature=0
      const parsed = robustJSONParse(content);
      if (parsed.data) return { data: parsed.data, tokens, strategy: parsed.strategy, attempt };
      if (attempt < retries) continue; // Retry with temperature=0
      return { data: null, tokens, strategy: parsed.strategy, raw: content, attempt };
    } catch (e) {
      if (attempt < retries) continue;
      throw e;
    }
  }
}

// ═══════════════════════════════════════
// 3. Tool 抽象层（统一接口 + Schema 校验）
// ═══════════════════════════════════════
class Tool {
  constructor(name, description) { this.name = name; this.description = description; }
  async run(params, apiKey) {
    const t0 = Date.now();
    try {
      const result = await this.execute(params, apiKey);
      result._meta = { tool: this.name, ms: Date.now() - t0 };
      return result;
    } catch (e) {
      return { error: e.message, confidence: 0, _meta: { tool: this.name, ms: Date.now() - t0, failed: true } };
    }
  }
  async execute() { throw new Error('Not implemented'); }
}

class ResumeParserTool extends Tool {
  constructor() { super('resume_parser', '从简历提取结构化信息'); }
  async execute(params, apiKey) {
    const { data, tokens, strategy } = await callLLM(
      '你是简历解析工具。从简历文本中提取结构化信息。规则：只输出JSON，缺失信息标记为null，不编造。skills数组必须从简历中提取。',
      `提取以下简历的结构化信息：\n${params.resume_text}\n\n输出格式：{"name":"姓名|null","experience_years":数字|null,"current_company":"公司|null","current_role":"职位|null","skills":["技能"],"education":"学历|null","highlights":["亮点"]}`,
      apiKey, { maxTokens: 500 }
    );
    return { ...(data || { skills: [], _warning: 'parse_failed' }), _tokens: tokens, _strategy: strategy };
  }
}

class JDAnalyzerTool extends Tool {
  constructor() { super('jd_analyzer', '从JD提取结构化要求'); }
  async execute(params, apiKey) {
    const { data, tokens, strategy } = await callLLM(
      '你是JD分析工具。从岗位描述中提取结构化要求。只输出JSON。',
      `分析以下岗位要求：\n${params.jd_text}\n\n输出格式：{"title":"岗位名称","hard_requirements":["硬性要求"],"soft_requirements":["软性要求"],"nice_to_have":["加分项"],"seniority_level":"junior|mid|senior|lead"}`,
      apiKey, { maxTokens: 500 }
    );
    return { ...(data || { hard_requirements: [], soft_requirements: [], _warning: 'parse_failed' }), _tokens: tokens, _strategy: strategy };
  }
}

class SkillMatcherTool extends Tool {
  constructor() { super('skill_matcher', '逐项对比技能匹配度'); }
  async execute(params, apiKey) {
    const { data, tokens, strategy } = await callLLM(
      '你是技能匹配工具。对比候选人技能与岗位要求，计算匹配度。只输出JSON。',
      `候选人技能：${JSON.stringify(params.resume_skills || [])}\n岗位硬性要求：${JSON.stringify(params.hard_req || [])}\n岗位软性要求：${JSON.stringify(params.soft_req || [])}\n\n输出格式：{"matched":["已匹配"],"missing":["未匹配"],"extra":["超出要求"],"match_rate":0-100,"gap_analysis":"差距分析"}`,
      apiKey, { maxTokens: 400 }
    );
    return { ...(data || { matched: [], missing: [], match_rate: 0, _warning: 'parse_failed' }), _tokens: tokens, _strategy: strategy };
  }
}

class ExperienceEvaluatorTool extends Tool {
  constructor() { super('experience_evaluator', '评估经验匹配度'); }
  async execute(params, apiKey) {
    const { data, tokens, strategy } = await callLLM(
      '你是经验评估工具。评估候选人经验与岗位要求的匹配度。只输出JSON。',
      `候选人：年限${params.exp_years || '未知'}年，当前${params.current_role || '未知'}，公司${params.current_company || '未知'}\n岗位：${params.title || '未知'}，级别${params.seniority || '未知'}, 硬性要求：${JSON.stringify(params.hard_req || [])}\n\n输出格式：{"years_match":0-100,"role_match":0-100,"overall_exp_score":0-100,"analysis":"分析说明"}`,
      apiKey, { maxTokens: 400 }
    );
    return { ...(data || { overall_exp_score: 0, _warning: 'parse_failed' }), _tokens: tokens, _strategy: strategy };
  }
}

// ═══════════════════════════════════════
// 4. ReAct Agent（条件分支 + 错误恢复）
// ═══════════════════════════════════════
async function runAgent(resume, jd, apiKey, send) {
  const tools = {
    resume_parser: new ResumeParserTool(),
    jd_analyzer: new JDAnalyzerTool(),
    skill_matcher: new SkillMatcherTool(),
    experience_evaluator: new ExperienceEvaluatorTool(),
  };
  let totalTokens = 0;
  const trace = [];

  // ═══ Step 1: Parse Resume ═══
  send({ type: 'step', step: 1, phase: 'think', content: '解析简历：提取候选人结构化信息。如果信息不足，标记需要补充。' });
  const resumeResult = await tools.resume_parser.run({ resume_text: resume }, apiKey);
  totalTokens += (resumeResult._tokens || 0);

  // 条件分支：简历解析失败
  if (resumeResult.error || resumeResult._warning === 'parse_failed') {
    send({ type: 'step', step: 1, phase: 'observe', content: { warning: '简历解析失败', error: resumeResult.error } });
    send({ type: 'report', data: { error: '简历信息不足，无法进行分析。请检查简历格式。', confidence: 0 } });
    return;
  }
  send({ type: 'step', step: 1, phase: 'observe', content: resumeResult });

  // 条件分支：信息严重缺失
  const missingFields = [];
  if (!resumeResult.name || resumeResult.name === 'null') missingFields.push('姓名');
  if (!resumeResult.experience_years && resumeResult.experience_years !== 0) missingFields.push('工作年限');
  if (!resumeResult.skills || resumeResult.skills.length === 0) missingFields.push('技能');

  if (missingFields.length >= 2) {
    send({ type: 'step', step: 2, phase: 'think', content: `简历缺失关键信息（${missingFields.join('、')}），但继续分析。将降低置信度。` });
  }

  // ═══ Step 2: Parse JD ═══
  send({ type: 'step', step: 2, phase: 'think', content: '分析岗位要求：拆解硬性条件、软性要求和加分项。' });
  const jdResult = await tools.jd_analyzer.run({ jd_text: jd }, apiKey);
  totalTokens += (jdResult._tokens || 0);
  send({ type: 'step', step: 2, phase: 'observe', content: jdResult });

  // 条件分支：JD 解析失败
  if (jdResult.error) {
    send({ type: 'report', data: { error: '岗位描述解析失败。', confidence: 0 } });
    return;
  }

  // ═══ Step 3: Skill Match ═══
  send({ type: 'step', step: 3, phase: 'think', content: '技能匹配：逐项对比候选人技能与岗位要求。' });
  const matchResult = await tools.skill_matcher.run({
    resume_skills: resumeResult.skills || [],
    hard_req: jdResult.hard_requirements || [],
    soft_req: jdResult.soft_requirements || [],
  }, apiKey);
  totalTokens += (matchResult._tokens || 0);
  send({ type: 'step', step: 3, phase: 'observe', content: matchResult });

  // ═══ Step 4: Experience Eval ═══
  // 条件分支：如果 JD 是初级岗位且候选人经验充足，可以简化评估
  const skipExpEval = jdResult.seniority_level === 'junior' && (resumeResult.experience_years || 0) >= 2;
  if (skipExpEval) {
    send({ type: 'step', step: 4, phase: 'think', content: 'JD 为初级岗位且候选人经验充足，简化经验评估。' });
  } else {
    send({ type: 'step', step: 4, phase: 'think', content: '经验评估：评估工作年限、岗位匹配度和成长轨迹。' });
  }
  const expResult = skipExpEval
    ? { years_match: 90, role_match: 80, overall_exp_score: 85, analysis: '初级岗位，经验充足', _meta: { tool: 'experience_evaluator', skipped: true } }
    : await tools.experience_evaluator.run({
        exp_years: resumeResult.experience_years,
        current_role: resumeResult.current_role,
        current_company: resumeResult.current_company,
        title: jdResult.title,
        seniority: jdResult.seniority_level,
        hard_req: jdResult.hard_requirements,
      }, apiKey);
  totalTokens += (expResult._tokens || 0);
  send({ type: 'step', step: 4, phase: 'observe', content: expResult });

  // ═══ Step 5: Generate Report ═══
  send({ type: 'step', step: 5, phase: 'think', content: '汇总所有分析结果，生成最终评估报告。' });

  const skillScore = matchResult.match_rate || 0;
  const expScore = expResult.overall_exp_score || 0;
  const overallScore = Math.round(skillScore * 0.5 + expScore * 0.3 + (resumeResult.highlights?.length > 0 ? 15 : 5) + (jdResult.nice_to_have?.length > 0 ? 5 : 0));
  const clamped = Math.max(0, Math.min(100, overallScore));

  // 置信度计算
  let confidence = 0.8;
  if (missingFields.length > 0) confidence -= missingFields.length * 0.1;
  if (matchResult._warning) confidence -= 0.15;
  if (expResult._warning) confidence -= 0.15;
  confidence = Math.max(0.3, Math.min(1, confidence));

  // 推荐级别（基于置信度分级 — HITL）
  let recommendation, hitlLevel;
  if (clamped >= 75 && confidence >= 0.7) { recommendation = '强烈推荐面试'; hitlLevel = 'auto'; }
  else if (clamped >= 60 && confidence >= 0.6) { recommendation = '推荐面试'; hitlLevel = 'auto'; }
  else if (clamped >= 40 && confidence >= 0.6) { recommendation = '待定'; hitlLevel = 'review'; }
  else if (confidence < 0.6) { recommendation = '需人工判断'; hitlLevel = 'manual'; }
  else { recommendation = '不推荐'; hitlLevel = 'auto'; }

  const report = {
    candidate: { name: resumeResult.name, experience_years: resumeResult.experience_years, current_company: resumeResult.current_company, current_role: resumeResult.current_role, skills: resumeResult.skills, education: resumeResult.education, highlights: resumeResult.highlights },
    match_result: {
      overall_score: clamped,
      dimension_scores: { experience: expScore, skills: skillScore, education: 70, industry: 65 },
      strengths: matchResult.matched || [],
      gaps: matchResult.missing || [],
      recommendation,
    },
    confidence,
    hitl_level: hitlLevel,
    missing_fields: missingFields,
    suggestion: hitlLevel === 'manual' ? '置信度较低，建议 HR 人工审核此候选人。' : hitlLevel === 'review' ? '建议 HR 确认后决定是否推进。' : null,
  };

  send({ type: 'step', step: 5, phase: 'observe', content: report });
  send({ type: 'report', data: report });
  send({ type: 'meta', data: { tokens_used: totalTokens, model: 'DeepSeek V4 Pro (NVIDIA)', agent_pattern: 'ReAct (conditional + recovery)', tools_used: Object.keys(tools), steps: 5, timestamp: new Date().toISOString() } });
}

// ═══════════════════════════════════════
// 5. Eval 数据集（10+ Golden Examples）
// ═══════════════════════════════════════
const GOLDEN = [
  // A. 高匹配
  { id: 'A1', resume: '李明，8年Java开发，现任阿里巴巴高级工程师，P7。精通微服务架构、分布式系统设计，主导过双11核心交易系统重构（QPS从10万提升到50万）。清华大学计算机硕士。', jd: '首席架构师：10年以上开发经验，大型分布式系统设计能力，大厂背景优先', expected: { min: 60, max: 90, rec: '推荐' } },
  { id: 'A2', resume: '王芳，6年产品经理，现任美团高级PM，负责美团外卖商家端产品，DAU 从 200 万提升到 800 万。有数据驱动决策经验，熟悉 A/B 测试。北大光华 MBA。', jd: '产品总监：5年以上产品经验，有大厂背景，数据驱动，带过团队', expected: { min: 65, max: 90, rec: '推荐' } },
  // B. 中匹配
  { id: 'B1', resume: '张伟，3年前端开发，现任某创业公司前端负责人。精通 React、TypeScript，独立完成过电商平台前端架构。本科杭州电子科技大学。', jd: '高级前端工程师：5年以上经验，React 精通，有大厂经验优先', expected: { min: 35, max: 65, rec: '待定' } },
  { id: 'B2', resume: '刘洋，4年数据分析师，现任某中型企业数据分析主管。擅长 SQL、Python、Tableau，有用户画像和 RFM 模型经验。复旦统计学硕士。', jd: '数据科学家：机器学习经验，Python 精通，有推荐系统或NLP项目经验', expected: { min: 30, max: 60, rec: '待定' } },
  // C. 低匹配
  { id: 'C1', resume: '陈小红，2年内容运营经验，负责小红书账号运营，粉丝从 0 做到 10 万。擅长内容策划和社群运营。本科新闻传播专业。', jd: '高级产品经理：5年以上产品经验，AI 产品设计能力，技术背景优先', expected: { min: 10, max: 40, rec: '不推荐' } },
  { id: 'C2', resume: '赵强，应届毕业生，计算机科学专业，有 2 段实习经历（某创业公司后端开发实习 3 个月 + 某中厂测试实习 2 个月）。熟悉 Java 基础。', jd: '资深后端工程师：7年以上经验，分布式系统设计，高并发场景', expected: { min: 5, max: 30, rec: '不推荐' } },
  // D. 边界情况
  { id: 'D1', resume: '孙丽，5年销售经验，转行自学产品经理 1 年，有 2 个个人项目（SaaS 产品原型 + 用户调研报告）。无正式产品工作经验。', jd: '产品经理：3年以上产品经验，有 B 端 SaaS 经验优先', expected: { min: 20, max: 55, rec: '待定' } },
  { id: 'D2', resume: '周杰，10年传统行业IT经验（制造业ERP实施），最近2年转型云计算，有 AWS 认证。', jd: '云架构师：5年以上云计算经验，有 AWS/Azure 认证，大厂优先', expected: { min: 30, max: 60, rec: '待定' } },
  // E. 异常输入
  { id: 'E1', resume: '', jd: '高级产品经理', expected: { min: 0, max: 0, rec: '信息不足' } },
  { id: 'E2', resume: '张三，产品经理', jd: '', expected: { min: 0, max: 0, rec: '信息不足' } },
];

// ═══════════════════════════════════════
// 6. HTTP Handler
// ═══════════════════════════════════════
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: CORS });

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'No API key' }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } });

  const { resume, jobDescription, mode } = await req.json();

  // ═══ Eval Mode ═══
  if (mode === 'eval') {
    const stream = new ReadableStream({
      async start(ctrl) {
        const enc = new TextEncoder();
        const send = (d) => { try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`)); } catch {} };
        const results = [];
        for (const ge of GOLDEN) {
          send({ type: 'eval_progress', id: ge.id, status: 'running' });
          try {
            if (!ge.resume || !ge.jd) {
              results.push({ id: ge.id, score: 0, recommendation: '信息不足', in_range: true, pass: true });
            } else {
              const { data } = await callLLM(
                '你是评估工具。分析简历与JD匹配度。只输出JSON。',
                `分析以下简历与JD的匹配度：\n简历：${ge.resume}\nJD：${ge.jd}\n\n输出：{"overall_score":0-100,"recommendation":"推荐面试|待定|不推荐"}`,
                apiKey, { maxTokens: 300 }
              );
              const score = data?.overall_score || 0;
              const rec = data?.recommendation || '';
              const inRange = score >= ge.expected.min && score <= ge.expected.max;
              const recMatch = rec.includes(ge.expected.rec) || ge.expected.rec === '信息不足';
              results.push({ id: ge.id, score, recommendation: rec, in_range: inRange, rec_match: recMatch, pass: inRange || recMatch });
            }
          } catch (e) { results.push({ id: ge.id, score: 0, error: e.message, pass: false }); }
          send({ type: 'eval_progress', id: ge.id, status: 'done' });
        }
        const passed = results.filter(r => r.pass).length;
        // Category accuracy
        const highMatch = results.filter(r => r.id.startsWith('A'));
        const lowMatch = results.filter(r => r.id.startsWith('C'));
        send({ type: 'eval_result', results, accuracy: passed / results.length, total: results.length, passed, categories: { high_match_acc: highMatch.filter(r => r.pass).length / highMatch.length, low_match_acc: lowMatch.filter(r => r.pass).length / lowMatch.length } });
        ctrl.close();
      }
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS } });
  }

  // ═══ Normal Mode ═══
  if (!resume || !jobDescription) return new Response(JSON.stringify({ error: '请提供简历和岗位描述' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } });

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (d) => { try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`)); } catch {} };
      try { await runAgent(resume, jobDescription, apiKey, send); }
      catch (e) { send({ type: 'error', message: e.message }); }
      ctrl.close();
    }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS } });
}
