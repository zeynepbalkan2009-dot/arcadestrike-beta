import Redis from "ioredis";
import { createLogger } from "../utils/logger";

const log = createLogger("redis");

export class RedisInfrastructure {
  readonly client?: Redis;
  readonly pub?: Redis;
  readonly sub?: Redis;

  constructor(private readonly url = process.env.REDIS_URL) {
    if (!url) {
      log.warn("REDIS_URL not set; using in-memory fallbacks");
      return;
    }

    const options = {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    };

    this.client = new Redis(url, options);
    this.pub = new Redis(url, options);
    this.sub = new Redis(url, options);

    for (const [name, redis] of Object.entries({ client: this.client, pub: this.pub, sub: this.sub })) {
      redis.on("error", err => log.error({ err, connection: name }, "Redis connection error"));
      redis.on("connect", () => log.info({ connection: name }, "Redis connected"));
    }
  }

  get enabled(): boolean {
    return Boolean(this.client && this.pub && this.sub);
  }

  async connect(): Promise<void> {
    if (!this.enabled) return;
    await Promise.all([this.client!.connect(), this.pub!.connect(), this.sub!.connect()]);
  }

  async disconnect(): Promise<void> {
    await Promise.allSettled([
      this.client?.quit(),
      this.pub?.quit(),
      this.sub?.quit(),
    ]);
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    if (!this.pub) return;
    await this.pub.publish(channel, JSON.stringify(payload));
  }

  async subscribe(channel: string, handler: (payload: any) => void): Promise<void> {
    if (!this.sub) return;
    await this.sub.subscribe(channel);
    this.sub.on("message", (receivedChannel, message) => {
      if (receivedChannel !== channel) return;
      try {
        handler(JSON.parse(message));
      } catch (err) {
        log.warn({ err, channel }, "Invalid Redis pub/sub message");
      }
    });
  }
}

export const redisInfrastructure = new RedisInfrastructure();
