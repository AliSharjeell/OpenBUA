export interface TraceEvent {
  seq?: number;
  at: number;
  scope: string;
  type: string;
  runId?: string;
  taskId?: string;
  data: unknown;
}

let database: Promise<IDBDatabase> | undefined;

function db() {
  return (database ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("openbua_trace_v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("events", { keyPath: "seq", autoIncrement: true });
      request.result.createObjectStore("model", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

// Preserve complete outputs and image blocks. Never expose provider credentials.
export function redact(value: unknown): any {
  const seen = new WeakSet<object>();
  const visit = (item: unknown): any => {
    if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
    if (item instanceof Date) return item.toISOString();
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[circular reference]";
      seen.add(item);
      if (Array.isArray(item)) return item.map(visit);
      return Object.fromEntries(
        Object.entries(item).map(([key, val]) => [
          key,
          /^(api.?key|authorization|token|password|secret)$/i.test(key) ? "[redacted]" : visit(val),
        ])
      );
    }
    if (typeof item === "string") return item.replace(/\b(?:tp-[a-z0-9]{20,}|sk-[a-zA-Z0-9_-]{16,})\b/g, "[redacted]");
    return item;
  };
  return visit(value);
}

export async function appendTrace(event: Omit<TraceEvent, "at"> & { at?: number }) {
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("events", "readwrite");
      tx.objectStore("events").add({ ...event, at: event.at || Date.now(), data: redact(event.data) });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    try {
      await chrome.storage.local.set({ openbua_trace_error_v1: { at: Date.now(), error: String(error) } });
    } catch {}
  }
}

export async function readTrace(input: { after?: number; limit?: number; runId?: string; taskId?: string } = {}) {
  const database = await db();
  const limit = Math.min(100, Math.max(1, input.limit || 30));
  return new Promise<{ events: TraceEvent[]; nextCursor: number; hasMore: boolean }>((resolve, reject) => {
    const events: TraceEvent[] = [];
    let nextCursor = input.after || 0;
    const request = database.transaction("events").objectStore("events").openCursor(IDBKeyRange.lowerBound(nextCursor, true));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve({ events, nextCursor, hasMore: false });
      if (events.length >= limit) return resolve({ events, nextCursor, hasMore: true });
      const event = cursor.value as TraceEvent;
      nextCursor = event.seq!;
      if ((!input.runId || event.runId === input.runId) && (!input.taskId || event.taskId === input.taskId)) {
        events.push(event);
      }
      cursor.continue();
    };
  });
}

export async function modelRecord(action: "put" | "get" | "list", value?: any): Promise<any> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("model", action === "put" ? "readwrite" : "readonly");
    const store = tx.objectStore("model");
    const request = action === "put" ? store.put(value) : action === "get" ? store.get(value) : store.getAll();
    let result: any;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

const installed = new Set<string>();
export function installTraceCapture(scope: string) {
  if (installed.has(scope)) return;
  installed.add(scope);
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      void appendTrace({ scope, type: `console.${level}`, data: args });
    };
  }
  globalThis.addEventListener?.("error", (event: any) => void appendTrace({ scope, type: "runtime.error", data: event.error || event.message }));
  globalThis.addEventListener?.("unhandledrejection", (event: any) => void appendTrace({ scope, type: "runtime.rejection", data: event.reason }));
}
