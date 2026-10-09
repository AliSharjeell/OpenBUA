// Each extension page owns one browser window. Focus changes never retarget a task.
let ownerWindowId: number | undefined;
export function bindBrowserWindow(id: number) {
  if (!Number.isInteger(id) || id < 0) throw new Error('Invalid browser window');
  ownerWindowId = id;
}
export function getBrowserWindowId() { return ownerWindowId; }
export async function initializeBrowserWindow() {
  if (typeof chrome === 'undefined' || !chrome.windows) return;
  const requested = new URL(location.href).searchParams.get('ownerWindowId');
  const win = requested !== null ? await chrome.windows.get(Number(requested)) : await chrome.windows.getCurrent();
  if (win.id !== undefined) bindBrowserWindow(win.id);
}
export async function assertOwnedTab(tabId: number) {
  if (ownerWindowId === undefined) return;
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId !== ownerWindowId) throw new Error('This tab belongs to another OpenBUA window. Use a tab in this task window.');
}
