import { Redis } from "ioredis";
import { env } from "./env.js";
import { log, logRateLimited } from "./logger.js";

type CacheEnvelope<T> = {
    __aniwatchCacheV: 1;
    value: T;
    expiresAt: number;
    staleUntil: number;
    createdAt: number;
};

type GetOrSetOptions = {
    staleWhileRevalidateSeconds?: number;
    allowStaleOnError?: boolean;
    ttlJitterRatio?: number;
};

type CacheRuntimeState = "disabled" | "connecting" | "ready" | "error";

type RedisRuntimeStatus = {
    configured: boolean;
    enabled: boolean;
    state: CacheRuntimeState;
    lastPingMs: number | null;
    lastError: string | null;
};

type CacheRuntimeStatus = {
    redis: RedisRuntimeStatus;
    cache: {
        localHotCacheEntries: number;
        defaultExpirySeconds: number;
        staleWhileRevalidateSeconds: number;
    };
};

type RedisClientLike = Pick<Redis, "get" | "set" | "quit" | "ping" | "on"> & {
    status?: string;
};

type CacheConstructorOptions = {
    redisUrl?: string | null;
    redisFactory?: (url: string) => RedisClientLike;
};

export class AniwatchAPICache {
    private static instance: AniwatchAPICache | null = null;

    private client: RedisClientLike | null;
    private configured = false;
    public enabled: boolean = false;
    private inflightFetches = new Map<string, Promise<unknown>>();
    private localHotCache = new Map<string, CacheEnvelope<unknown>>();
    private localHotCacheMaxEntries = 2000;
    private runtimeState: CacheRuntimeState = "disabled";
    private lastPingMs: number | null = null;
    private lastError: string | null = null;

    static enabled = false;
    // 5 mins, 5 * 60
    static DEFAULT_CACHE_EXPIRY_SECONDS = 300 as const;
    static CACHE_EXPIRY_HEADER_NAME = "Aniwatch-Cache-Expiry" as const;
    static DEFAULT_STALE_WHILE_REVALIDATE_SECONDS =
        env.ANIWATCH_API_STALE_WHILE_REVALIDATE;

    constructor(options: CacheConstructorOptions = {}) {
        const redisConnURL =
            options.redisUrl !== undefined
                ? options.redisUrl
                : env.ANIWATCH_API_REDIS_CONN_URL;
        const createClient =
            options.redisFactory ??
            ((url: string) => new Redis(url));

        this.configured = Boolean(redisConnURL);
        this.enabled = AniwatchAPICache.enabled = this.configured;
        this.runtimeState = this.enabled ? "connecting" : "disabled";
        this.client =
            this.enabled && redisConnURL
                ? createClient(String(redisConnURL))
                : null;

        if (this.client) {
            this.registerClientEvents(this.client);
        }
    }

    static getInstance() {
        if (!AniwatchAPICache.instance) {
            AniwatchAPICache.instance = new AniwatchAPICache();
        }
        return AniwatchAPICache.instance;
    }

    private registerClientEvents(client: RedisClientLike) {
        client.on("connect", () => {
            this.runtimeState = "connecting";
            this.lastError = null;
        });
        client.on("ready", () => {
            this.runtimeState = "ready";
            this.lastError = null;
            log.info("✅ Redis cache successfully connected and ready!");
        });
        client.on("error", (err: unknown) => {
            this.runtimeState = "error";
            const errMsg = err instanceof Error ? err.message : String(err || "Unknown redis error");
            this.lastError = errMsg;
            log.warn({ error: errMsg }, "⚠️ Redis connection error");
        });
        client.on("close", () => {
            this.runtimeState = this.enabled ? "connecting" : "disabled";
        });
        client.on("reconnecting", () => {
            this.runtimeState = "connecting";
            log.info("♻️ Redis is reconnecting...");
        });
    }

    getClient() {
        return this.client;
    }

    async refreshPing(): Promise<number | null> {
        if (!this.enabled || !this.client) return null;

        const start = Date.now();
        try {
            await this.client.ping();
            this.lastPingMs = Date.now() - start;
            if (this.runtimeState !== "error") {
                this.runtimeState = "ready";
            }
            return this.lastPingMs;
        } catch (err) {
            this.runtimeState = "error";
            this.lastError =
                err instanceof Error ? err.message : String(err || "Unknown redis error");
            return null;
        }
    }

