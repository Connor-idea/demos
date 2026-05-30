import React, { useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme, Tag, Typography } from 'antd';
import { Bubble, Sender, Prompts, Welcome } from '@ant-design/x';
import { RobotOutlined, UserOutlined } from '@ant-design/icons';

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
  let buffer = '', aiMessage = '';

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
      } catch {}
    }
  }
  return aiMessage;
}

// ═══ 聊天组件 ═══
function ChatDemo() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const handleSend = useCallback(async (message) => {
    if (!message.trim() || loading) return;

    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: message };
    const aiMsg = { id: `a-${Date.now()}`, role: 'assistant', content: '', loading: true };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
      const result = await sendMessageAPI(message, history);

      setMessages(prev => prev.map(m =>
        m.id === aiMsg.id ? { ...m, content: result, loading: false } : m
      ));
    } catch (e) {
      if (e.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id ? { ...m, content: `⚠️ ${e.message}`, loading: false } : m
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
    { key: 'meeting', label: '📋 粘贴会议记录' },
  ];

  return (
    <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
      {/* 聊天头部 */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 12, color: '#c9a96e', margin: 0 }}>JD Copilot · Ant Design X</Text>
        <Tag color="green" style={{ fontSize: 9 }}>● 就绪</Tag>
      </div>

      {/* Welcome 区域 */}
      {messages.length === 0 && (
        <div style={{ padding: '24px 14px', textAlign: 'center', borderBottom: '1px solid #1a1a1a' }}>
          <Welcome
            icon={<RobotOutlined style={{ fontSize: 20, color: '#c9a96e' }} />}
            title="你好，我是 JD Copilot"
            description="帮你从碎片信息中整合出一份靠谱的 JD。输入岗位名称，或粘贴会议记录。"
            style={{ background: 'transparent', padding: 0 }}
          />
          <Prompts
            items={quickPrompts.map(p => ({
              key: p.key,
              label: p.label,
              onClick: () => {
                if (p.key === 'meeting') {
                  handleSend('今天和产品部老王聊了一下，他说他们急需一个前端工程师。现在前端团队3个人，代码质量不太行，经常出bug，特别是订单管理模块。老王说希望能找个有经验的人来重构一下。技术栈是React和TypeScript，用的Ant Design。薪资大概25K到40K吧，14薪。对了，这个人最好有B端SaaS的经验，能独立推动事情。团队氛围还行，就是技术债重。');
                } else {
                  handleSend(p.label);
                }
              },
            }))}
            style={{ marginTop: 16, justifyContent: 'center', background: 'transparent' }}
          />
        </div>
      )}

      {/* 气泡列表 - 使用正确的 Bubble.List 格式 */}
      <div style={{ padding: 14, minHeight: 300, maxHeight: 420, overflow: 'auto' }}>
        <Bubble.List
          items={messages.map(m => ({
            key: m.id,
            role: m.role,
            content: m.content || '',
            loading: m.loading || false,
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

      {/* Sender 输入框 */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #1a1a1a' }}>
        <Sender
          placeholder="输入岗位名称，或粘贴会议记录..."
          onSubmit={handleSend}
          loading={loading}
          onCancel={handleAbort}
          style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}
        />
      </div>
    </div>
  );
}

// ═══ 挂载到页面 ═══
const root = document.getElementById('chat-demo-root');
if (root) {
  ReactDOM.createRoot(root).render(
    <ConfigProvider theme={darkTheme}>
      <ChatDemo />
    </ConfigProvider>,
  );
}
