// All browser windows share Chrome's screenshot quota. Route UI requests through
// the background worker so every consumer uses this one queue.
let queue: Promise<unknown> = Promise.resolve();
let lastAttempt = 0;
let failedUntil = 0;

export function captureScheduled(windowId?: number, options: chrome.tabs.CaptureVisibleTabOptions = { format: 'jpeg', quality: 80 }, tabId?: number): Promise<string> {
  const run = queue.catch(() => {}).then(async () => {
    if (Date.now() < failedUntil) throw new Error('Screenshot capture is temporarily unavailable after repeated quota failures. Use form/page inspection instead of waiting or retrying screenshots.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const delay = Math.max(0, 650 - (Date.now() - lastAttempt));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastAttempt = Date.now();
      try {
        let targetUrl: string | undefined;
        if (tabId !== undefined) {
          const target = await chrome.tabs.get(tabId);
          if (target.windowId !== windowId) throw new Error('Screenshot target is outside the task window');
          targetUrl = target.url;
          // An active tab in an unfocused window can retain an older compositor
          // frame even while scripting reads its current DOM. Bring the task
          // window forward and wait for a paint before reading pixels.
          if (chrome.windows?.update && windowId !== undefined) await chrome.windows.update(windowId, { focused: true });
          await chrome.tabs.update(tabId, { active: true });
          if (chrome.scripting?.executeScript) {
            const paint = await chrome.scripting.executeScript({ target: { tabId }, func: () => new Promise<boolean>(resolve => {
              const timer = setTimeout(() => resolve(false), 1500);
              requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(document.visibilityState === 'visible'); }));
            }) });
            if (paint[0]?.result !== true) throw new Error('Screenshot target did not paint a visible frame; use DOM inspection');
          }
          const active = (await chrome.tabs.query({ windowId, active: true }))[0];
          if (active?.id !== tabId || active.url !== targetUrl) throw new Error('Screenshot target changed before capture');
        }
        const data = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Screenshot capture timed out. Use form/page inspection.')), 5000);
          const callback = (dataUrl?: string) => {
            clearTimeout(timer);
            const error = chrome.runtime.lastError?.message;
            if (error || !dataUrl) reject(new Error(error || 'Screenshot capture returned no image'));
            else resolve(dataUrl);
          };
          try {
            if (typeof windowId === 'number') chrome.tabs.captureVisibleTab(windowId, options, callback);
            else chrome.tabs.captureVisibleTab(options, callback);
          } catch (error) { clearTimeout(timer); reject(error); }
        });
        if (tabId !== undefined) {
          const active = (await chrome.tabs.query({ windowId, active: true }))[0];
          if (active?.id !== tabId || active.url !== targetUrl) throw new Error('Screenshot target changed during capture; image discarded');
        }
        return data;
      } catch (error: any) {
        const message = error?.message || String(error);
        const quota = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(message);
        if (attempt === 0 && (quota || /readback|internal error/i.test(message))) continue;
        if (quota) failedUntil = Date.now() + 30_000;
        throw new Error(`${message}. Use form/page inspection; do not loop on screenshot retries or long cooldown waits.`);
      }
    }
    throw new Error('Screenshot capture failed');
  });
  queue = run;
  return run;
}
