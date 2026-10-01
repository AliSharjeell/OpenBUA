// Chrome Extension Manifest V3 Background Service Worker
// Supports Google Chrome (native side panel) and Arc Browser, Brave, Edge, Opera (docked floating panel window)

const SIDEPANEL_PATH = 'sidepanel.html';
const FLOATING_WINDOW_WIDTH = 420;

// Track whether the current environment is Arc Browser or requires a floating window
let isArcBrowser = false;

// 1. Ensure chrome.action.onClicked is NEVER suppressed.
// Setting openPanelOnActionClick to false forces Chromium to dispatch chrome.action.onClicked
// on every click, allowing us to handle Arc Browser, Brave, Edge, and Chrome reliably.
function ensureActionClickEnabled() {
  if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch((err) => console.log('[OpenBUA] setPanelBehavior reset note:', err));
  }
}
ensureActionClickEnabled();

// Load stored Arc detection state
try {
  chrome.storage?.local?.get(['isArcBrowser', 'panelDisplayMode'], (res) => {
    if (res?.isArcBrowser || res?.panelDisplayMode === 'floating') {
      isArcBrowser = true;
    }
  });
} catch {}

// Listen for storage changes
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.isArcBrowser) {
      isArcBrowser = !!changes.isArcBrowser.newValue;
    }
    if (changes.panelDisplayMode) {
      isArcBrowser = changes.panelDisplayMode.newValue === 'floating';
    }
  }
});

// Toggle or open the floating panel window (for Arc Browser and fallback environments)
async function toggleFloatingWindow(targetTab?: chrome.tabs.Tab) {
  const extUrl = chrome.runtime.getURL(SIDEPANEL_PATH) + '?mode=floating';

  // 1. Check if an existing OpenBUA floating window is already open
  try {
    const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup', 'normal'] });
    for (const win of allWindows) {
      if (win.type === 'popup' && win.tabs?.some((t) => t.url && (t.url.includes(chrome.runtime.id) || t.url.includes(SIDEPANEL_PATH)))) {
        if (win.id !== undefined) {
          if (win.focused) {
            // Toggle off: close if user clicks the action icon while already focused
            await chrome.windows.remove(win.id);
            return;
          } else {
            // Bring existing window to front
            await chrome.windows.update(win.id, { focused: true });
            return;
          }
        }
      }
    }
  } catch {}

  // 2. Position the floating window docked flush to the right edge of the active browser window
  let tab = targetTab;
  if (!tab) {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs[0];
    } catch {}
  }

  let left: number | undefined = undefined;
  let top = 0;
  let height = 800;
  const width = FLOATING_WINDOW_WIDTH;

  try {
    let currentWin: chrome.windows.Window | undefined;
    if (tab?.windowId) {
      currentWin = await chrome.windows.get(tab.windowId);
    }
    if (!currentWin || currentWin.left === undefined) {
      currentWin = await chrome.windows.getLastFocused();
    }
    if (currentWin && currentWin.left !== undefined && currentWin.width !== undefined && currentWin.top !== undefined) {
      const winLeft = Math.max(0, currentWin.left);
      const winTop = Math.max(0, currentWin.top);
      left = Math.max(0, currentWin.left + currentWin.width - width);
      top = winTop;
      if (currentWin.height) {
        height = Math.max(600, currentWin.height);
      }
    }
  } catch {}

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

    // In Arc Browser on Windows/macOS, re-updating bounds ensures accurate docking
    if (win?.id !== undefined && left !== undefined) {
      for (const delay of [60, 250, 600]) {
        setTimeout(() => {
          if (win.id !== undefined) {
            chrome.windows.update(win.id, { left, top, width, height }).catch(() => {});
          }
        }, delay);
      }
    }
  } catch (err) {
    console.warn('[OpenBUA] Failed to create popup window, opening in tab:', err);
    chrome.tabs.create({ url: extUrl });
  }
}

