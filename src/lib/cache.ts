import { cache as aniwatchCache } from "../config/cache.js";

export class Cache {
    static async set(key: string, value: any, TTL: number = 300, isJson: boolean = false) {
        const data = isJson ? JSON.stringify(value) : value;
        await aniwatchCache.getClient()?.set?.(key, data, "EX", TTL);
        return true;
    }

    static async get(key: string, isJson: boolean = false) {
        const data = (await aniwatchCache.getClient()?.get?.(key)) || null;
        if (data && isJson) {
            try {
                return JSON.parse(data);
            } catch {
                return data;
            }
        }
        return data;
    }

    static async del(key: string) {
        await (aniwatchCache.getClient() as any)?.del?.(key);
        return true;
    }
}
