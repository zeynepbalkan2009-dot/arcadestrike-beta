const Redis = require("ioredis");

const url = process.env.REDIS_URL;
if (!url) {
  console.error("REDIS_URL is required");
  process.exit(1);
}

const redis = new Redis(url);
const entries = Number(process.env.LOAD_REDIS_ENTRIES || 10000);
const key = `load:matchmaking:${Date.now()}`;

(async () => {
  const start = Date.now();
  const pipeline = redis.pipeline();
  for (let i = 0; i < entries; i++) {
    pipeline.zadd(key, Date.now() + i, `player-${i}`);
  }
  await pipeline.exec();
  const count = await redis.zcard(key);
  await redis.del(key);
  await redis.quit();
  console.log(JSON.stringify({ type: "redis_queue_stress", entries, count, durationMs: Date.now() - start }));
  process.exit(count === entries ? 0 : 1);
})().catch(async err => {
  console.error(err);
  await redis.quit();
  process.exit(1);
});
