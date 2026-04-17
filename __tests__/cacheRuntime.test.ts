import { describe, expect, test, vi } from "vitest";

vi.mock("ioredis", () => ({
  Redis: class MockRedis {
    status = "wait";
    on() {
      return this;
    }
    async get() {
      return null;
    }
    async set() {
      return "OK";
    }
    async ping() {
      return "PONG";
    }
    async quit() {
      return "OK";
    }
  },
}));

class FakeRedisClient {
  public status = "wait";
  private handlers = new Map<string, Array<(payload?: unknown) => void>>();

  on(event: string, handler: (payload?: unknown) => void) {
    const existing = this.handlers.get(event) || [];
    existing.push(handler);
    this.handlers.set(event, existing);
    return this;
  }

  emit(event: string, payload?: unknown) {
    for (const handler of this.handlers.get(event) || []) {
      handler(payload);
    }
  }

  async get() {
    return null;
  }

  async set() {
    return "OK";
  }

  async ping() {
    return "PONG";
  }

  async quit() {
    this.status = "end";
    return "OK";
  }
}

const redisCtor = async () => {
  const module = await import("../src/config/cache.ts");
  return module.AniwatchAPICache;
};

describe("AniwatchAPICache runtime status", () => {
  test("returns disabled when redis is not configured", async () => {
    const AniwatchAPICache = await redisCtor();
    const cache = new AniwatchAPICache({ redisUrl: null });

    const status = await cache.getStatus();

    expect(status.redis.configured).toBe(false);
    expect(status.redis.enabled).toBe(false);
    expect(status.redis.state).toBe("disabled");
    expect(status.redis.lastPingMs).toBeNull();
  });

  test("returns ready with ping latency when redis becomes ready", async () => {
    const AniwatchAPICache = await redisCtor();
    const client = new FakeRedisClient();
    const cache = new AniwatchAPICache({
      redisUrl: "redis://unit-test",
      redisFactory: () => client as any,
    });

    client.emit("connect");
    client.emit("ready");

    const status = await cache.getStatus({ refreshPing: true });

    expect(status.redis.configured).toBe(true);
    expect(status.redis.enabled).toBe(true);
    expect(status.redis.state).toBe("ready");
    expect(status.redis.lastPingMs).not.toBeNull();
  });

  test("preserves error state and lastError when redis emits an error", async () => {
    const AniwatchAPICache = await redisCtor();
    const client = new FakeRedisClient();
    const cache = new AniwatchAPICache({
      redisUrl: "redis://unit-test",
      redisFactory: () => client as any,
    });

    client.emit("error", new Error("redis down"));

    const status = await cache.getStatus();

    expect(status.redis.state).toBe("error");
    expect(status.redis.lastError).toContain("redis down");
  });
});
