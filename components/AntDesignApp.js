import React, { useState, useRef, useCallback } from 'react';
import {
  Bubble, Sender, Welcome, Prompts, ThoughtChain, Think, XProvider,
} from '@ant-design/x';
import { Button, Space, ConfigProvider, theme as antdTheme, Tag, Divider, Typography } from 'antd';
import { createStyles } from 'antd-style';
import {
  ReloadOutlined, CopyOutlined, LikeOutlined, DislikeOutlined,
  CheckCircleOutlined, ExclamationCircleOutlined, StarFilled,
} from '@ant-design/icons';

const { Title, Paragraph } = Typography;

function ensureString(c) {
  if (typeof c === 'string') return c;
  if (c == null) return '';
  if (typeof c === 'object') return JSON.stringify(c, null, 2);
  return String(c);
}

function tryParseJSON(str) {
  if (typeof str !== 'string') return null;
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === 'object' && parsed !== null && parsed._type) return parsed;
  } catch {}
  return null;
}

const TOOL_NAMES = { analyze_requirements: '需求分析', generate_jd: 'JD 生成', validate_jd: '质量校验' };

// ═══════════════════════════════════════════════════════
// A2UI 结构化卡片
// ═══════════════════════════════════════════════════════

function JDCard({ data }) {
  const tagColor = { '必须': '#ef4444', '优先': '#f59e0b', '加分': '#10b981' };
  const label = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'rgba(255,255,255,0.35)', marginBottom: 6 };
  return (
    <div style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, color: 'rgba(255,255,255,0.88)' }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ color: 'rgba(255,255,255,0.95)', margin: 0, fontSize: 18 }}>{data.title || '岗位名称'}</Title>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {data.department && <Tag color="blue">{data.department}</Tag>}
          {data.location && <Tag color="cyan">{data.location}</Tag>}
          {data.salary && <Tag color="green">{data.salary}</Tag>}
          {data.level && <Tag color="purple">{data.level}</Tag>}
        </div>
      </div>
      <Divider style={{ borderColor: 'rgba(255,255,255,0.06)', margin: '12px 0' }} />
      {data.summary && (<div style={{ marginBottom: 16 }}><div style={label}>岗位概述</div><Paragraph style={{ color: 'rgba(255,255,255,0.75)', margin: 0, fontSize: 13, lineHeight: 1.7 }}>{data.summary}</Paragraph></div>)}
      {data.responsibilities?.length > 0 && (<div style={{ marginBottom: 16 }}><div style={label}>核心职责</div><ul style={{ margin: 0, paddingLeft: 16, color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 1.8 }}>{data.responsibilities.map((r, i) => <li key={i}>{r}</li>)}</ul></div>)}
      {data.requirements?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={label}>任职要求</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.requirements.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                <Tag color={tagColor[r.level] || 'default'} style={{ margin: 0, fontSize: 10, lineHeight: '18px', padding: '0 6px' }}>{r.level || '必须'}</Tag>
                <span style={{ color: 'rgba(255,255,255,0.75)' }}>{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.nice_to_have?.length > 0 && (<div style={{ marginBottom: 16 }}><div style={label}><StarFilled style={{ color: '#f59e0b', marginRight: 4 }} />加分项</div><ul style={{ margin: 0, paddingLeft: 16, color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 1.8 }}>{data.nice_to_have.map((n, i) => <li key={i}>{n}</li>)}</ul></div>)}
      {data.benefits?.length > 0 && (<div><div style={label}>福利待遇</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{data.benefits.map((b, i) => <Tag key={i} style={{ background: 'rgba(49,109,255,0.1)', border: '1px solid rgba(49,109,255,0.2)', color: '#3370ff', fontSize: 12 }}>{b}</Tag>)}</div></div>)}
      {data.validation && <><Divider style={{ borderColor: 'rgba(255,255,255,0.06)', margin: '12px 0' }} /><ValidationPanel v={data.validation} /></>}
    </div>
  );
}

