import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import '../styles/globals.css';

// 1. Respond to visibility pings from the background service worker
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_SIDEPANEL_VISIBILITY') {
      const isVisible = document.visibilityState === 'visible' && !document.hidden && window.innerWidth > 50;
      sendResponse({ visible: isVisible, width: window.innerWidth, height: window.innerHeight });
      return true;
    }
  });
}

// 2. If loaded as a sidepanel in Arc Browser (where side panels are headless/invisible), signal background immediately
if (typeof window !== 'undefined' && !window.location.search.includes('mode=floating')) {
  try {
    chrome.tabs?.query?.({}, (tabs) => {
      const isArc = tabs?.some(
        (t) => t.url?.startsWith('arc://') || t.pendingUrl?.startsWith('arc://') || t.url?.includes('arc://')
      );
      if (isArc) {
        console.log('[OpenBUA] Detected Arc Browser in sidepanel context. Requesting floating window.');
        chrome.storage?.local?.set({ isArcBrowser: true, panelDisplayMode: 'floating' });
        chrome.runtime?.sendMessage?.({ type: 'HEADLESS_SIDEPANEL_FALLBACK' }).catch(() => {});
      }
    });
  } catch {}
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

