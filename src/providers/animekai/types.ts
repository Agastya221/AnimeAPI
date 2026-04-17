import { z } from "zod";

// ─── Paged Result Wrapper ────────────────────────────────────────────────────

export interface AnimeKaiPagedResult<T> {
  currentPage: number;
  hasNextPage: boolean;
  totalPages: number;
  results: T[];
}

// ─── Search Item ─────────────────────────────────────────────────────────────

export const animekaiSearchItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  image: z.string().optional(),
  japaneseTitle: z.string().optional().nullable(),
  type: z.string().optional(),
  sub: z.number().optional(),
  dub: z.number().optional(),
  episodes: z.number().optional(),
});

export type AnimeKaiSearchItem = z.infer<typeof animekaiSearchItemSchema>;

// ─── Related / Recommendation Item ───────────────────────────────────────────

export const animekaiRelatedItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  image: z.string().optional(),
  japaneseTitle: z.string().optional().nullable(),
  type: z.string().optional(),
  sub: z.number().optional(),
  dub: z.number().optional(),
  episodes: z.number().optional(),
  relationType: z.string().optional(),
});

export type AnimeKaiRelatedItem = z.infer<typeof animekaiRelatedItemSchema>;

// ─── Anime Info ───────────────────────────────────────────────────────────────

export const animekaiEpisodeSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  isFiller: z.boolean(),
  isSubbed: z.boolean(),
  isDubbed: z.boolean(),
  url: z.string(),
});

export const animekaiMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  japaneseTitle: z.string().optional().nullable(),
  image: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  url: z.string().optional(),
  totalEpisodes: z.number().optional(),
  status: z.string().optional(),
  season: z.string().optional(),
  duration: z.string().optional(),
  malId: z.string().optional(),
  anilistId: z.string().optional(),
  hasSub: z.boolean().optional(),
  hasDub: z.boolean().optional(),
  subCount: z.number().optional(),
  dubCount: z.number().optional(),
  subOrDub: z.enum(["sub", "dub", "both"]).optional(),
  genres: z.array(z.string()).optional(),
  recommendations: z.array(animekaiRelatedItemSchema).optional(),
  relations: z.array(animekaiRelatedItemSchema).optional(),
});

export const animekaiEpisodesSchema = z.object({
  id: z.string(),
  totalEpisodes: z.number(),
  subCount: z.number().optional(),
  dubCount: z.number().optional(),
  episodes: z.array(animekaiEpisodeSchema),
});

export const animekaiInfoSchema = animekaiMetaSchema.extend({
  totalEpisodes: z.number().optional(),
  episodes: z.array(animekaiEpisodeSchema),
});

export type AnimeKaiMeta = z.infer<typeof animekaiMetaSchema>;
export type AnimeKaiEpisodes = z.infer<typeof animekaiEpisodesSchema>;
export type AnimeKaiInfo = z.infer<typeof animekaiInfoSchema>;
export type AnimeKaiEpisode = AnimeKaiInfo["episodes"][number];

// ─── Episode Server ───────────────────────────────────────────────────────────

export interface AnimeKaiServer {
  name: string;
  url: string;
  intro: { start: number; end: number };
  outro: { start: number; end: number };
}
