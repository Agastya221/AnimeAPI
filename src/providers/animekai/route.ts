import { Hono } from "hono";
import { AnimeKai } from "./animekai.js";
import { cache } from "../../config/cache.js";

// TTL Constants mapped closely to desidub for consistency
const SHORT_TTL = 1800; // 30 mins (search, new-releases, recent)
const HOME_TTL = 3600; // 1 hr (spotlight, schedule)
const LONG_TTL = 86400; // 24 hrs (info, complete, genres)
const STREAMS_TTL = 1800; // 30 mins (streams)

export const animekaiRoutes = new Hono();

animekaiRoutes.get("/search/:query", async (c) => {
  const query = c.req.param("query");
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:search:${query}:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.search(query, page), key, SHORT_TTL);
  return c.json(data);
});

animekaiRoutes.get("/spotlight", async (c) => {
  const key = `ak:spotlight`;
  const data = await cache.getOrSet(() => AnimeKai.spotlight(), key, HOME_TTL);
  return c.json({ results: data });
});

animekaiRoutes.get("/schedule/:date", async (c) => {
  const date = c.req.param("date");
  const key = `ak:schedule:${date}`;
  const data = await cache.getOrSet(() => AnimeKai.schedule(date), key, HOME_TTL);
  return c.json({ results: data });
});

animekaiRoutes.get("/suggestions/:query", async (c) => {
  const query = c.req.param("query");
  const key = `ak:suggestions:${query}`;
  const data = await cache.getOrSet(() => AnimeKai.suggestions(query), key, SHORT_TTL);
  return c.json({ results: data });
});

animekaiRoutes.get("/recent-episodes", async (c) => {
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:recent-episodes:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.recentlyUpdated(page), key, SHORT_TTL);
  return c.json(data);
});

animekaiRoutes.get("/recent-added", async (c) => {
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:recent-added:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.recentlyAdded(page), key, SHORT_TTL);
  return c.json(data);
});

animekaiRoutes.get("/completed", async (c) => {
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:completed:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.latestCompleted(page), key, LONG_TTL);
  return c.json(data);
});

animekaiRoutes.get("/new-releases", async (c) => {
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:new-releases:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.newReleases(page), key, SHORT_TTL);
  return c.json(data);
});

animekaiRoutes.get("/movies", async (c) => {
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:movies:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.movies(page), key, LONG_TTL);
  return c.json(data);
});

animekaiRoutes.get("/tv", async (c) => {
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:tv:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.tv(page), key, LONG_TTL);
  return c.json(data);
});

animekaiRoutes.get("/ova", async (c) => {
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:ova:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.ova(page), key, LONG_TTL);
  return c.json(data);
});

animekaiRoutes.get("/ona", async (c) => {
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:ona:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.ona(page), key, LONG_TTL);
  return c.json(data);
});

animekaiRoutes.get("/specials", async (c) => {
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:specials:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.specials(page), key, LONG_TTL);
  return c.json(data);
});

animekaiRoutes.get("/genres", async (c) => {
  const key = `ak:genres`;
  const data = await cache.getOrSet(() => AnimeKai.genres(), key, LONG_TTL);
  return c.json({ results: data });
});

animekaiRoutes.get("/genre/:genre", async (c) => {
  const genre = c.req.param("genre");
  const page = parseInt(c.req.query("page") || "1") || 1;
  const key = `ak:genre-search:${genre}:${page}`;
  const data = await cache.getOrSet(() => AnimeKai.genreSearch(genre, page), key, LONG_TTL);
  return c.json(data);
});

animekaiRoutes.get("/info/:id?", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ message: "id is required" }, 400);
  const key = `ak:info:${id}`;
  const res = await cache.getOrSet(() => AnimeKai.info(id), key, LONG_TTL);
  if (!res) return c.json({ message: "Anime not found" }, 404);
  return c.json(res);
});

animekaiRoutes.get("/watch/:episodeId", async (c) => {
  const episodeId = c.req.param("episodeId");
  if (!episodeId) return c.json({ message: "episodeId is required" }, 400);
  const dubParam = c.req.query("dub");
  const subOrDub = (dubParam === "true" || dubParam === "1") ? "dub" : "softsub";
  
  const key = `ak:watch:${episodeId}:${subOrDub}`;
  
  const results = await cache.getOrSet(async () => {
    let streams = await AnimeKai.streams(episodeId, subOrDub);
    if (streams.length === 0) {
      const servers = await AnimeKai.fetchEpisodeServers(episodeId, subOrDub);
      streams = servers.map((server) => ({
        ...server,
        headers: {},
        subtitles: [],
        sources: [],
        isDub: subOrDub === "dub",
      }));
    }
    return streams;
  }, key, STREAMS_TTL);

  return c.json({ results });
});

animekaiRoutes.get("/servers/:episodeId", async (c) => {
  const episodeId = c.req.param("episodeId");
  if (!episodeId) return c.json({ message: "episodeId is required" }, 400);
  const dubParam = c.req.query("dub");
  const subOrDub = (dubParam === "true" || dubParam === "1") ? "dub" : "softsub";

  const key = `ak:servers:${episodeId}:${subOrDub}`;
  const servers = await cache.getOrSet(() => AnimeKai.fetchEpisodeServers(episodeId, subOrDub), key, STREAMS_TTL);

  return c.json({ servers });
});
