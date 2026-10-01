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
  const extUrl = chrome.runtime.getURL(SIDEPANEL_PATH);

  // 1. Check if an existing OpenBUA floating window is already open
  try {
    const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup', 'normal'] });
    for (const win of allWindows) {
      if (win.tabs?.some((t) => t.url && (t.url.includes(chrome.runtime.id) || t.url.endsWith(SIDEPANEL_PATH)))) {
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

  if (tab?.windowId) {
    try {
      const currentWin = await chrome.windows.get(tab.windowId);
      if (currentWin.left !== undefined && currentWin.width !== undefined && currentWin.top !== undefined) {
        const winLeft = Math.max(0, currentWin.left);
        const winTop = Math.max(0, currentWin.top);
        left = Math.max(0, currentWin.left + currentWin.width - width);
        top = winTop;
        if (currentWin.height) {
          height = Math.max(600, currentWin.height);
        }
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

// Helper to open or focus the OpenBUA interface across all browsers
async function openOpenBUA(targetTab?: chrome.tabs.Tab) {
  let tab = targetTab;
  if (!tab) {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs[0];
    } catch {}
  }

  // 1. If already confirmed as Arc Browser or floating mode is preferred, go straight to floating window
  if (isArcBrowser) {
    await toggleFloatingWindow(tab);
    return;
  }

  // 2. Quick check on the current tab for Arc-specific CSS variables
  if (tab?.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('arc://') && !tab.url.startsWith('edge://')) {
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
        chrome.storage?.local?.set({ isArcBrowser: true });
        await toggleFloatingWindow(tab);
        return;
      }
    } catch {}
  }

  // 3. In standard Chromium (Chrome, Brave, Edge), attempt native side panel
  if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && tab?.windowId) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });

      // Arc Browser exposes a dummy chrome.sidePanel.open stub that resolves without doing anything.
      // In Google Chrome, chrome.runtime.getContexts returns the active SIDE_PANEL context.
      if (chrome.runtime?.getContexts) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        const contexts = await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
        if (contexts && contexts.length > 0) {
          // Native side panel is alive and rendering!
          return;
        }
        // No active SIDE_PANEL context found -> Arc Browser or unsupported side panel environment
        console.log('[OpenBUA] No active SIDE_PANEL context found after open. Switching to Arc floating window.');
        isArcBrowser = true;
        chrome.storage?.local?.set({ isArcBrowser: true });
      } else {
        return;
      }
    } catch (err) {
      console.log('[OpenBUA] Native sidePanel.open failed. Using floating window:', err);
      isArcBrowser = true;
      chrome.storage?.local?.set({ isArcBrowser: true });
    }
  }

  // 4. Fallback: Open floating window flush with right edge
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
  if (message.type === 'ARC_BROWSER_DETECTED') {
    isArcBrowser = true;
    chrome.storage?.local?.set({ isArcBrowser: true });
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
