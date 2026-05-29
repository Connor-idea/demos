// Vercel Serverless Function - HR Resume Agent
// 使用 NVIDIA API (Llama 3.3 70B) 作为 LLM 后端

export const config = {
  maxDuration: 30,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { resume, jobDescription } = req.body;

  if (!resume || !jobDescription) {
    return res.status(400).json({ error: '请提供简历和岗位描述' });
  }

  const systemPrompt = `你是「智聘助手」，一个专业的 HR 智能招聘 Agent。

## 核心任务
解析候选人简历，提取结构化信息，评估与目标岗位的匹配度。

## 行为规则
- 从简历中提取所有可识别的信息
- 对缺失的信息标记为 null，不要编造
- 计算每个维度的匹配分数（0-100）
- 给出整体置信度（0-1）
- 列出候选人的优势和不足
- 给出明确的推荐建议

## 绝对不能做
- 不能编造简历中没有的信息
- 不能做出最终录用决策（只提供建议）

## 输出格式
严格按 JSON 格式输出，不要添加任何其他内容：

{
  "candidate": {
    "name": "姓名 | null",
    "experience_years": 数字 | null,
    "current_company": "公司 | null",
    "current_role": "职位 | null",
    "skills": ["技能1", "技能2"],
    "education": "学历 | null",
    "highlights": ["亮点1", "亮点2"]
  },
  "match_result": {
    "overall_score": 0-100 | null,
    "dimension_scores": {
      "experience": 0-100,
      "skills": 0-100,
      "education": 0-100,
      "industry": 0-100
    },
    "strengths": ["优势1"],
    "gaps": ["不足1"],
    "recommendation": "强烈推荐 | 推荐面试 | 待定 | 不推荐 | 信息不足"
  },
  "confidence": 0-1,
  "missing_fields": ["缺失字段"],
  "suggestion": "给 HR 的建议"
}`;

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta/llama-3.3-70b-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请分析以下简历与岗位的匹配度：\n\n【简历】\n${resume}\n\n【岗位描述】\n${jobDescription}` }
        ],
        max_tokens: 1500,
        temperature: 0.2,
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('NVIDIA API error:', err);
      return res.status(500).json({ error: 'AI 服务暂时不可用' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({ error: 'AI 返回为空' });
    }

    // 提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AI 返回格式异常', raw: content });
    }

    const result = JSON.parse(jsonMatch[0]);
    result.metadata = {
      tokens_used: data.usage?.total_tokens || 0,
      model: 'Llama 3.3 70B (NVIDIA)',
      timestamp: new Date().toISOString()
    };

    return res.status(200).json(result);

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
}
