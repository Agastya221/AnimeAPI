import { beforeEach, describe, expect, test, vi } from "vitest";

const { fetcherMock, generateTokenMock } = vi.hoisted(() => ({
  fetcherMock: vi.fn(),
  generateTokenMock: vi.fn(),
}));

vi.mock("../src/lib/fetcher.ts", () => ({
  fetcher: fetcherMock,
}));

vi.mock("../src/providers/animekai/scraper/megaup.ts", () => ({
  MegaUp: {
    generateToken: generateTokenMock,
    decodeIframeData: vi.fn(),
    extract: vi.fn(),
  },
}));

const watchHtml = `
  <div class="entity-scroll">
    <div class="title" data-jp="Sample JP">Sample Anime</div>
    <div class="desc">Sample description</div>
    <div class="info">
      <span class="sub">12</span>
      <span class="dub">8</span>
      <span>TV</span>
    </div>
    <div class="detail">
      <div>Genres: Action, Fantasy</div>
      <div>Status: <span>Releasing</span></div>
      <div>Premiered: <span>Winter 2024</span></div>
      <div>Duration: <span>24m</span></div>
      <div>
        Links:
        <a href="https://myanimelist.net/anime/12345">MAL</a>
        <a href="https://anilist.co/anime/67890">AniList</a>
      </div>
    </div>
  </div>
  <div class="poster"><div><img src="https://cdn.example/poster.jpg" /></div></div>
  <div class="rate-box" id="anime-rating" data-id="ani-123"></div>
  <section class="sidebar-section">
    <div class="aitem-col">
      <a class="aitem" href="/watch/rec-1">
        <span class="title" data-jp="Rec JP">Recommendation</span>
        <img src="https://cdn.example/rec.jpg" />
        <div class="info">
          <span class="sub">1</span>
          <span class="dub">1</span>
          <span>12</span>
          <span>TV</span>
        </div>
      </a>
    </div>
  </section>
  <section id="related-anime">
    <div class="aitem-col">
      <a class="aitem" href="/watch/rel-1" style="background-image:url('https://cdn.example/rel.jpg')">
        <span class="title" data-jp="Rel JP">Related</span>
        <div class="info">
          <span class="sub">1</span>
          <span class="dub">1</span>
          <span>
            <b class="text-muted">SEQUEL</b>
            <b>TV</b>
            <b>12</b>
          </span>
        </div>
      </a>
    </div>
  </section>
`;

const episodesHtml = `
  <div class="eplist">
    <ul>
      <li><a href="?watch=1&" num="1" token="token-1"><span>Episode 1</span></a></li>
      <li><a class="filler" href="?watch=2&" num="2" token="token-2"><span>Episode 2</span></a></li>
    </ul>
  </div>
`;

describe("AnimeKai split metadata/episodes flow", () => {
  beforeEach(() => {
    fetcherMock.mockReset();
    generateTokenMock.mockReset();
    generateTokenMock.mockResolvedValue("ajax-token");
  });

  test("meta() parses watch-page metadata without requesting the episode ajax endpoint", async () => {
    const { AnimeKai } = await import("../src/providers/animekai/animekai.ts");
    fetcherMock.mockResolvedValue({
      success: true,
      status: 200,
      text: watchHtml,
    });

    const meta = await AnimeKai.meta("sample-anime");

    expect(meta?.title).toBe("Sample Anime");
    expect(meta?.anilistId).toBe("67890");
    expect(fetcherMock).toHaveBeenCalledTimes(1);
    expect(String(fetcherMock.mock.calls[0]?.[0])).toContain("/watch/sample-anime");
  });

  test("episodes() fetches only the episode ajax payload when aniId is provided", async () => {
    const { AnimeKai } = await import("../src/providers/animekai/animekai.ts");
    fetcherMock.mockResolvedValue({
      success: true,
      status: 200,
      text: JSON.stringify({ result: episodesHtml }),
    });

    const episodes = await AnimeKai.episodes("sample-anime", {
      aniId: "ani-123",
      availability: { hasSub: true, hasDub: true, subCount: 12, dubCount: 8 },
    });

    expect(episodes?.totalEpisodes).toBe(2);
    expect(episodes?.episodes[0]?.id).toBe("sample-anime$ep=1$token=token-1");
    expect(fetcherMock).toHaveBeenCalledTimes(1);
    expect(String(fetcherMock.mock.calls[0]?.[0])).toContain("/ajax/episodes/list?ani_id=ani-123");
  });

  test("info() composes the legacy payload from split meta and episodes data", async () => {
    const { AnimeKai } = await import("../src/providers/animekai/animekai.ts");
    fetcherMock
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        text: watchHtml,
      })
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        text: JSON.stringify({ result: episodesHtml }),
      });

    const info = await AnimeKai.info("sample-anime");

    expect(info?.title).toBe("Sample Anime");
    expect(info?.totalEpisodes).toBe(2);
    expect(info?.episodes).toHaveLength(2);
  });

  test("getMappingsAndName uses meta only while getEpisodeSession uses the split episode lookup", async () => {
    const { AnimeKai } = await import("../src/providers/animekai/animekai.ts");
    fetcherMock
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        text: watchHtml,
      })
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        text: watchHtml,
      })
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        text: JSON.stringify({ result: episodesHtml }),
      });

    const mappings = await AnimeKai.getMappingsAndName("sample-anime");
    const episodeSession = await AnimeKai.getEpisodeSession("sample-anime", 2);

    expect(mappings?.name).toBe("Sample Anime");
    expect(mappings?.mappings?.anilist_id).toBe(67890);
    expect(episodeSession).toBe("sample-anime$ep=2$token=token-2");
    expect(fetcherMock).toHaveBeenCalledTimes(3);
  });
});