// Detect whether the current environment is Arc Browser or requires a floating window
async function detectIsArcOrFloatingMode(tab?: chrome.tabs.Tab): Promise<boolean> {
  // 1. Always check persistent storage first (handles service worker wake-ups)
  try {
    const stored = await chrome.storage.local.get(['isArcBrowser', 'panelDisplayMode']);
    if (stored?.isArcBrowser || stored?.panelDisplayMode === 'floating') {
      isArcBrowser = true;
      return true;
    }
  } catch {}

  // 2. Check if the active tab URL or pendingUrl is an Arc internal URL (e.g. arc://extensions, arc://settings)
  if (tab?.url?.startsWith('arc://') || tab?.pendingUrl?.startsWith('arc://') || tab?.url?.includes('arc://')) {
    console.log('[OpenBUA] Detected Arc Browser via active tab URL.');
    isArcBrowser = true;
    chrome.storage?.local?.set({ isArcBrowser: true, panelDisplayMode: 'floating' });
    return true;
  }

  // 3. Check across all open tabs in all windows for any arc:// URL
  try {
    const allTabs = await chrome.tabs.query({});
    const hasArcTab = allTabs.some(
      (t) => t.url?.startsWith('arc://') || t.pendingUrl?.startsWith('arc://') || t.url?.includes('arc://')
    );
    if (hasArcTab) {
      console.log('[OpenBUA] Detected Arc Browser via open arc:// system tabs.');
      isArcBrowser = true;
      chrome.storage?.local?.set({ isArcBrowser: true, panelDisplayMode: 'floating' });
      return true;
    }
  } catch {}

  // 4. Check active tab DOM for Arc CSS variables / window.arc
  if (tab?.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const rootStyle = getComputedStyle(document.documentElement);
          return !!(
            rootStyle.getPropertyValue('--arc-palette-title') ||
            rootStyle.getPropertyValue('--arc-palette-subtitle') ||
            rootStyle.getPropertyValue('--arc-background-simple-color') ||
            (window as any).arc
          );
        },
      });
      if (results?.[0]?.result) {
        console.log('[OpenBUA] Detected Arc Browser via active tab CSS inspection.');
        isArcBrowser = true;
        chrome.storage?.local?.set({ isArcBrowser: true, panelDisplayMode: 'floating' });
        return true;
      }
    } catch {}
  }

  return isArcBrowser;
}

// Ping sidepanel to verify if it is genuinely visible to the user
async function verifySidepanelVisibility(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PING_SIDEPANEL_VISIBILITY' });
      if (response && response.visible) {
        return true;
      }
    } catch {}
  }
  return false;
}

// Helper to open or focus the OpenBUA interface across all browsers
async function openOpenBUA(targetTab?: chrome.tabs.Tab) {
  let tab = targetTab;
  if (!tab) {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs[0];
    } catch {}
  }

  // 1. If Arc Browser is detected or floating window mode is enabled, directly open docked floating window
  const isArc = await detectIsArcOrFloatingMode(tab);
  if (isArc) {
    console.log('[OpenBUA] Opening docked floating window for Arc Browser / floating mode.');
    await toggleFloatingWindow(tab);
    return;
  }

  // 2. In standard Chromium (Chrome, Brave, Edge), attempt native side panel
  if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && tab?.windowId) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });

      // Arc Browser's Chromium backend creates a headless context without displaying any UI.
      // In Google Chrome, sidepanel.html is docked and visible to the user.
      const isVisible = await verifySidepanelVisibility();
      if (isVisible) {
        console.log('[OpenBUA] Native side panel is active and visible.');
        return;
      }

      // No active visible side panel found -> Arc Browser or unsupported side panel environment
      console.log('[OpenBUA] Side panel is not visible to user. Switching to Arc floating window.');
      isArcBrowser = true;
      chrome.storage?.local?.set({ isArcBrowser: true, panelDisplayMode: 'floating' });
    } catch (err) {
      console.log('[OpenBUA] Native sidePanel.open failed. Using floating window:', err);
      isArcBrowser = true;
      chrome.storage?.local?.set({ isArcBrowser: true, panelDisplayMode: 'floating' });
    }
  }

  // 3. Fallback: Open floating window flush with right edge
  await toggleFloatingWindow(tab);
}

// Configure on install / startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('[OpenBUA] Extension installed/updated.');
  ensureActionClickEnabled();

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

chrome.runtime.onStartup.addListener(() => {
  ensureActionClickEnabled();
});

// Toolbar action click listener (Always fired because openPanelOnActionClick is false)
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
  if (message.type === 'ARC_BROWSER_DETECTED' || message.type === 'HEADLESS_SIDEPANEL_FALLBACK') {
    isArcBrowser = true;
    chrome.storage?.local?.set({ isArcBrowser: true, panelDisplayMode: 'floating' });
    if (message.type === 'HEADLESS_SIDEPANEL_FALLBACK') {
      toggleFloatingWindow(sender.tab);
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'OPEN_OPENBUA') {
    openOpenBUA(sender.tab);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', timestamp: Date.now() });
    return true;
  }

  if (message.type === 'CAPTURE_VISIBLE_TAB') {
    const options: chrome.tabs.CaptureVisibleTabOptions = { format: 'png' };
    const callback = (dataUrl?: string) => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'Screenshot failed' });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    };

    if (typeof message.windowId === 'number') {
      chrome.tabs.captureVisibleTab(message.windowId, options, callback);
    } else {
      chrome.tabs.captureVisibleTab(options, callback);
    }
    return true;
  }
});

export {};