    async getStatus(options: { refreshPing?: boolean } = {}): Promise<CacheRuntimeStatus> {
        if (options.refreshPing) {
            await this.refreshPing();
        }

        return {
            redis: {
                configured: this.configured,
                enabled: this.enabled,
                state: this.runtimeState,
                lastPingMs: this.lastPingMs,
                lastError: this.lastError,
            },
            cache: {
                localHotCacheEntries: this.localHotCache.size,
                defaultExpirySeconds: AniwatchAPICache.DEFAULT_CACHE_EXPIRY_SECONDS,
                staleWhileRevalidateSeconds:
                    AniwatchAPICache.DEFAULT_STALE_WHILE_REVALIDATE_SECONDS,
            },
        };
    }

    async waitUntilReady(timeoutMs: number = 1500): Promise<CacheRuntimeStatus> {
        if (!this.enabled || !this.client) {
            return this.getStatus();
        }

        const deadline = Date.now() + Math.max(0, timeoutMs);
        while (Date.now() < deadline) {
            if (this.runtimeState === "ready" || this.runtimeState === "error") {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        return this.getStatus({ refreshPing: this.runtimeState === "ready" });
    }

    /**
     * @param expirySeconds set to 300 (5 mins) by default
     */
    async getOrSet<T>(
        dataGetter: () => Promise<T>,
        key: string,
        expirySeconds: number = AniwatchAPICache.DEFAULT_CACHE_EXPIRY_SECONDS,
        options: GetOrSetOptions = {}
    ) {
        const staleWhileRevalidateSeconds =
            options.staleWhileRevalidateSeconds ??
            AniwatchAPICache.DEFAULT_STALE_WHILE_REVALIDATE_SECONDS;
        const allowStaleOnError = options.allowStaleOnError ?? true;
        const ttlJitterRatio = options.ttlJitterRatio ?? 0.08;
        const now = Date.now();

        const cached = await this.getCacheEnvelope<T>(key);
        if (cached && now < cached.expiresAt) {
            log.info({ key, isEnabled: this.enabled }, "Cache HIT (Fresh)");
            return cached.value;
        }

        if (cached && now < cached.staleUntil) {
            log.info({ key, isEnabled: this.enabled }, "Cache HIT (Stale) - Revalidating in background");
            void this.revalidateInBackground<T>(
                key,
                dataGetter,
                expirySeconds,
                staleWhileRevalidateSeconds,
                ttlJitterRatio
            );
            return cached.value;
        }

        log.info({ key, isEnabled: this.enabled }, "Cache MISS - Fetching new data");
        try {
            return await this.fetchAndSet<T>(
                key,
                dataGetter,
                expirySeconds,
                staleWhileRevalidateSeconds,
                ttlJitterRatio
            );
        } catch (err) {
            if (allowStaleOnError && cached && now < cached.staleUntil) {
                return cached.value;
            }
            throw err;
        }
    }

    private applyJitter(baseSeconds: number, ratio: number): number {
        if (baseSeconds <= 0) return 1;
        const clampedRatio = Math.max(0, Math.min(ratio, 0.4));
        const jitter = Math.round(baseSeconds * clampedRatio * Math.random());
        return Math.max(1, baseSeconds + jitter);
    }

    private upsertLocalHotCache<T>(key: string, envelope: CacheEnvelope<T>) {
        if (this.localHotCache.has(key)) {
            this.localHotCache.delete(key);
        }
        this.localHotCache.set(key, envelope as CacheEnvelope<unknown>);

        if (this.localHotCache.size <= this.localHotCacheMaxEntries) return;

        const oldestKey = this.localHotCache.keys().next().value;
        if (oldestKey) {
            this.localHotCache.delete(oldestKey);
        }
    }

    private parseEnvelope<T>(raw: string): CacheEnvelope<T> | null {
        try {
            const parsed = JSON.parse(raw) as
                | CacheEnvelope<T>
                | { value?: T; expiresAt?: number; staleUntil?: number }
                | T;

            if (
                parsed &&
                typeof parsed === "object" &&
                "__aniwatchCacheV" in parsed &&
                (parsed as CacheEnvelope<T>).__aniwatchCacheV === 1
            ) {
                const envelope = parsed as CacheEnvelope<T>;
                if (
                    typeof envelope.expiresAt === "number" &&
                    typeof envelope.staleUntil === "number"
                ) {
                    return envelope;
                }
            }

            // Backward compatibility for old cache payloads that were plain JSON values.
            const now = Date.now();
            return {
                __aniwatchCacheV: 1,
                value: parsed as T,
                expiresAt: now + 15 * 1000,
                staleUntil: now + 30 * 1000,
                createdAt: now,
            };
        } catch {
            return null;
        }
    }

    private async getCacheEnvelope<T>(key: string): Promise<CacheEnvelope<T> | null> {
        const local = this.localHotCache.get(key) as CacheEnvelope<T> | undefined;
        if (local) return local;

        if (!this.enabled || !this.client) return null;

        try {
            const raw = await this.client.get(key);
            if (!raw) return null;

            const envelope = this.parseEnvelope<T>(raw);
            if (!envelope) return null;

            this.upsertLocalHotCache(key, envelope);
            return envelope;
        } catch (err) {
            logRateLimited(`cache:get:${key}`, () => {
                log.warn({ key, err }, "cache redis get failed");
            });
            return null;
        }
    }

    private async setCacheEnvelope<T>(
        key: string,
        value: T,
        expirySeconds: number,
        staleWhileRevalidateSeconds: number,
        ttlJitterRatio: number
    ) {
        const ttlFreshSeconds = this.applyJitter(expirySeconds, ttlJitterRatio);
        const staleSeconds = Math.max(0, staleWhileRevalidateSeconds);
        const ttlStoreSeconds = Math.max(1, ttlFreshSeconds + staleSeconds);
        const now = Date.now();

        const envelope: CacheEnvelope<T> = {
            __aniwatchCacheV: 1,
            value,
            createdAt: now,
            expiresAt: now + ttlFreshSeconds * 1000,
            staleUntil: now + ttlStoreSeconds * 1000,
        };

        this.upsertLocalHotCache(key, envelope);

        if (!this.enabled || !this.client) return;

        try {
            await this.client.set(key, JSON.stringify(envelope), "EX", ttlStoreSeconds);
        } catch (err) {
            logRateLimited(`cache:set:${key}`, () => {
                log.warn({ key, err }, "cache redis set failed");
            });
        }
    }

    private async fetchAndSet<T>(
        key: string,
        dataGetter: () => Promise<T>,
        expirySeconds: number,
        staleWhileRevalidateSeconds: number,
        ttlJitterRatio: number
    ): Promise<T> {
        const existingInflight = this.inflightFetches.get(key) as
            | Promise<T>
            | undefined;
        if (existingInflight) return existingInflight;

        const task = (async () => {
            try {
                const fresh = await dataGetter();
                await this.setCacheEnvelope(
                    key,
                    fresh,
                    expirySeconds,
                    staleWhileRevalidateSeconds,
                    ttlJitterRatio
                );
                return fresh;
            } finally {
                this.inflightFetches.delete(key);
            }
        })();

        this.inflightFetches.set(key, task as Promise<unknown>);
        return task;
    }

    private async revalidateInBackground<T>(
        key: string,
        dataGetter: () => Promise<T>,
        expirySeconds: number,
        staleWhileRevalidateSeconds: number,
        ttlJitterRatio: number
    ) {
        if (this.inflightFetches.has(key)) return;
        try {
            await this.fetchAndSet(
                key,
                dataGetter,
                expirySeconds,
                staleWhileRevalidateSeconds,
                ttlJitterRatio
            );
        } catch {
            // SWR background refresh failures are intentionally silent.
        }
    }

    async delete(key: string) {
        this.localHotCache.delete(key);
        if (this.enabled && this.client) {
            try {
                await (this.client as any).del(key);
            } catch (err) {
                logRateLimited(`cache:del:${key}`, () => {
                    log.warn({ key, err }, "cache redis del failed");
                });
            }
        }
    }

    closeConnection() {
        this.client
            ?.quit()
            ?.then(() => {
                this.client = null;
                AniwatchAPICache.instance = null;
                this.runtimeState = "disabled";
                this.lastPingMs = null;
                log.info("aniwatch-api redis connection closed and cache instance reset");
            })
            .catch((err) => {
                this.runtimeState = "error";
                this.lastError =
                    err instanceof Error ? err.message : String(err || "Unknown redis error");
                log.error({ err }, "aniwatch-api error while closing redis connection");
            });
    }
}

export const cache = AniwatchAPICache.getInstance();
