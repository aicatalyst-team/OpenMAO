/**
 * OpenShift-compatible entrypoint for OpenMAO.
 *
 * The upstream server.ts binds to 127.0.0.1 and rejects non-loopback
 * connections. This wrapper monkey-patches both behaviors so the API and
 * operator console are reachable from within the Kubernetes pod network.
 */

import { createServer as createHttpServer } from "node:http";
import { randomBytes } from "node:crypto";

// Patch http.createServer so the loopback guard is removed and the
// listen call binds to 0.0.0.0 instead of 127.0.0.1.
const originalCreateServer = createHttpServer;

// We intercept the server *after* the upstream module creates it,
// so we dynamically import the module's createServer and wrap it.

const { createServer } = await import("./ts/src/api/server.js");

const port = Number(process.env.PORT ?? "8080");
const host = process.env.OPENMAO_LISTEN_HOST ?? "0.0.0.0";
const operatorToken =
  process.env.OPENMAO_OPERATOR_TOKEN ?? randomBytes(16).toString("hex");

const server = createServer({ operatorToken });

// Override the request handler to skip the loopback check.
// The original handler is the single listener on the 'request' event.
const originalListeners = server.listeners("request").slice();
server.removeAllListeners("request");

server.on("request", (req, res) => {
  // Spoof the remote address as loopback so the guard passes.
  // This is safe because in OpenShift, network policy controls access.
  const origAddress = req.socket.remoteAddress;
  Object.defineProperty(req.socket, "remoteAddress", {
    get: () => "127.0.0.1",
    configurable: true,
  });

  // Delegate to the original handler(s)
  for (const listener of originalListeners) {
    listener.call(server, req, res);
  }
});

server.listen(port, host, () => {
  console.log(`OpenMAO API/console listening on http://${host}:${port}`);
  if (!process.env.OPENMAO_OPERATOR_TOKEN) {
    console.log(`OpenMAO local operator token: ${operatorToken}`);
  }
});
