import React, { useState, useRef, useCallback } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';

const AntDesignApp = dynamic(() => import('../components/AntDesignApp'), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>智聘助手 — AI Agent Demo | Connor</title>
        <meta name="description" content="基于 ReAct 范式的 HR 智能招聘 Agent。" />
      </Head>
      <AntDesignApp />
    </>
  );
}