function ValidationPanel({ v }) {
  const scoreColor = v.score >= 80 ? '#10b981' : v.score >= 60 ? '#f59e0b' : '#ef4444';
  const confidenceColor = v.confidence === 'High' ? '#10b981' : v.confidence === 'Medium' ? '#f59e0b' : '#ef4444';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'rgba(255,255,255,0.35)' }}>质量校验</div>
        <div style={{ background: scoreColor, color: '#fff', fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 10 }}>{v.score} 分</div>
        {v.confidence && (
          <div style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${confidenceColor}`, color: confidenceColor, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>
            置信度: {v.confidence}
          </div>
        )}
      </div>
      {v.checks?.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, fontSize: 13 }}>
          {c.pass ? <CheckCircleOutlined style={{ color: '#10b981', marginTop: 3 }} /> : <ExclamationCircleOutlined style={{ color: '#f59e0b', marginTop: 3 }} />}
          <div><div style={{ color: 'rgba(255,255,255,0.85)' }}>{c.name}</div>{c.detail && <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 }}>{c.detail}</div>}</div>
        </div>
      ))}
      {v.suggestions?.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(49,109,255,0.08)', borderRadius: 8, border: '1px solid rgba(49,109,255,0.15)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#3370ff', marginBottom: 6 }}>💡 改进建议</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 1.7 }}>{v.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function AnalysisCard({ data, onOptionClick }) {
  return (
    <div style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px 20px', color: 'rgba(255,255,255,0.88)' }}>
      {/* 已理解 */}
      {data.extracted && Object.keys(data.extracted).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>✅ 已理解</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(data.extracted).map(([k, v]) => {
              const display = typeof v === 'object' ? JSON.stringify(v) : String(v);
              return <Tag key={k} style={{ background: 'rgba(49,109,255,0.1)', border: '1px solid rgba(49,109,255,0.2)', color: '#3370ff', fontSize: 12 }}>{k}: {display}</Tag>;
            })}
          </div>
        </div>
      )}
      {/* 顾问式问题 */}
      {data.questions?.length > 0 && (
        <div style={{ marginBottom: data.tips ? 12 : 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'rgba(255,255,255,0.35)', marginBottom: 12 }}>💼 顾问建议</div>
          {data.questions.map((q, i) => (
            <div key={q.id || i} style={{ marginBottom: 16, padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.88)', marginBottom: 4, lineHeight: 1.6, fontWeight: 500 }}>{i + 1}. {q.text}</div>
              {q.industry_context && (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 8, lineHeight: 1.5 }}>
                  💡 {q.industry_context}
                </div>
              )}
              {q.options?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {q.options.map((opt, j) => {
                    const optText = typeof opt === 'object' ? opt.value : opt;
                    const optNote = typeof opt === 'object' ? opt.note : '';
                    return (
                      <div key={j} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Button size="small" onClick={() => onOptionClick(optText)}
                          style={{ background: 'rgba(49,109,255,0.1)', border: '1px solid rgba(49,109,255,0.2)', color: '#3370ff', fontSize: 12, cursor: 'pointer' }}>
                          {optText}
                        </Button>
                        {optNote && (
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', paddingLeft: 4 }}>{optNote}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {/* 引导语 */}
      {data.tips && (
        <div style={{ padding: '8px 12px', background: 'rgba(16,185,129,0.08)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.15)', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
          💡 {data.tips}
        </div>
      )}
    </div>
  );
}

function ContentRenderer({ content, onOptionClick }) {
  const parsed = tryParseJSON(content);
  if (parsed) {
    if (parsed._type === 'jd') return <JDCard data={parsed} />;
    if (parsed._type === 'analysis') return <AnalysisCard data={parsed} onOptionClick={onOptionClick} />;
    if (parsed._type === 'validation') return <ValidationPanel v={parsed} />;
  }
  return <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 14 }}>{content}</div>;
}

// ═══════════════════════════════════════════════════════
// Styles — 全部明确暗色值
// ═══════════════════════════════════════════════════════
const useAppStyles = createStyles(({ css }) => ({
  app: css`height:100vh;display:flex;flex-direction:column;background:#000;color:rgba(255,255,255,0.88);max-width:800px;margin:0 auto;border-left:1px solid rgba(255,255,255,0.06);border-right:1px solid rgba(255,255,255,0.06);`,
  header: css`height:56px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;padding:0 20px;flex-shrink:0;background:#0a0a0a;`,
  headerLeft: css`display:flex;align-items:center;gap:10px;`,
  logo: css`font-weight:600;font-size:15px;color:rgba(255,255,255,0.88);letter-spacing:-0.3px;`,
  tag: css`font-size:10px;font-weight:600;padding:2px 8px;border-radius:6px;background:rgba(49,109,255,0.12);color:#3370ff;border:1px solid rgba(49,109,255,0.2);letter-spacing:0.3px;`,
  status: css`display:flex;align-items:center;gap:6px;font-size:12px;color:rgba(255,255,255,0.45);`,
  dot: css`width:7px;height:7px;border-radius:50%;background:#00b578;`,
  dotBusy: css`width:7px;height:7px;border-radius:50%;background:#ff8f1f;animation:blink 1s infinite;@keyframes blink{50%{opacity:0.4;}}`,
  model: css`font-size:11px;color:rgba(255,255,255,0.3);font-family:'JetBrains Mono',monospace;`,
  chatList: css`flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;`,
  welcome: css`margin-bottom:20px;padding:16px 20px;border-radius:12px;background:#141414;border:1px solid rgba(255,255,255,0.06);.ant-welcome-title{color:rgba(255,255,255,0.88)!important;}.ant-welcome-description{color:rgba(255,255,255,0.65)!important;}`,
  stepsArea: css`margin-bottom:16px;`,
  stepsLabel: css`font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.3);margin-bottom:10px;`,
  sendArea: css`padding:16px 20px;border-top:1px solid rgba(255,255,255,0.06);background:#0a0a0a;flex-shrink:0;`,
  meta: css`display:flex;gap:20px;padding:8px 20px;font-size:11px;color:rgba(255,255,255,0.3);border-top:1px solid rgba(255,255,255,0.04);flex-shrink:0;font-family:'JetBrains Mono',monospace;`,
  footer: css`text-align:center;padding:10px 20px;font-size:11px;color:rgba(255,255,255,0.3);flex-shrink:0;border-top:1px solid rgba(255,255,255,0.04);`,
}));

