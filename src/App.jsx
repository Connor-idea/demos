import React, { useState, useRef, useCallback } from 'react';
import { ConfigProvider, theme, Layout, Typography, Card, Space, Button } from 'antd';
import { Bubble, Sender, Prompts, Welcome, Conversations } from '@ant-design/x';
import {
  RobotOutlined, UserOutlined, SendOutlined,
} from '@ant-design/icons';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

// ═══ 自定义主题 ═══
const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#c9a96e',
    colorBgContainer: '#0f0f0f',
    colorBgElevated: '#141414',
    colorBgLayout: '#080808',
    colorBorder: '#1a1a1a',
    colorBorderSecondary: '#252525',
    colorText: '#e0e0e0',
    colorTextSecondary: '#888888',
    colorTextTertiary: '#555555',
    borderRadius: 8,
    fontFamily: '"Noto Serif SC", Georgia, serif',
  },
  components: {
    Bubble: { contentBg: '#0f0f0f', contentBorder: '#1a1a1a' },
    Sender: { bg: '#0f0f0f', border: '#1a1a1a' },
  },
};

// ═══ API 调用 ═══
const API = '/api/analyze';

async function sendMessageAPI(message, history) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', aiMessage = '', contextData = null, qualityData = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'message') aiMessage += data.content;
        if (data.type === 'context_analysis') contextData = data.data;
        if (data.type === 'quality_check') qualityData = data.data;
      } catch {}
    }
  }
  return { message: aiMessage, context: contextData, quality: qualityData };
}

