import { installWindowCoordinator } from './window-coordinator';
// Chrome Extension Manifest V3 Background Service Worker
// Supports Google Chrome (native side panel) and Arc Browser, Brave, Edge, Opera (floating panel window fallback)
import { captureScheduled } from '../agent/screenshot-capture';

installWindowCoordinator();

const SIDEPANEL_PATH = 'sidepanel.html';
const FLOATING_WINDOW_WIDTH = 420;

// Track Arc Browser environment to bypass non-rendering sidePanel API
let isArcBrowser = false;
try {
  chrome.storage?.local?.get('isArcBrowser', (res) => {
    if (res?.isArcBrowser) isArcBrowser = true;
  });
} catch {}

// Helper to open or focus the OpenBUA interface across all browsers
async function openOpenBUA(targetTab?: chrome.tabs.Tab) {
  let tab = targetTab;
  if (!tab) {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs[0];
    } catch {}
  }

  // 1. In standard Chromium (Chrome, Brave, Edge), attempt native side panel if not detected as Arc
  if (!isArcBrowser && chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && tab?.windowId) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    } catch (err) {
      console.log('[OpenBUA] Native sidePanel.open failed. Falling back to floating window:', err);
    }
  }

  // 2. Fallback for Arc Browser & browsers without native side panel:
  // Check if an existing OpenBUA floating window is already open
  const extUrl = chrome.runtime.getURL(SIDEPANEL_PATH) + (tab?.windowId !== undefined ? `?ownerWindowId=${tab.windowId}` : '');
  try {
    const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup', 'normal'] });
    for (const win of allWindows) {
      if (win.tabs?.some((t) => t.url && t.url.includes(chrome.runtime.id) && t.url === extUrl)) {
        if (win.id !== undefined) {
          await chrome.windows.update(win.id, { focused: true });
          return;
        }
      }
    }
  } catch {}

  // 3. Position the floating window docked on the right side like a side panel
  let left: number | undefined = undefined;
  let top: number | undefined = undefined;
  let height = 750;
  const width = FLOATING_WINDOW_WIDTH;

  if (tab?.windowId) {
    try {
      const currentWin = await chrome.windows.get(tab.windowId);
      if (currentWin.left !== undefined && currentWin.width !== undefined && currentWin.top !== undefined) {
        left = Math.max(0, currentWin.left + currentWin.width - width);
        top = currentWin.top;
        if (currentWin.height) height = currentWin.height;
      }
    } catch {}
  }

  try {
    const win = await chrome.windows.create({
      url: extUrl,
      type: 'popup',
      width,
      height,
      left,
      top,
      focused: true,
    });

    // Arc ignores initial bounds given to windows.create for popups;
    // applying them again via windows.update ensures it docks to the right edge!
    if (win?.id !== undefined && left !== undefined && top !== undefined) {
      for (const delay of [50, 300, 800]) {
        setTimeout(() => {
          if (win.id !== undefined) {
            chrome.windows.update(win.id, { left, top, width, height }).catch(() => {});
          }
        }, delay);
      }
    }
  } catch (err) {
    // If popup window creation fails, fallback to opening a tab
    console.warn('[OpenBUA] Failed to create popup window, opening in tab:', err);
    chrome.tabs.create({ url: extUrl });
  }
}

// Configure on install / startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('[OpenBUA] Extension installed/updated.');

  // Check if Arc before configuring side panel behavior
  chrome.storage?.local?.get('isArcBrowser', (res) => {
    if (!res?.isArcBrowser && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((err) => console.log('[OpenBUA] sidePanel.setPanelBehavior not supported on this browser:', err));
    }
  });

  // Create context menu item for quick access across all browsers (Arc, Brave, Chrome, etc.)
  if (chrome.contextMenus) {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'open_openbua_context_menu',
        title: 'Open OpenBUA Assistant',
        contexts: ['all'],
      });
    });
  }
});

// Toolbar action click listener (Crucial for Arc Browser & browsers without native side panel)
chrome.action.onClicked.addListener(async (tab) => {
  await openOpenBUA(tab);
});

// Context menu click listener
if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'open_openbua_context_menu') {
      await openOpenBUA(tab);
    }
  });
}

// Keyboard command shortcut listener
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === '_execute_action' || command === 'open_openbua') {
      await openOpenBUA();
    }
  });
}

// Relay messages between UI and tabs
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ARC_BROWSER_DETECTED') {
    isArcBrowser = true;
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', timestamp: Date.now() });
    return true;
  }

  if (message.type === 'CAPTURE_VISIBLE_TAB') {
    captureScheduled(message.windowId, { format: 'jpeg', quality: 80 })
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(error => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  }
});

export {};
