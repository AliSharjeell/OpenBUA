import type { ChatSession } from '../types';

const SESSIONS = 'autoform_chat_sessions';
export const JOBS_KEY = 'openbua_parallel_jobs';
let queue: Promise<unknown> = Promise.resolve();

export function installWindowCoordinator() {
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!message?.type?.startsWith('OPENBUA_WINDOWS_')) return;
    // Content scripts and web pages cannot create workers or claim chats.
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) {
      reply({ error: 'Only OpenBUA extension pages may control task windows.' }); return;
    }
    const work = queue.then(() => handle(message, sender));
    queue = work.catch(() => {});
    work.then(value => reply({ value }), error => reply({ error: error.message }));
    return true;
  });
  chrome.windows.onRemoved.addListener(windowId => {
    queue = queue.then(async () => {
      const jobs = (await chrome.storage.local.get(JOBS_KEY))[JOBS_KEY] || {};
      for (const job of Object.values(jobs) as any[]) {
        if (job.windowId === windowId && !terminal(job.state)) { job.state = 'failed'; job.result = 'Worker window was closed.'; }
        if (job.ownerWindowId === windowId && !terminal(job.state)) { job.state = 'cancelled'; job.result = 'Parent window was closed.'; }
      }
      await chrome.storage.local.set({ [JOBS_KEY]: jobs });
    }).catch(console.error);
  });
}
const terminal = (state: string) => ['completed', 'failed', 'cancelled'].includes(state);

async function handle(message: any, sender: chrome.runtime.MessageSender) {
  if (message.type === 'OPENBUA_WINDOWS_SESSIONS') {
    let sessions: ChatSession[] = (await chrome.storage.local.get(SESSIONS))[SESSIONS] || [];
    const now = Date.now();
    const make = (title?: string): ChatSession => ({ id: `session_${crypto.randomUUID()}`, title: title || `Chat ${Math.max(0, ...sessions.map(s => Number(s.title.match(/^Chat (\d+)$/)?.[1]) || 0)) + 1}`, createdAt: now, updatedAt: now });
    let created: ChatSession | undefined;
    if (message.action === 'create') { created = make(message.title); sessions.push(created); }
    if (message.action === 'rename') sessions = sessions.map(s => s.id === message.sessionId ? { ...s, title: String(message.title).trim(), updatedAt: now } : s);
    if (message.action === 'delete') sessions = sessions.filter(s => s.id !== message.sessionId);
    if (!sessions.length) sessions.push(make());
    await chrome.storage.local.set({ [SESSIONS]: sessions });
    return { sessions, created };
  }
  if (message.type === 'OPENBUA_WINDOWS_CLAIM') {
    const windowId = message.windowId;
    await chrome.windows.get(windowId);
    const claims = (await chrome.storage.session.get('openbua_window_chats')).openbua_window_chats || {};
    const previous = claims[message.sessionId];
    if (previous !== undefined && previous !== windowId) {
      try { await chrome.windows.get(previous); return false; } catch { /* closed owner */ }
    }
    for (const key of Object.keys(claims)) if (claims[key] === windowId) delete claims[key];
    claims[message.sessionId] = windowId;
    await chrome.storage.session.set({ openbua_window_chats: claims });
    return true;
  }
  const jobs = (await chrome.storage.local.get(JOBS_KEY))[JOBS_KEY] || {};
  const ownerWindowId = message.ownerWindowId;
  const workerJobId = new URL(sender.url!).searchParams.get('job');
  if (workerJobId) {
    const job = jobs[workerJobId];
    if (!job || sender.tab?.windowId !== job.windowId) throw new Error('Worker ownership mismatch');
    if (message.type === 'OPENBUA_WINDOWS_WORKER_UPDATE') {
      if (!terminal(job.state)) {
        job.state = message.state;
        job.result = String(message.result || '').slice(-16000);
        await chrome.storage.local.set({ [JOBS_KEY]: jobs });
      }
      return job;
    }
    throw new Error('Workers cannot spawn additional task windows');
  }
  await chrome.windows.get(ownerWindowId);
  if (message.type === 'OPENBUA_WINDOWS_START') {
    const tasks = message.tasks;
    if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 3) throw new Error('Choose 1 to 3 independent tasks');
    const active = Object.values(jobs).filter((job: any) => job.ownerWindowId === ownerWindowId && !terminal(job.state));
    if (active.length + tasks.length > 3) throw new Error('At most 3 workers can run in this window. Check existing worker results first.');
    const started = [];
    for (const task of tasks) {
      if (!task.instruction?.trim()) throw new Error('Each worker needs a specific independent task');
      const url = new URL(task.url || 'https://www.google.com');
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Worker start URL must be HTTP or HTTPS');
      const id = crypto.randomUUID();
      const job: any = { id, ownerWindowId, sessionId: `worker_${id}`, parentSessionId: message.sessionId, task, settings: message.settings, documents: message.documents, authorization: message.authorization, state: 'starting', result: '', createdAt: Date.now() };
      jobs[id] = job;
      try {
        const win = await chrome.windows.create({ url: url.href, type: 'normal', focused: false });
        if (win.id === undefined) throw new Error('Chrome did not create a worker window');
        job.windowId = win.id;
        await chrome.storage.local.set({ [JOBS_KEY]: jobs });
        const worker = await chrome.tabs.create({ windowId: win.id, url: chrome.runtime.getURL(`worker.html?job=${id}&ownerWindowId=${win.id}`), active: false });
        if (worker.id) await chrome.tabs.update(worker.id, { autoDiscardable: false });
        started.push({ id, windowId: win.id, task: task.instruction });
      } catch (error: any) { job.state = 'failed'; job.result = error.message; started.push({ id, error: error.message }); }
    }
    // Prune old completed jobs and their sensitive snapshots; retain recent results.
    for (const job of Object.values(jobs) as any[]) if (terminal(job.state)) {
      delete job.settings; delete job.documents; delete job.authorization;
      if (Date.now() - job.createdAt > 86400000) delete jobs[job.id];
    }
    await chrome.storage.local.set({ [JOBS_KEY]: jobs });
    return started;
  }
  const owned = Object.values(jobs).filter((job: any) => job.ownerWindowId === ownerWindowId && job.parentSessionId === message.sessionId) as any[];
  if (message.type === 'OPENBUA_WINDOWS_CANCEL') {
    for (const job of owned) if (!terminal(job.state)) { job.state = 'cancelled'; job.result = 'Stopped by parent task.'; delete job.settings; delete job.documents; delete job.authorization; }
    await chrome.storage.local.set({ [JOBS_KEY]: jobs });
  }
  return owned.map(job => ({ id: job.id, windowId: job.windowId, task: job.task.instruction, state: job.state, result: job.result }));
}