// ═══ 主应用 ═══
export default function App() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [contextData, setContextData] = useState(null);
  const [qualityData, setQualityData] = useState(null);
  const [conversations] = useState([
    { key: '1', label: '前端工程师', description: 'B端SaaS，React+TS...' },
    { key: '2', label: '产品经理', description: 'C端产品，3年经验...' },
  ]);
  const [activeConv, setActiveConv] = useState('1');
  const abortRef = useRef(null);

  const handleSend = useCallback(async (message) => {
    if (!message.trim() || loading) return;

    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: message };
    const aiMsg = { id: `a-${Date.now()}`, role: 'assistant', content: '', loading: true };

    // 先添加用户消息和 AI 占位消息
    setMessages(prev => [...prev, userMsg, aiMsg]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // 从当前消息列表构建 history（排除刚添加的占位消息）
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

      const result = await sendMessageAPI(message, history);

      // 更新 AI 消息
      setMessages(prev => prev.map(m =>
        m.id === aiMsg.id
          ? { ...m, content: result.message, loading: false }
          : m
      ));

      if (result.context) setContextData(result.context);
      if (result.quality) setQualityData(result.quality);
    } catch (e) {
      if (e.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id
            ? { ...m, content: `⚠️ ${e.message}`, loading: false }
            : m
        ));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [messages, loading]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setMessages(prev => prev.map(m =>
      m.loading ? { ...m, content: '已取消', loading: false } : m
    ));
  }, []);

  const quickPrompts = [
    { key: 'frontend', label: '前端工程师' },
    { key: 'pm', label: '产品经理' },
    { key: 'vague', label: '模糊需求' },
  ];

  return (
    <ConfigProvider theme={darkTheme}>
      <Layout style={{ minHeight: '100vh' }}>
        {/* ═══ 顶部导航 ═══ */}
        <Header style={{
          background: 'rgba(8,8,8,0.95)', backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #1a1a1a', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center',
          padding: '0 24px', position: 'sticky', top: 0, zIndex: 100,
        }}>
          <Text style={{ color: '#c9a96e', letterSpacing: '0.15em', fontSize: 12, fontWeight: 600 }}>
            CONNOR · AI PM
          </Text>
          <Space size={16}>
            {['问题', '竞品', '方案', '架构', '评估'].map(t => (
              <a key={t} href={`#${t}`} style={{ color: '#888', fontSize: 11 }}>{t}</a>
            ))}
          </Space>
        </Header>

        <Layout>
          {/* ═══ 左侧面板 ═══ */}
          <Sider width={320} style={{ background: '#0f0f0f', borderRight: '1px solid #1a1a1a', overflow: 'auto' }}>
            <div style={{ padding: 16, borderBottom: '1px solid #1a1a1a' }}>
              <Text style={{ fontSize: 11, letterSpacing: '0.1em', color: '#555', textTransform: 'uppercase' }}>
                会话历史
              </Text>
              <div style={{ marginTop: 12 }}>
                <Conversations items={conversations} activeKey={activeConv} onActiveChange={setActiveConv} style={{ background: 'transparent' }} />
              </div>
            </div>

            <div style={{ padding: 16 }}>
              <Text style={{ fontSize: 11, letterSpacing: '0.1em', color: '#555', textTransform: 'uppercase' }}>
                上下文分析
              </Text>

              {[
                { title: '✅ 已知事实', color: '#4ade80', data: contextData?.known_facts },
                { title: '🔮 可推断', color: '#7c9fd4', data: contextData?.inferred },
                { title: '🔴 关键缺失', color: '#f87171', data: contextData?.gap_analysis?.critical },
              ].map(({ title, color, data }, i) => (
                <Card key={i} size="small" style={{ marginTop: i === 0 ? 12 : 8, background: '#141414', border: '1px solid #1a1a1a' }}>
                  <Text style={{ fontSize: 11, fontWeight: 600, color: '#888' }}>{title}</Text>
                  <div style={{ marginTop: 8 }}>
                    {data?.map((item, j) => (
                      <div key={j} style={{ fontSize: 11, padding: '4px 0', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: color, marginTop: 6, flexShrink: 0 }} />
                        <span>{item}</span>
                      </div>
                    )) || <Text style={{ fontSize: 11, color: '#555' }}>等待输入...</Text>}
                  </div>
                </Card>
              ))}
            </div>
          </Sider>

          {/* ═══ 主内容区 ═══ */}
          <Content style={{ display: 'flex', flexDirection: 'column', background: '#080808' }}>
            {/* Welcome */}
            {messages.length === 0 && (
              <div style={{
                padding: '40px 32px', textAlign: 'center',
                borderBottom: '1px solid #1a1a1a',
                background: 'linear-gradient(180deg, rgba(201,169,110,0.03) 0%, transparent 100%)',
              }}>
                <Welcome
                  icon={<RobotOutlined style={{ fontSize: 20, color: '#c9a96e' }} />}
                  title="你好，我是 JD Copilot"
                  description="帮你从碎片信息中整合出一份靠谱的 JD。输入岗位名称，或粘贴会议记录。"
                  style={{ background: 'transparent' }}
                />
                <Prompts
                  items={quickPrompts.map(p => ({ key: p.key, label: p.label, onClick: () => handleSend(p.label) }))}
                  style={{ marginTop: 20, justifyContent: 'center' }}
                />
              </div>
            )}

            {/* Bubble 对话区 */}
            <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
              <Bubble.List
                role={{
                  user: { placement: 'end' },
                  assistant: { placement: 'start' },
                }}
                items={messages.map(m => ({
                  key: m.id,
                  role: m.role,
                  content: m.content,
                  loading: m.loading,
                  avatar: {
                    icon: m.role === 'user' ? <UserOutlined /> : <RobotOutlined />,
                    style: {
                      background: m.role === 'user' ? 'rgba(124,159,212,0.15)' : 'rgba(201,169,110,0.1)',
                      color: m.role === 'user' ? '#7c9fd4' : '#c9a96e',
                    },
                  },
                }))}
                style={{ background: 'transparent' }}
              />
            </div>

            {/* 质量评估 */}
            {qualityData && (
              <div style={{ padding: '16px 32px', background: '#0f0f0f', borderTop: '1px solid #1a1a1a' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, textAlign: 'center' }}>
                  {[
                    { value: qualityData.coverage, label: '覆盖度' },
                    { value: qualityData.candidate_appeal, label: '候选人吸引力' },
                    { value: qualityData.specificity, label: '具体度' },
                    { value: qualityData.confidence, label: '置信度' },
                  ].map((item, i) => (
                    <div key={i} style={{ padding: 8, background: '#141414', borderRadius: 8 }}>
                      <div style={{ fontSize: 18, fontWeight: 300, color: '#c9a96e' }}>{item.value}%</div>
                      <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sender */}
            <div style={{ padding: '16px 32px 24px', background: '#080808', borderTop: '1px solid #1a1a1a' }}>
              <Sender
                placeholder="输入岗位名称，或粘贴会议记录..."
                onSubmit={handleSend}
                loading={loading}
                onCancel={handleAbort}
                style={{ background: '#0f0f0f', border: '1px solid #1a1a1a' }}
                actions={(ori, { SendButton }) => (
                  <Space>
                    <Button size="small" onClick={() => handleSend(
                      '今天和产品部老王聊了一下，他说他们急需一个前端工程师。现在前端团队3个人，代码质量不太行，经常出bug，特别是订单管理模块。老王说希望能找个有经验的人来重构一下。技术栈是React和TypeScript，用的Ant Design。薪资大概25K到40K吧，14薪。对了，这个人最好有B端SaaS的经验，能独立推动事情。团队氛围还行，就是技术债重。'
                    )}>📋 会议记录</Button>
                    <SendButton type="primary" icon={<SendOutlined />} />
                  </Space>
                )}
              />
            </div>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
