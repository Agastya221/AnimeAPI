import * as cheerio from "cheerio";
import { MegaUp } from "./scraper/megaup.js";
import { Logger } from "../../utils/logger.js";
import { animekai as ANIMEKAI_BASE_URL } from "../../origins.js";
import { USER_AGENT } from "../animepahe/scraper/index.js";
import { fetcher } from "../../lib/fetcher.js";
import type {
  AnimeKaiEpisode,
  AnimeKaiEpisodes,
  AnimeKaiInfo,
  AnimeKaiMeta,
  AnimeKaiPagedResult,
  AnimeKaiSearchItem,
  AnimeKaiServer,
} from "./types.js";

type AnimeKaiMetaInternal = AnimeKaiMeta & {
  aniId?: string;
};

type EpisodeAvailability = {
  hasSub?: boolean;
  hasDub?: boolean;
  subCount?: number;
  dubCount?: number;
};

export class AnimeKai {
  private static baseUrl = ANIMEKAI_BASE_URL;

  private static headers(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Connection: "keep-alive",
      Accept: "text/html, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.5",
      "Sec-GPC": "1",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      Priority: "u=0",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      Referer: `${this.baseUrl}/`,
    };
  }

  private static ajaxHeaders(referer: string): Record<string, string> {
    return {
      ...this.headers(),
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer,
    };
  }

  private static async request(url: string, detectCf: boolean = true): Promise<string> {
    const res = await fetcher(url, detectCf, "animekai", { headers: this.headers() });
    if (!res) {
      Logger.error(`[AnimeKai] Fetch returned undefined for ${url}`);
      throw new Error(`[AnimeKai] Fetch returned undefined for ${url}`);
    }

    Logger.info(`[AnimeKai] HTTP ${res.status} for ${url} (${res.text.length} chars)`);

    // Check for non-OK status (CF challenge pages return 403/503)
    if (res.status < 200 || res.status >= 400) {
      Logger.error(`[AnimeKai] HTTP ${res.status} for ${url}`);
      throw new Error(`[AnimeKai] HTTP ${res.status} for ${url}`);
    }

    let text = res.text;

    // Detect CF challenge pages that sneak through with 200 status
    const cfSignatures = ['Just a moment', 'challenge-form', '__cf_chl_tk', 'Attention Required'];
    if (cfSignatures.some(sig => text.includes(sig))) {
      Logger.error(`[AnimeKai] CF challenge detected in response body for ${url}`);
      throw new Error(`[AnimeKai] CF challenge in response for ${url}`);
    }

    // Try to parse JSON-wrapped HTML responses (common for AJAX endpoints)
    if (text.trim().startsWith("{")) {
      try {
        const json = JSON.parse(text);
        // Handle result.html or just result
        text = json.result?.html || json.result || text;
      } catch (e) {
        // Fallback to raw text
      }
    }
    return typeof text === "string" ? text : JSON.stringify(text);
  }

  // ─── Paginated Card Scraper ──────────────────────────────────────────────────

  private static async scrapeCardPage(url: string): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    try {
      const html = await this.request(url);
      const $ = cheerio.load(html);

      const pagination = $("ul.pagination");
      const currentPage =
        parseInt(pagination.find(".page-item.active span.page-link").text().trim()) || 0;

      const nextPageHref = pagination
        .find(".page-item.active")
        .next()
        .find("a.page-link")
        .attr("href");
      const nextPageVal = nextPageHref?.split("page=")[1];
      const hasNextPage = !!nextPageVal && nextPageVal !== "";

      const lastPageHref = pagination.find(".page-item:last-child a.page-link").attr("href");
      const lastPageVal = lastPageHref?.split("page=")[1];
      const totalPages =
        lastPageVal && lastPageVal !== "" ? parseInt(lastPageVal) || 0 : currentPage;

      const results: AnimeKaiSearchItem[] = [];
      $(".aitem").each((_, ele) => {
        const card = $(ele);
        const atag = card.find("div.inner > a");
        const id = atag.attr("href")?.replace("/watch/", "") || "";
        const type = card.find(".info").children().last().text().trim();

        results.push({
          id,
          title: atag.text().trim(),
          url: `${this.baseUrl}${atag.attr("href")}`,
          image: card.find("img").attr("data-src") || card.find("img").attr("src"),
          japaneseTitle: card.find("a.title").attr("data-jp")?.trim(),
          type,
          sub: parseInt(card.find(".info span.sub").text()) || 0,
          dub: parseInt(card.find(".info span.dub").text()) || 0,
          episodes:
            parseInt(card.find(".info").children().eq(-2).text().trim()) ||
            parseInt(card.find(".info span.sub").text()) ||
            0,
        });
      });

      return {
        currentPage: results.length === 0 ? 0 : currentPage,
        hasNextPage: results.length === 0 ? false : hasNextPage,
        totalPages: results.length === 0 ? 0 : totalPages,
        results,
      };
    } catch (err) {
      Logger.error(`AnimeKai scrapeCardPage error for ${url}: ${String(err)}`);
      return { currentPage: 0, hasNextPage: false, totalPages: 0, results: [] };
    }
  }

  // ─── Browsing Endpoints ──────────────────────────────────────────────────────

  static async search(query: string, page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(
      `${this.baseUrl}/browser?keyword=${encodeURIComponent(query.replace(/[\W_]+/g, "+"))}&page=${page}`
    );
  }

  static async latest(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    return this.recentlyUpdated(page);
  }

  static async recentlyUpdated(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/updates?page=${page}`);
  }

  static async latestCompleted(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/completed?page=${page}`);
  }

  static async newReleases(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/new-releases?page=${page}`);
  }

  static async recentlyAdded(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/recent?page=${page}`);
  }

  static async movies(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/movie?page=${page}`);
  }

  static async tv(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/tv?page=${page}`);
  }

  static async ova(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/ova?page=${page}`);
  }

  static async ona(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/ona?page=${page}`);
  }

  static async specials(page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/special?page=${page}`);
  }

  static async genreSearch(genre: string, page: number = 1): Promise<AnimeKaiPagedResult<AnimeKaiSearchItem>> {
    if (!genre) throw new Error("genre is required");
    if (page <= 0) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/genres/${genre}?page=${page}`);
  }

  // ─── Genres ─────────────────────────────────────────────────────────────────

  static async genres(): Promise<string[]> {
    try {
      const html = await this.request(`${this.baseUrl}/home`);
      const $ = cheerio.load(html);
      const results: string[] = [];
      $("#menu").find("ul.c4 li a").each((_, ele) => {
        results.push($(ele).text().trim().toLowerCase());
      });
      return results;
    } catch (err) {
      Logger.error(`AnimeKai genres error: ${String(err)}`);
      return [];
    }
  }

  // ─── Schedule ────────────────────────────────────────────────────────────────

  static async schedule(date: string = new Date().toISOString().split("T")[0]!): Promise<any[]> {
    try {
      const tz = 5.5;
      const timestamp = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
      const url = `${this.baseUrl}/ajax/schedule/items?tz=${tz}&time=${timestamp}`;
      const html = await this.request(url);

      const $ = cheerio.load(typeof html === "string" ? html : "");
      const results: any[] = [];
      $("ul li").each((_, ele) => {
        const card = $(ele);
        const titleElement = card.find("span.title");
        results.push({
          id: card.find("a").attr("href")?.split("/")[2],
          title: titleElement.text().trim(),
          japaneseTitle: titleElement.attr("data-jp"),
          airingTime: card.find("span.time").text().trim(),
          airingEpisode: card.find("span").last().text().trim().replace("EP ", ""),
        });
      });
      return results;
    } catch (err) {
      Logger.error(`AnimeKai schedule error: ${String(err)}`);
      return [];
    }
  }

  // ─── Spotlight ───────────────────────────────────────────────────────────────

  static async spotlight(): Promise<any[]> {
    try {
      const html = await this.request(`${this.baseUrl}/home`);
      const $ = cheerio.load(html);
      const results: any[] = [];
      $("div.swiper-wrapper > div.swiper-slide").each((_, el) => {
        const card = $(el);
        const titleElement = card.find("div.detail > p.title");
        const id = card.find("div.swiper-ctrl > a.btn").attr("href")?.replace("/watch/", "");
        const style = card.attr("style") || "";
        const banner = style.match(/background-image:\s*url\(["']?(.+?)["']?\)/)?.[1] || null;

        results.push({
          id,
          title: titleElement.text().trim(),
          japaneseTitle: titleElement.attr("data-jp"),
          banner,
          url: `${this.baseUrl}/watch/${id}`,
          type: card.find("div.detail > div.info").children().eq(-2).text().trim(),
          genres: card
            .find("div.detail > div.info")
            .children()
            .last()
            .text()
            .trim()
            .split(",")
            .map((g) => g.trim()),
          releaseDate: card
            .find('div.detail > div.mics > div:contains("Release")')
            .children("span")
            .text()
            .trim(),
          quality: card
            .find('div.detail > div.mics > div:contains("Quality")')
            .children("span")
            .text()
            .trim(),
          sub: parseInt(card.find("div.detail > div.info > span.sub").text().trim()) || 0,
          dub: parseInt(card.find("div.detail > div.info > span.dub").text().trim()) || 0,
          description: card.find("div.detail > p.desc").text().trim(),
        });
      });
      return results;
    } catch (err) {
      Logger.error(`AnimeKai spotlight error: ${String(err)}`);
      return [];
    }
  }

  // ─── Search Suggestions ──────────────────────────────────────────────────────

  static async suggestions(query: string): Promise<any[]> {
    try {
      const url = `${this.baseUrl}/ajax/anime/search?keyword=${encodeURIComponent(query.replace(/[\W_]+/g, "+"))}`;
      const htmlContent = await this.request(url);
      const $ = cheerio.load(typeof htmlContent === "string" ? htmlContent : "");
      const results: any[] = [];
      $("a.aitem").each((_, el) => {
        const card = $(el);
        const titleElement = card.find(".title");
        const id = card.attr("href")?.split("/")[2];
        results.push({
          id,
          title: titleElement.text().trim(),
          url: `${this.baseUrl}/watch/${id}`,
          japaneseTitle: titleElement.attr("data-jp") || null,
          image: card.find(".poster img").attr("src"),
          type: card.find(".info").children().eq(-3).text().trim(),
          year: card.find(".info").children().eq(-2).text().trim(),
          sub: parseInt(card.find(".info span.sub").text()) || 0,
          dub: parseInt(card.find(".info span.dub").text()) || 0,
          episodes: parseInt(card.find(".info").children().eq(-4).text().trim()) || 0,
        });
      });
      return results;
    } catch (err) {
      Logger.error(`AnimeKai suggestions error: ${String(err)}`);
      return [];
    }
  }

  // ─── Anime Meta / Episodes ───────────────────────────────────────────────────

  private static parseAvailability($: cheerio.CheerioAPI): EpisodeAvailability {
    const hasSub = $(".entity-scroll > .info > span.sub").length > 0;
    const hasDub = $(".entity-scroll > .info > span.dub").length > 0;
    const subCount = parseInt($(".entity-scroll > .info > span.sub").text()) || 0;
    const dubCount = parseInt($(".entity-scroll > .info > span.dub").text()) || 0;

    return {
      hasSub,
      hasDub,
      subCount,
      dubCount,
    };
  }

  private static toSubOrDub(availability: EpisodeAvailability): "sub" | "dub" | "both" {
    if (availability.hasSub && availability.hasDub) return "both";
    if (availability.hasDub) return "dub";
    return "sub";
  }

  private static parseMetaDocument(animeSlug: string, html: string): AnimeKaiMetaInternal {
    const $ = cheerio.load(html);
    const availability = this.parseAvailability($);

    const meta: AnimeKaiMetaInternal = {
      id: animeSlug,
      title: $(".entity-scroll > .title").text().trim(),
      japaneseTitle: $(".entity-scroll > .title").attr("data-jp")?.trim(),
      image: $("div.poster > div > img").attr("src"),
      description: $(".entity-scroll > .desc").text().trim(),
      type: $(".entity-scroll > .info")
        .children()
        .last()
        .text()
        .toUpperCase(),
      url: `${this.baseUrl}/watch/${animeSlug}`,
      hasSub: availability.hasSub,
      hasDub: availability.hasDub,
      subCount: availability.subCount,
      dubCount: availability.dubCount,
      subOrDub: this.toSubOrDub(availability),
      aniId: $(".rate-box#anime-rating").attr("data-id") || undefined,
    };

    $(".entity-scroll > .detail div").each(function () {
      const text = $(this).text().trim();
      if (text.startsWith("Genres:")) {
        meta.genres = text
          .replace("Genres:", "")
          .split(",")
          .map((g: string) => g.trim());
      }
    });

    meta.status = $(".entity-scroll > .detail")
      .find("div:contains('Status') > span")
      .text()
      .trim();
    meta.season = $(".entity-scroll > .detail")
      .find("div:contains('Premiered') > span")
      .text()
      .trim();
    meta.duration = $(".entity-scroll > .detail")
      .find("div:contains('Duration') > span")
      .text()
      .trim();

    $(".entity-scroll > .detail div")
      .filter((_, el) => $(el).text().includes("Links:"))
      .find("a")
      .each((_, el) => {
        const href = $(el).attr("href") ?? "";
        if (href.includes("myanimelist")) {
          meta.malId = href.match(/anime\/(\d+)/)?.[1];
        }
        if (href.includes("anilist")) {
          meta.anilistId = href.match(/anime\/(\d+)/)?.[1];
        }
      });

    meta.recommendations = [];
    $("section.sidebar-section:not(#related-anime) .aitem-col .aitem").each((_, ele) => {
      const aTag = $(ele);
      const recId = aTag.attr("href")?.replace("/watch/", "") ?? "";
      meta.recommendations!.push({
        id: recId,
        title: aTag.find(".title").text().trim(),
        url: `${this.baseUrl}${aTag.attr("href")}`,
        image:
          aTag.attr("style")?.match(/background-image:\s*url\('(.+?)'\)/)?.[1] ??
          aTag.find("img").attr("src"),
        japaneseTitle: aTag.find(".title").attr("data-jp")?.trim(),
        type: aTag.find(".info").children().last().text().trim(),
        sub: parseInt(aTag.find(".info span.sub").text()) || 0,
        dub: parseInt(aTag.find(".info span.dub").text()) || 0,
        episodes:
          parseInt(aTag.find(".info").children().eq(-2).text().trim()) ||
          parseInt(aTag.find(".info span.sub").text()) ||
          0,
      });
    });

    meta.relations = [];
    $("section#related-anime .aitem-col a.aitem").each((_, el) => {
      const aTag = $(el);
      const infoBox = aTag.find(".info");
      const relId = aTag.attr("href")?.replace("/watch/", "") ?? "";
      const bolds = infoBox.find("span > b");
      let episodes = 0;
      let type = "";
      let relationType = "";
      bolds.each((_, b) => {
        const text = $(b).text().trim();
        if ($(b).hasClass("text-muted")) {
          relationType = text;
        } else if (/^\d+$/.test(text)) {
          episodes = parseInt(text);
        } else {
          type = text;
        }
      });
      meta.relations!.push({
        id: relId,
        title: aTag.find(".title").text().trim(),
        url: `${this.baseUrl}${aTag.attr("href")}`,
        image: aTag.attr("style")?.match(/background-image:\s*url\('(.+?)'\)/)?.[1],
        japaneseTitle: aTag.find(".title").attr("data-jp")?.trim(),
        type: type.toUpperCase(),
        sub: parseInt(infoBox.find(".sub").text()) || 0,
        dub: parseInt(infoBox.find(".dub").text()) || 0,
        relationType,
        episodes,
      });
    });

    return meta;
  }

  private static toPublicMeta(meta: AnimeKaiMetaInternal | null): AnimeKaiMeta | null {
    if (!meta) return null;
    const { aniId, ...publicMeta } = meta;
    return publicMeta;
  }

  static async meta(id: string): Promise<AnimeKaiMeta | null> {
    const meta = await this.metaInternal(id);
    return this.toPublicMeta(meta);
  }

  static async metaInternal(id: string): Promise<AnimeKaiMetaInternal | null> {
    try {
      const animeSlug = id.split("$")[0]!;
      const html = await this.request(`${this.baseUrl}/watch/${animeSlug}`);
      return this.parseMetaDocument(animeSlug, html);
    } catch (err) {
      Logger.error(`AnimeKai meta error: ${String(err)}`);
      return null;
    }
  }

  private static async fetchEpisodesHtml(animeSlug: string, aniId: string): Promise<string> {
    const episodesToken = await MegaUp.generateToken(aniId);
    const episodesRes = await fetcher(
      `${this.baseUrl}/ajax/episodes/list?ani_id=${aniId}&_=${episodesToken}`,
      true,
      "animekai",
      {
        headers: {
          ...this.headers(),
          "X-Requested-With": "XMLHttpRequest",
          Referer: `${this.baseUrl}/watch/${animeSlug}`,
        },
      }
    );

    if (!episodesRes?.success) {
      throw new Error("Episodes fetch failed");
    }

    const epData = JSON.parse(episodesRes.text);
    return typeof epData.result === "string" ? epData.result : "";
  }

  private static buildEpisodePayload(
    animeSlug: string,
    epHtml: string,
    availability: EpisodeAvailability = {}
  ): AnimeKaiEpisodes {
    const $$ = cheerio.load(epHtml);
    const episodes: AnimeKaiEpisode[] = [];
    const totalEpisodes = $$("div.eplist > ul > li").length;

    $$("div.eplist > ul > li > a").each((_, el) => {
      const numAttr = $$(el).attr("num") || "0";
      const tokenAttr = $$(el).attr("token") || "";
      const number = parseInt(numAttr);
      const isSubbed =
        availability.subCount !== undefined
          ? number <= availability.subCount
          : Boolean(availability.hasSub);
      const isDubbed =
        availability.dubCount !== undefined
          ? number <= availability.dubCount
          : Boolean(availability.hasDub);

      episodes.push({
        id: `${animeSlug}$ep=${numAttr}$token=${tokenAttr}`,
        number,
        title: $$(el).children("span").text().trim(),
        isFiller: $$(el).hasClass("filler"),
        isSubbed,
        isDubbed,
        url: `${this.baseUrl}/watch/${animeSlug}${$$(el).attr("href")}ep=${numAttr}`,
      });
    });

    return {
      id: animeSlug,
      totalEpisodes,
      subCount: availability.subCount,
      dubCount: availability.dubCount,
      episodes,
    };
  }

  static async episodes(
    id: string,
    options: { aniId?: string | null; availability?: EpisodeAvailability } = {}
  ): Promise<AnimeKaiEpisodes | null> {
    try {
      const animeSlug = id.split("$")[0]!;
      const aniId = options.aniId || null;
      if (!aniId) {
        Logger.warn(`[AnimeKai] Missing aniId for episodes lookup: ${animeSlug}`);
        return null;
      }

      const epHtml = await this.fetchEpisodesHtml(animeSlug, aniId);
      return this.buildEpisodePayload(animeSlug, epHtml, options.availability);
    } catch (err) {
      Logger.error(`AnimeKai episodes error: ${String(err)}`);
      return null;
    }
  }

  // ─── Anime Info ──────────────────────────────────────────────────────────────

  static async info(id: string): Promise<AnimeKaiInfo | null> {
    try {
      const meta = await this.metaInternal(id);
      if (!meta) return null;

      const episodes = await this.episodes(id, {
        aniId: meta.aniId,
        availability: {
          hasSub: meta.hasSub,
          hasDub: meta.hasDub,
          subCount: meta.subCount,
          dubCount: meta.dubCount,
        },
      });

      const publicMeta = this.toPublicMeta(meta);
      if (!publicMeta) return null;

      return {
        ...publicMeta,
        totalEpisodes:
          episodes?.totalEpisodes ??
          (Math.max(meta.subCount || 0, meta.dubCount || 0) || undefined),
        episodes: episodes?.episodes || [],
      };
    } catch (err) {
      Logger.error(`AnimeKai info error: ${String(err)}`);
      return null;
    }
  }

  // ─── Episode Servers ─────────────────────────────────────────────────────────

  static async fetchEpisodeServers(
    episodeId: string,
    subOrDub: "softsub" | "dub" = "softsub"
  ): Promise<AnimeKaiServer[]> {
    try {
      const animeSlug = episodeId.split("$ep=")[0]?.split("$token=")[0] ?? "";
      const token = episodeId.split("$token=")[1];
      if (!token) return [];

      const ajaxToken = await MegaUp.generateToken(token);
      const url = `${this.baseUrl}/ajax/links/list?token=${token}&_=${ajaxToken}`;
      const serverHtml = await this.request(url);

      if (typeof serverHtml !== "string") return [];

      const $ = cheerio.load(serverHtml);
      const servers: AnimeKaiServer[] = [];

      const serverItems = $(`.server-items.lang-group[data-id="${subOrDub}"] .server`);

      await Promise.all(
        serverItems.toArray().map(async (server) => {
          const lid = $(server).attr("data-lid");
          if (!lid) return;

          const viewToken = await MegaUp.generateToken(lid);
          const viewRes = await fetcher(
            `${this.baseUrl}/ajax/links/view?id=${lid}&_=${viewToken}`,
            true,
            "animekai",
            { headers: this.ajaxHeaders(`${this.baseUrl}/watch/${animeSlug}`) }
          );
          if (!viewRes?.success) return;
          const viewData = JSON.parse(viewRes.text);
          const decoded = await MegaUp.decodeIframeData(viewData.result);

          servers.push({
            name: `megaup ${$(server).text().trim()}`.toLowerCase(),
            url: decoded.url,
            intro: {
              start: decoded.skip.intro[0],
              end: decoded.skip.intro[1],
            },
            outro: {
              start: decoded.skip.outro[0],
              end: decoded.skip.outro[1],
            },
          });
        })
      );

      return servers;
    } catch (err) {
      Logger.error(`AnimeKai fetchEpisodeServers error: ${String(err)}`);
      return [];
    }
  }

  // ─── Streams ─────────────────────────────────────────────────────────────────

  static async streams(
    episodeId: string,
    subOrDub: "softsub" | "dub" = "softsub"
  ): Promise<any[]> {
    try {
      const animeSlug = episodeId.split("$ep=")[0]?.split("$token=")[0] ?? "";
      const token = episodeId.split("$token=")[1];
      if (!token) return [];

      const ajaxToken = await MegaUp.generateToken(token);
      const serversUrl = `${this.baseUrl}/ajax/links/list?token=${token}&_=${ajaxToken}`;
      const serverHtml = await this.request(serversUrl);

      if (typeof serverHtml !== "string") return [];

      const $ = cheerio.load(serverHtml);
      const results: any[] = [];

      const langGroups =
        subOrDub === "dub"
          ? [".server-items.lang-group[data-id='dub']"]
          : [".server-items.lang-group[data-id='softsub']", ".lang-group[data-id='softsub']"];

      const seen = new Set<string>();
      for (const group of langGroups) {
        const isDub = group.includes("[data-id='dub']");
        const serverItems = $(`${group} .server`);

        for (const item of serverItems.toArray()) {
          const lid = $(item).attr("data-lid");
          if (!lid || seen.has(lid)) continue;
          seen.add(lid);

          try {
            const viewToken = await MegaUp.generateToken(lid);
            const viewUrl = `${this.baseUrl}/ajax/links/view?id=${lid}&_=${viewToken}`;
            const viewRes = await fetcher(viewUrl, true, "animekai", {
              headers: this.ajaxHeaders(`${this.baseUrl}/watch/${animeSlug}`),
            });
            if (!viewRes?.success) continue;
            const viewData = JSON.parse(viewRes.text);

            const decoded = await MegaUp.decodeIframeData(viewData.result);
            const entryBase = {
              name: `MegaUp ${$(item).text().trim()}${isDub ? " (Dub)" : ""}`,
              url: decoded.url,
              intro: decoded.skip.intro,
              outro: decoded.skip.outro,
              isDub,
            };

            try {
              const videoSources = await MegaUp.extract(decoded.url);
              results.push({
                ...entryBase,
                ...videoSources,
              });
            } catch (extractErr) {
              Logger.warn(`AnimeKai extract failed for ${decoded.url}; preserving iframe fallback. ${String(extractErr)}`);
              results.push({
                ...entryBase,
                headers: {},
                subtitles: [],
                sources: [],
              });
            }
          } catch (serverErr) {
            Logger.warn(`AnimeKai server decode failed for ${animeSlug}/${lid}: ${String(serverErr)}`);
          }
        }
      }

      return results;
    } catch (err) {
      Logger.error(`AnimeKai streams error: ${String(err)}`);
      return [];
    }
  }

  // ─── Resolve / Mapping Helpers ───────────────────────────────────────────────

  static async resolveByExternalId(): Promise<string | null> {
    return null; // Removing AniZip means we can't easily resolve by external ID without a search title
  }

  static async getEpisodeSession(
    animeId: string,
    episodeNumber: number
  ): Promise<string | null> {
    try {
      const meta = await this.metaInternal(animeId);
      if (!meta?.aniId) return null;

      const episodeData = await this.episodes(animeId, {
        aniId: meta.aniId,
        availability: {
          hasSub: meta.hasSub,
          hasDub: meta.hasDub,
          subCount: meta.subCount,
          dubCount: meta.dubCount,
        },
      });
      if (!episodeData) return null;

      const episode = episodeData.episodes.find((ep: AnimeKaiEpisode) => ep.number === episodeNumber);
      return episode ? episode.id : null;
    } catch (err) {
      Logger.error(`AnimeKai getEpisodeSession error: ${String(err)}`);
      return null;
    }
  }

  static async getMappingsAndName(id: string): Promise<{ mappings: any | null; name: string } | null> {
    try {
      const meta = await this.meta(id);
      if (!meta) return null;

      const malId = meta.malId ? parseInt(meta.malId) : null;
      const anilistId = meta.anilistId ? parseInt(meta.anilistId) : null;

      const mappings = (malId || anilistId) ? {
          mal_id: malId,
          anilist_id: anilistId,
          themoviedb_id: null,
          imdb_id: null,
          thetvdb_id: null,
          kitsu_id: null,
          anidb_id: null,
          anisearch_id: null,
          livechart_id: null,
          animeplanet_id: null,
          notifymoe_id: null,
      } : null;

      return {
        mappings,
        name: meta.title,
      };
    } catch (err) {
      Logger.error(`AnimeKai getMappingsAndName error: ${String(err)}`);
      return null;
    }
  }
}
