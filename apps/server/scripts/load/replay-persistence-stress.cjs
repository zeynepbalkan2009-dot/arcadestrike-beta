const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const inputs = Number(process.env.LOAD_REPLAY_INPUTS || 5000);
const matchId = `load-${Date.now()}`;

(async () => {
  const start = Date.now();
  const rows = [];
  for (let i = 0; i < inputs; i++) {
    rows.push({
      matchId,
      playerId: i % 2 === 0 ? "p1" : "p2",
      seq: Math.floor(i / 2),
      tick: i,
      payload: { seq: Math.floor(i / 2), tick: i, left: false, right: true, jump: false, attack: false, special: false },
    });
  }
  await prisma.replayInput.createMany({ data: rows, skipDuplicates: true });
  const count = await prisma.replayInput.count({ where: { matchId } });
  await prisma.replayInput.deleteMany({ where: { matchId } });
  await prisma.$disconnect();
  console.log(JSON.stringify({ type: "replay_persistence_stress", inputs, count, durationMs: Date.now() - start }));
  process.exit(count === inputs ? 0 : 1);
})().catch(async err => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
