import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";

export function createRelay({ token, port = 0, pollWaitMs = 8000 }) {
  let extension, waitingPoll;
  const clients = new Map(), pending = new Map();
  let queue = [];

  const online = () => Boolean(extension && Date.now() - extension.lastSeen < 12000);
  const clientOnline = id => clients.has(id) && Date.now() - clients.get(id) < 12000;
  const mcpConnected = () => [...clients.values()].some(at => Date.now() - at < 12000);

  const cancelClient = id => {
    for (const [commandId, item] of pending) {
      if (item.clientId === id) {
        clearTimeout(item.timer);
        pending.delete(commandId);
        item.resolve({ error: "MCP client disconnected. Queued commands were cancelled." });
      }
    }
    queue = queue.filter(command => command.clientId !== id);
  };

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      res.writeHead(403);
      return res.end();
    }
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || "")) {
      res.writeHead(403);
      return res.end();
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-OpenBUA-Client");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const supplied = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      res.writeHead(401);
      return res.end();
    }

    res.setHeader("Content-Type", "application/json");
    const reply = value => {
      if (!res.writableEnded) res.end(JSON.stringify(value));
    };

    try {
      const pathname = new URL(req.url, "http://127.0.0.1").pathname;
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 24000000) throw new Error("Request is too large.");
      }
      const body = raw ? JSON.parse(raw) : {};

      if (pathname === "/health") {
        return reply({
          ok: true,
          service: "openbua-relay",
          extensionConnected: online(),
          mcpConnected: mcpConnected(),
          codexConnected: mcpConnected(),
          antigravityConnected: mcpConnected(),
          claudeConnected: mcpConnected(),
        });
      }

      if (pathname === "/client") {
        const before = mcpConnected();
        if (body.remove) {
          clients.delete(body.id);
          cancelClient(body.id);
        } else {
          clients.set(body.id, Date.now());
        }
        for (const [id, at] of clients) {
          if (Date.now() - at > 60000) {
            clients.delete(id);
            cancelClient(id);
          }
        }
        if (before !== mcpConnected()) waitingPoll?.();
        return reply({ ok: true });
      }

      if (pathname === "/extension/poll") {
        const id = String(req.headers["x-openbua-client"] || "");
        if (!id) throw new Error("Missing bridge identity.");
        if (online() && extension.id !== id) {
          res.writeHead(409);
          return reply({ error: "Another OpenBUA browser bridge is connected. Disconnect it first." });
        }
        extension = { id, lastSeen: Date.now() };
        waitingPoll?.();

        let timer;
        const flush = () => {
          clearTimeout(timer);
          if (waitingPoll === flush) waitingPoll = undefined;
          for (const command of [...queue]) {
            if (command.clientId && !clientOnline(command.clientId)) cancelClient(command.clientId);
          }
          const commands = queue;
          queue = [];
          reply({ commands, mcpConnected: mcpConnected() });
        };

        if (queue.length) return flush();
        waitingPoll = flush;
        timer = setTimeout(flush, pollWaitMs);
        res.once("close", () => {
          clearTimeout(timer);
          if (waitingPoll === flush) waitingPoll = undefined;
        });
        return;
      }

      if (pathname === "/extension/result") {
        if (!online() || req.headers["x-openbua-client"] !== extension.id) {
          throw new Error("Stale browser bridge.");
        }
        const waiting = pending.get(body.id);
        if (waiting) {
          clearTimeout(waiting.timer);
          pending.delete(body.id);
          waiting.resolve(body);
        }
        return reply({ ok: true });
      }

      if (pathname === "/command") {
        if (!online()) {
          throw new Error("OpenBUA extension bridge is disconnected. Open OpenBUA Settings -> MCP and connect the bridge tab.");
        }
        if (body.clientId && !clientOnline(body.clientId)) {
          throw new Error("The MCP client lease expired. Reconnect before running tools.");
        }
        const id = crypto.randomUUID();
        const result = await new Promise(resolve => {
          const timer = setTimeout(() => {
            pending.delete(id);
            queue = queue.filter(command => command.id !== id);
            resolve({ error: "Browser response timed out. OpenBUA never replays a dispatched action automatically." });
          }, 45000);
          pending.set(id, { resolve, timer, clientId: body.clientId });
          queue.push({ id, op: body.op, args: body.args || {}, clientId: body.clientId });
          waitingPoll?.();
        });
        return reply(result);
      }

      res.writeHead(404);
      reply({ error: "Unknown route." });
    } catch (error) {
      res.statusCode = 400;
      reply({ error: error.message });
    }
  });

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(server.address().port));
      }),
    close: async () => {
      waitingPoll?.();
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.resolve({ error: "Bridge closed." });
      }
      pending.clear();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = createRelay(loadConfig());
  await relay.listen();
  console.log(`OpenBUA MCP Relay running on 127.0.0.1:${loadConfig().port}`);
  process.on("SIGTERM", () => void relay.close());
}
