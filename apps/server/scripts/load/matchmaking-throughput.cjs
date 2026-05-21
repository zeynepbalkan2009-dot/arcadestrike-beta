const http = require("http");

const baseUrl = process.env.API_URL || "http://localhost:2567";
const requests = Number(process.env.LOAD_REQUESTS || 500);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 25);

let sent = 0;
let completed = 0;
let failed = 0;

function postJoin(i) {
  return new Promise(resolve => {
    const body = JSON.stringify({ wagerAmount: "1000000000000000000", currency: "PROMO", queueMode: "quick" });
    const req = http.request(`${baseUrl}/api/matchmaking/queue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: `Bearer load-test-${i}`,
      },
    }, res => {
      res.resume();
      res.on("end", () => {
        if (res.statusCode >= 500) failed++;
        completed++;
        resolve();
      });
    });
    req.on("error", () => {
      failed++;
      completed++;
      resolve();
    });
    req.end(body);
  });
}

async function worker() {
  while (sent < requests) {
    const next = sent++;
    await postJoin(next);
  }
}

Promise.all(Array.from({ length: concurrency }, worker)).then(() => {
  console.log(JSON.stringify({ type: "matchmaking_throughput", requests, concurrency, completed, failed }));
  process.exit(failed > 0 ? 1 : 0);
});
