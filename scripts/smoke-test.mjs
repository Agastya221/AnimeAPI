const defaultBaseUrl = process.env.SMOKE_BASE_URL || "http://localhost:4000";

const baseUrlArg = process.argv
  .slice(2)
  .find((arg) => !arg.startsWith("--"));

const baseUrl = String(baseUrlArg || defaultBaseUrl).replace(/\/+$/, "");

const tests = [
  {
    name: "Health",
    path: "/health",
    validate: async (response, body) => response.ok && body.includes("daijoubu"),
  },
  {
    name: "Version",
    path: "/v",
    validate: async (response, body) => response.ok && body.includes("v"),
  },
  {
    name: "Docs JSON",
    path: "/api/v2/docs/endpoints-json",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return json?.base?.v2 === "/api/v2";
    },
  },
  {
    name: "Scraper Health",
    path: "/api/v2/anime/health/scrapers",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return Array.isArray(json?.scrapers);
    },
  },
  {
    name: "HiAnime Home",
    path: "/api/v2/hianime/home",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return typeof json === "object" && json !== null;
    },
  },
  {
    name: "HiAnime Search",
    path: "/api/v2/hianime/search?q=one%20piece",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return Array.isArray(json?.animes) || Array.isArray(json?.results);
    },
  },
  {
    name: "AnimePahe Latest",
    path: "/api/v2/anime/animepahe/latest",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return Array.isArray(json?.data) || Array.isArray(json?.results) || typeof json === "object";
    },
  },
  {
    name: "AnimeKai Spotlight",
    path: "/api/v2/anime/animekai/spotlight",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return Array.isArray(json) || Array.isArray(json?.results) || typeof json === "object";
    },
  },
  {
    name: "AnimeYa Home",
    path: "/api/v2/anime/animeya/home",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return Array.isArray(json?.featured) || Array.isArray(json?.trending);
    },
  },
  {
    name: "Animelok Home",
    path: "/api/v2/anime/animelok/home",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return Array.isArray(json?.sections) || Array.isArray(json?.featured);
    },
  },
  {
    name: "WatchAW Home",
    path: "/api/v2/anime/watchaw/home",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return Array.isArray(json?.featured) || Array.isArray(json?.results) || typeof json === "object";
    },
  },
  {
    name: "DesiDub Home",
    path: "/api/v2/anime/desidub/home",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return Array.isArray(json?.featured) || typeof json === "object";
    },
  },
  {
    name: "HindiDubbed Home",
    path: "/api/v2/anime/hindidubbed/home",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return typeof json === "object" && json !== null;
    },
  },
  {
    name: "ToonStream Home",
    path: "/api/v2/anime/toonstream/home",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return typeof json === "object" && json !== null;
    },
  },
  {
    name: "ToonWorld Search",
    path: "/api/v2/anime/toonworld/search/doraemon",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return Array.isArray(json) || Array.isArray(json?.results) || typeof json === "object";
    },
  },
  {
    name: "Manga Providers",
    path: "/api/v2/manga/providers",
    validate: async (response, body) => {
      if (!response.ok) return false;
      const json = JSON.parse(body);
      return Array.isArray(json?.providers) || Array.isArray(json);
    },
  },
];

function short(text, max = 160) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

async function runTest(test) {
  const url = `${baseUrl}${test.path}`;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "TatakaiAPI-SmokeTest/1.0",
        Accept: "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(15000),
    });

    const body = await response.text();
    let passed = false;

    try {
      passed = await test.validate(response, body);
    } catch {
      passed = false;
    }

    return {
      name: test.name,
      url,
      status: response.status,
      passed,
      durationMs: Date.now() - startedAt,
      detail: passed ? "ok" : short(body),
    };
  } catch (error) {
    return {
      name: test.name,
      url,
      status: 0,
      passed: false,
      durationMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

const results = [];
for (const test of tests) {
  // eslint-disable-next-line no-await-in-loop
  results.push(await runTest(test));
}

const passedCount = results.filter((result) => result.passed).length;
const failedCount = results.length - passedCount;

console.log(`Smoke test target: ${baseUrl}`);
console.log("");

for (const result of results) {
  const marker = result.passed ? "PASS" : "FAIL";
  console.log(
    `[${marker}] ${result.name} | status=${result.status} | time=${result.durationMs}ms | ${result.url}`
  );
  if (!result.passed) {
    console.log(`       ${result.detail}`);
  }
}

console.log("");
console.log(`Summary: ${passedCount}/${results.length} passed, ${failedCount} failed`);

if (failedCount > 0) {
  process.exitCode = 1;
}
