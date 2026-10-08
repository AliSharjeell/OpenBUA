// All browser windows share Chrome's screenshot quota. Route UI requests through
// the background worker so every consumer uses this one queue.
let queue: Promise<unknown> = Promise.resolve();
let lastAttempt = 0;
let failedUntil = 0;

export function captureScheduled(windowId?: number, options: chrome.tabs.CaptureVisibleTabOptions = { format: 'jpeg', quality: 80 }): Promise<string> {
  const run = queue.catch(() => {}).then(async () => {
    if (Date.now() < failedUntil) throw new Error('Screenshot capture is temporarily unavailable after repeated quota failures. Use form/page inspection instead of waiting or retrying screenshots.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const delay = Math.max(0, 650 - (Date.now() - lastAttempt));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastAttempt = Date.now();
      try {
        return await new Promise<string>((resolve, reject) => {
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
