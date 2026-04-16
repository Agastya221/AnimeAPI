# Maintenance

Use this page when you want to make the API your own and keep scraper fixes fast.

## Own The Site First

- Yes, you need to understand the target site better before the scraper becomes reliable.
- Do not treat the site as only HTML. Inspect its network calls, JSON endpoints, player embeds, cookies, headers, and anti-bot behavior.
- Prefer stable upstream APIs or JSON blobs over brittle CSS selectors whenever possible.

## How Providers Should Be Structured

- Keep each source isolated under `src/providers/<provider>/`.
- Split site logic into three layers: fetch, parse, normalize.
- Keep constants like base URLs, selectors, headers, and cache TTLs in one place.
- Return a stable API shape even if the upstream site changes internally.

## Fast Fix Workflow

1. Check `GET /api/v2/anime/health/scrapers` to see which provider is failing.
2. Reproduce the failing route locally with one known-good example.
3. Open the upstream site in browser devtools and compare current requests/HTML against the parser assumptions.
4. Update the provider fetch/parsing logic only for the broken source.
5. Add or update a regression test for that exact failure.
6. Deploy only after the route and docs output look correct.

## What To Save For Each Provider

- One search URL
- One detail/info URL
- One watch/source URL
- Expected response shape
- Required headers, referer rules, cookies, and anti-bot notes
- Known fallback paths if the main extractor fails

## Make Breakages Easy To Repair

- Keep provider routes thin and move scraping logic into provider modules.
- Prefer small parsing helpers over one long scraping function.
- Cache successful responses longer than empty or failed source responses.
- Log upstream status codes and parser failures clearly enough that you can see whether the site changed, blocked you, or returned empty data.
- Use health checks and a small smoke-test list on every deploy.

## Minimum Smoke Tests

- `GET /health`
- `GET /v`
- `GET /api/v2/docs/endpoints-json`
- `GET /api/v2/anime/health/scrapers`
- One route per provider you care about most

## Recommended Ownership Model

- Pick 2 to 4 providers you actually need and keep those excellent.
- Document every route you expose so the deployed API is testable without source code.
- Add a test whenever you fix a real scraper break so the same bug stays fixed.
- Avoid mixing business logic, mapping, caching, and HTML parsing in the same function.
