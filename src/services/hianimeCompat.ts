/**
 * hianimeCompat.ts
 *
 * Fallback stream extractor.
 *
 * This runs ONLY when the primary native HiAnime library (hianime.getEpisodeSources)
 * fails. The call chain is:
 *   resolveHianimeStreamResponse  →  hianime.getEpisodeSources  [primary]
 *                                 →  extractCompatStreamingInfo  [fallback — this file]
 *
 * Strategy here (in order):
 *   1. AnimeKai watch API — /api/v2/anime/animekai/watch/:id (via self HTTP call)
 *      Uses MegaUp player; CDN is datacenter-friendly.
 *   2. Empty result — signals caller to show "no stream" UI.
 *
 * Kaido direct-scraping has been removed permanently.
 * The watching.onl CDN (Kaido HD-2) blocks Railway datacenter IPs unconditionally.
 */

import axios from "axios";

type StreamType = "sub" | "dub" | "raw";

export type CompatServer = {
    type: StreamType;
    data_id: string;
    server_id: string;
    serverName: string;
};

export type CompatStreamResults = {
    streamingLink: Array<{
        link: string;
        type: string;
        server: string;
        iframe: string;
    }>;
    tracks: Array<{
        file: string;
        label?: string;
        kind?: string;
        default?: boolean;
    }>;
    intro: { start: number; end: number } | null;
    outro: { start: number; end: number } | null;
    server: string;
    servers: CompatServer[];
};

/** Base URL to call our own API (avoids double-decode when calling back to self) */
const SELF_BASE = (() => {
    const explicit = process.env.ANIWATCH_API_SELF_URL || "";
    if (explicit) return explicit.replace(/\/+$/, "");
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || "";
    if (railwayDomain) return `https://${railwayDomain}`;
    const port = process.env.ANIWATCH_API_PORT || "4000";
    return `http://localhost:${port}`;
})();

const API_TIMEOUT = 12_000;

function ensureArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function pickM3U8(sources: unknown): string {
    for (const src of ensureArray<any>(sources)) {
        const u = String(src?.file || src?.url || "");
        if (u.includes(".m3u8") || u.includes("/hls/")) return u;
    }
    for (const src of ensureArray<any>(sources)) {
        const u = String(src?.file || src?.url || "");
        if (u) return u;
    }
    return "";
}

// ─── AnimeKai fallback ────────────────────────────────────────────────────────

/**
 * Attempts to stream from AnimeKai's watch API.
 * AnimeKai episode IDs look like: slug$ep=NUMBER$token=TOKEN
 * Only works if the caller has a mapped AnimeKai episode ID.
 */
async function fetchFromAnimeKai(
    episodeId: string,
    dubbed: boolean
): Promise<CompatStreamResults | null> {
    try {
        if (!episodeId.includes("$token=")) return null;

        const url =
            `${SELF_BASE}/api/v2/anime/animekai/watch/${encodeURIComponent(episodeId)}` +
            `?dub=${dubbed ? "1" : "0"}`;

        const { data } = await axios.get(url, { timeout: API_TIMEOUT });
        const entries: any[] = ensureArray(data?.results);
        if (entries.length === 0) return null;

        const entry = entries[0];
        const streamFile = pickM3U8(entry?.sources);
        const iframeUrl = String(entry?.url ?? "");

        if (!streamFile && !iframeUrl) return null;

        return {
            streamingLink: [{
                link: streamFile || "",
                type: "hls",
                server: String(entry?.name ?? "AnimeKai"),
                iframe: iframeUrl,
            }],
            tracks: ensureArray<any>(entry?.subtitles).map((t: any) => ({
                file: String(t?.url ?? t?.file ?? ""),
                label: t?.lang ?? t?.label ?? undefined,
                kind: "captions",
                default: false,
            })),
            intro: entry?.intro
                ? { start: Number(entry.intro[0] ?? entry.intro.start ?? 0), end: Number(entry.intro[1] ?? entry.intro.end ?? 0) }
                : null,
            outro: entry?.outro
                ? { start: Number(entry.outro[0] ?? entry.outro.start ?? 0), end: Number(entry.outro[1] ?? entry.outro.end ?? 0) }
                : null,
            server: String(entry?.name ?? "AnimeKai"),
            servers: entries.map((e: any) => ({
                type: (e?.isDub ? "dub" : "sub") as StreamType,
                data_id: String(e?.name ?? ""),
                server_id: String(e?.name ?? ""),
                serverName: String(e?.name ?? "AnimeKai"),
            })),
        };
    } catch {
        return null;
    }
}

// ─── Compat server list (used by /api/servers/:id) ───────────────────────────

/**
 * Returns server list. Since Kaido is gone, we return a static placeholder
 * that at least tells the frontend which servers are conceptually available.
 * The actual server list comes from hianime.getEpisodeServers() in the main route.
 */
export async function extractCompatServers(_episodeId: string): Promise<CompatServer[]> {
    // Return empty — the main router uses hianime.getEpisodeServers() directly.
    // If needed, we could call SELF_BASE/api/v2/hianime/episode/servers here.
    return [];
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Called as a FALLBACK when hianime.getEpisodeSources() fails.
 * 
 * Tries:
 *   1. AnimeKai (if episode ID has $token= format)
 *   2. Returns empty result
 */
export async function extractCompatStreamingInfo(
    id: string,
    name: string,
    type: StreamType,
    _fallback = false
): Promise<CompatStreamResults> {
    const empty = (): CompatStreamResults => ({
        streamingLink: [],
        tracks: [],
        intro: null,
        outro: null,
        server: name,
        servers: [],
    });

    const dubbed = type === "dub";

    // Try AnimeKai if the episode ID suggests it's an AnimeKai ID
    const akResult = await fetchFromAnimeKai(id, dubbed);
    if (akResult && (akResult.streamingLink[0]?.link || akResult.streamingLink[0]?.iframe)) {
        return akResult;
    }

    return empty();
}
