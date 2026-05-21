const WebSocket = require("ws");

const url = process.env.WS_URL || "ws://localhost:2567";
const clients = Number(process.env.LOAD_CLIENTS || 100);
const durationMs = Number(process.env.LOAD_DURATION_MS || 30000);

let opened = 0;
let errors = 0;
const sockets = [];

for (let i = 0; i < clients; i++) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  socket.on("open", () => {
    opened++;
    socket.send(JSON.stringify({ type: "ping", seq: i, at: Date.now() }));
  });
  socket.on("error", () => {
    errors++;
  });
}

setTimeout(() => {
  for (const socket of sockets) socket.close();
  console.log(JSON.stringify({ type: "websocket_load", url, clients, opened, errors }));
  process.exit(errors > clients * 0.05 ? 1 : 0);
}, durationMs);
