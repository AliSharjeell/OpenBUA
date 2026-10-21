// Content-script logs go to the extension store, never the website's IndexedDB.
export function installContentTrace() {
  const emit = (type: string, data: unknown) => {
    try {
      void chrome.runtime.sendMessage({ type: "OPENBUA_TRACE", event: { type, data } }).catch(() => {});
    } catch {}
  };
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      emit(
        `console.${level}`,
        args.map(value => (value instanceof Error ? { message: value.message, stack: value.stack } : value))
      );
    };
  }
  globalThis.addEventListener("unhandledrejection", event => emit("runtime.rejection", String(event.reason)));
}