// ═══════════════════════════════════════════════════════
// ThoughtChain items
// ═══════════════════════════════════════════════════════
function stepsToItems(steps) {
  return steps.map((s, i) => {
    const key = `step-${i}`;
    const content = ensureString(s.content);
    const mono = { fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.65)', background: '#0a0a0a', padding: 10, borderRadius: 6, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 150, overflow: 'auto', border: '1px solid rgba(255,255,255,0.06)' };
    switch (s.type) {
      case 'thought': return { key, title: `Think${s.step ? ` · ${s.step}` : ''}`, icon: '💭', status: 'success', content: <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>{content}</div> };
      case 'action': return { key, title: `调用 ${TOOL_NAMES[s.tool] || s.tool}`, icon: '⚡', status: 'success', content: s.input ? <pre style={mono}>{ensureString(s.input)}</pre> : null };
      case 'observation': return { key, title: 'Observe', icon: '👁', status: 'success', collapsible: true, content: <pre style={{ ...mono, color: '#6bc77b', border: '1px solid rgba(0,181,120,0.15)' }}>{content}</pre> };
      case 'finish': return { key, title: 'Finish', icon: '✅', status: 'success', content: <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 1.6 }}>{content}</div> };
      case 'error': return { key, title: 'Error', icon: '❌', status: 'error', content: <div style={{ fontSize: 13, color: '#ef4444', lineHeight: 1.6 }}>{content}</div> };
      default: return { key, title: s.type, icon: '⏳', status: 'loading' };
    }
  });
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════
export default function AntDesignApp() {
  const { styles } = useAppStyles();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState([]);
  const [meta, setMeta] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const abortRef = useRef(null);
  const listRef = useRef(null);

  const send = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || loading) return;
    setMessages(p => [...p, { key: `u-${Date.now()}`, role: 'user', content: trimmed }]);
    setInputValue('');
    setLoading(true);
    setSteps([]);
    setMeta(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = Date.now();
    const tid = setTimeout(() => ctrl.abort(), 60000);
    try {
      const hist = messages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history: hist }), signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '', answer = '', st = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const ln of lines) {
          if (!ln.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(ln.slice(6));
            if (['thought','action','observation','finish','error'].includes(d.type)) { st.push(d); setSteps([...st]); }
            if (d.type === 'finish') answer = ensureString(d.content);
            if (d.type === 'meta') setMeta({ tokens: d.tokens_used || 0, model: d.model || 'MiMo v2.5 Pro', steps: st.length, time: ((Date.now() - t0) / 1000).toFixed(1) });
          } catch {}
        }
      }
      if (answer) {
        // 收集所有 finish 事件的内容（JD + validation 都需要展示）
        const allFinishes = st.filter(s => s.type === 'finish').map(s => ensureString(s.content));
        const combinedAnswer = allFinishes.length > 1 ? allFinishes[allFinishes.length - 1] : answer;
        setMessages(p => [...p, { key: `a-${Date.now()}`, role: 'assistant', content: combinedAnswer }]);
      }
    } catch (e) {
      clearTimeout(tid);
      const msg = e.name === 'AbortError' ? '⚠️ 请求超时，请重试' : `⚠️ ${e.message}`;
      setMessages(p => [...p, { key: `e-${Date.now()}`, role: 'assistant', content: msg, isError: true }]);
    } finally { setLoading(false); abortRef.current = null; }
  }, [messages, loading]);

  const onOptionClick = useCallback((opt) => send(opt), [send]);
  const isEmpty = messages.length === 0 && !loading;

  const role = {
    assistant: {
      placement: 'start', variant: 'filled',
      contentRender: (content) => <ContentRenderer content={content} onOptionClick={onOptionClick} />,
      footer: () => (
        <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
          <Button type="text" size="small" icon={<ReloadOutlined />} style={{ color: 'rgba(255,255,255,0.3)' }} />
          <Button type="text" size="small" icon={<CopyOutlined />} style={{ color: 'rgba(255,255,255,0.3)' }} />
          <Button type="text" size="small" icon={<LikeOutlined />} style={{ color: 'rgba(255,255,255,0.3)' }} />
          <Button type="text" size="small" icon={<DislikeOutlined />} style={{ color: 'rgba(255,255,255,0.3)' }} />
        </div>
      ),
    },
    user: { placement: 'end', variant: 'shadow' },
  };

  return (
    <ConfigProvider theme={{ algorithm: antdTheme.darkAlgorithm }}>
    <XProvider>
      <div className={styles.app}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.logo}>智聘助手</span>
            <span className={styles.tag}>ReAct Agent</span>
          </div>
          <Space size={16}>
            <span className={styles.status}>
              <span className={loading ? styles.dotBusy : styles.dot} />
              {loading ? '思考中' : '就绪'}
            </span>
            <span className={styles.model}>MiMo v2.5 Pro</span>
          </Space>
        </div>

        <div className={styles.chatList}>
          {isEmpty ? (
            <>
              <Welcome variant="borderless" title="👋 你好，我是智聘助手" description="告诉我你要招聘什么岗位，我会分析需求、引导你补充关键信息、生成专业 JD 并校验质量。" className={styles.welcome} />
              <Prompts vertical title="试试这些：" items={[
                { key: 'frontend', description: '前端工程师' },
                { key: 'pm', description: '产品经理' },
                { key: 'meeting', description: '📋 粘贴会议记录' },
              ]} onItemClick={(info) => {
                const d = info?.data?.description;
                if (d === '📋 粘贴会议记录') send('今天和产品部老王聊了一下，他说他们急需一个前端工程师。现在前端团队3个人，代码质量不太行，经常出bug，特别是订单管理模块。技术栈是React和TypeScript，用的Ant Design。薪资大概25K到40K，14薪。最好有B端SaaS的经验，能独立推动事情。');
                else send(d);
              }} styles={{ title: { fontSize: 14, color: 'rgba(255,255,255,0.45)' } }} />
            </>
          ) : (
            <>
              {steps.length > 0 && (
                <div className={styles.stepsArea}>
                  <div className={styles.stepsLabel}>AGENT 执行轨迹</div>
                  <ThoughtChain items={stepsToItems(steps)} collapsible />
                </div>
              )}
              <Bubble.List ref={listRef} items={messages.map(m => ({ key: m.key, content: ensureString(m.content), role: m.role }))} role={role} style={{ flex: 1 }} />
              {loading && <div style={{ marginTop: 8 }}><Think content="Agent 正在思考..." status="start" /></div>}
            </>
          )}
        </div>

        {meta && (
          <div className={styles.meta}>
            <span>{meta.model}</span><span>{meta.steps} 步</span><span>{meta.tokens} tokens</span><span>{meta.time}s</span>
          </div>
        )}

        <div className={styles.sendArea}>
          <Sender value={inputValue} onChange={setInputValue} onSubmit={(msg) => { send(msg); setInputValue(''); }} onCancel={() => { abortRef.current?.abort(); setLoading(false); }} loading={loading} placeholder="输入岗位名称，或粘贴会议记录..." style={{ width: '100%' }} />
        </div>

        <div className={styles.footer}>Connor · AI 产品经理 · demos.connor.zone · 数据不落盘 · 成本 ≈ ¥0.02/次</div>
      </div>
    </XProvider>
    </ConfigProvider>
  );
}