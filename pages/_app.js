import React from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { StyleProvider } from '@ant-design/cssinjs';
import '../styles/globals.css';

const theme = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#3370ff',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    borderRadius: 8,
  },
};

export default function App({ Component, pageProps }) {
  return (
    <StyleProvider cache={false}>
      <ConfigProvider theme={theme}>
        <Component {...pageProps} />
      </ConfigProvider>
    </StyleProvider>
  );
}
