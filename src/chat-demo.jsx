import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme, Tag, Typography } from 'antd';
import { Bubble, Sender, Prompts, Welcome } from '@ant-design/x';
import { AbstractChatProvider, XRequest } from '@ant-design/x-sdk';
import { useXChat } from '@ant-design/x-sdk';
import { RobotOutlined, UserOutlined } from '@ant-design/icons';

const { Text } = Typography;

// ═══ 自定义主题 - 匹配网站配色 ═══
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
    Bubble: {
      contentBg: '#0f0f0f',
      contentBorder: '#1a1a1a',
    },
    Sender: {
      bg: '#0f0f0f',
      border: '#1a1a1a',
    },
  },
};

// ═══ API 配置 ═══
const API = '/api/analyze';

// ═══ 自定义 Chat Provider ═══
// 遵循 x-chat-provider 技能规范：只实现三个转换方法，不实现 request 方法
class JDCopilotProvider extends AbstractChatProvider {
  // 参数转换：合并 onRequest 参数 + XRequest 默认参数
  transformParams(requestParams, options) {
    return {
      message: requestParams.message || '',
      history: requestParams.history || [],
    };
  }

  // 本地消息：将 onRequest 参数转换为用户侧显示消息
  transformLocalMessage(requestParams) {
    return {
      content: requestParams.message || '',
      role: 'user',
    };
  }

  // 响应转换：将流式 chunk 转换为消息格式
  // API 返回 SSE 格式：data: {"type": "message", "content": "..."}
  // XRequest 解析后 chunk 为 JSON 对象
  transformMessage(info) {
    const { originMessage, chunk } = info;

    // 处理 message 类型的 chunk（流式文本）
    if (chunk?.type === 'message' && chunk?.content) {
      return {
        content: `${originMessage?.content || ''}${chunk.content}`,
        role: 'assistant',
      };
    }

    // 处理结束标记或空 chunk
    if (!chunk || chunk.type === 'done' || chunk === '[DONE]') {
      return originMessage || { content: '', role: 'assistant' };
    }

    // 忽略其他类型（context_analysis, quality_check 等）
    return originMessage || { content: '', role: 'assistant' };
  }
}

// ═══ 聊天组件 ═══
function ChatDemo() {
  const senderRef = useRef(null);

  // 使用 useState 确保 Provider 只创建一次（遵循 x-skill 规范）
  // ❌ 错误做法：在组件体内直接 new Provider() 会导致每次渲染重建
  const [provider] = useState(
    () =>
      new JDCopilotProvider({
        request: XRequest(API, {
          manual: true,
        }),
      }),
  );

  // 使用 useXChat hook
  const { messages, onRequest, isRequesting, abort } = useXChat({
    provider,
    requestPlaceholder: {
      content: '思考中...',
      role: 'assistant',
    },
    requestFallback: (_, { error, messageInfo }) => {
      if (error.name === 'AbortError') {
        return {
          content: messageInfo?.message?.content || '已取消回复',
          role: 'assistant',
        };
      }
      return {
        content: `⚠️ ${error.message || '请求失败，请稍后重试'}`,
        role: 'assistant',
      };
    },
  });

  const quickPrompts = [
    { key: 'frontend', label: '前端工程师' },
    { key: 'pm', label: '产品经理' },
    { key: 'vague', label: '模糊需求' },
    { key: 'meeting', label: '📋 粘贴会议记录' },
  ];

  const handleSend = (content) => {
    onRequest({
      message: content,
      history: messages.map(({ message }) => ({
        role: message.role,
        content: message.content,
      })),
    });
  };

  return (
    <div
      style={{
        background: '#0f0f0f',
        border: '1px solid #1a1a1a',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* 聊天头部 */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid #1a1a1a',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 12, color: '#c9a96e', margin: 0 }}>
          JD Copilot · Ant Design X
        </Text>
        <Tag color="green" style={{ fontSize: 9 }}>
          ● 就绪
        </Tag>
      </div>

      {/* Welcome 区域 - messages.length === 0 时显示 */}
      {messages.length === 0 && (
        <div
          style={{
            padding: '24px 14px',
            textAlign: 'center',
            borderBottom: '1px solid #1a1a1a',
          }}
        >
          <Welcome
            icon={<RobotOutlined style={{ fontSize: 20, color: '#c9a96e' }} />}
            title="你好，我是 JD Copilot"
            description="帮你从碎片信息中整合出一份靠谱的 JD。输入岗位名称，或粘贴会议记录。"
            style={{ background: 'transparent', padding: 0 }}
          />
          <Prompts
            items={quickPrompts.map((p) => ({
              key: p.key,
              label: p.label,
              onClick: () => {
                if (p.key === 'meeting') {
                  handleSend(
                    '今天和产品部老王聊了一下，他说他们急需一个前端工程师。现在前端团队3个人，代码质量不太行，经常出bug，特别是订单管理模块。老王说希望能找个有经验的人来重构一下。技术栈是React和TypeScript，用的Ant Design。薪资大概25K到40K吧，14薪。对了，这个人最好有B端SaaS的经验，能独立推动事情。团队氛围还行，就是技术债重。',
                  );
                } else {
                  handleSend(p.label);
                }
              },
            }))}
            style={{ marginTop: 16, justifyContent: 'center', background: 'transparent' }}
          />
        </div>
      )}

      {/* 气泡列表 - 使用 role 配置（不是 roles） */}
      <div style={{ padding: 14, minHeight: 300, maxHeight: 420, overflow: 'auto' }}>
        <Bubble.List
          role={{
            user: { placement: 'end' },
            assistant: { placement: 'start' },
          }}
          items={messages.map(({ id, message, status }) => ({
            key: id,
            role: message.role,
            content: message.content,
            loading: status === 'loading',
            avatar: {
              icon: message.role === 'user' ? <UserOutlined /> : <RobotOutlined />,
              style: {
                background:
                  message.role === 'user' ? 'rgba(124,159,212,0.15)' : 'rgba(201,169,110,0.1)',
                color: message.role === 'user' ? '#7c9fd4' : '#c9a96e',
              },
            },
          }))}
          style={{ background: 'transparent' }}
        />
      </div>

      {/* Sender 输入框 - 添加 onCancel 支持取消 */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #1a1a1a' }}>
        <Sender
          ref={senderRef}
          placeholder="输入岗位名称，或粘贴会议记录..."
          onSubmit={handleSend}
          loading={isRequesting}
          onCancel={abort}
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
