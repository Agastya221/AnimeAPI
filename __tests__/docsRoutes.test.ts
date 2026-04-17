import { describe, expect, test } from "vitest";
import {
  buildEndpointsMarkdown,
  readDocSection,
  readEndpointsCatalog,
} from "../src/docs/catalog.ts";

describe("documentation routes", () => {
  test("serves the machine-readable endpoint catalog", () => {
    const data = readEndpointsCatalog();
    expect(data.base?.v2).toBe("/api/v2");
    expect(data.providers?.mount).toBe("/api/v2/anime");
    expect(data.system).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/api/v2/docs/endpoints-json" }),
        expect.objectContaining({ path: "/api/v2/health/cache" }),
        expect.objectContaining({ path: "/api/v2/anime/health/scrapers" }),
      ])
    );
  });

  test("renders endpoint markdown with query details", () => {
    const content = buildEndpointsMarkdown();
    expect(content).toContain("## System");
    expect(content).toContain("/api/v2/docs/endpoints-json");
    expect(content).toContain("/api/v2/health/cache");
    expect(content).toContain("(query: animeEpisodeId, server, category)");
  });

  test("serves the maintenance guide", () => {
    const content = readDocSection("maintenance");
    expect(content).toContain("# Maintenance");
    expect(content).toContain("/api/v2/anime/health/scrapers");
  });
});
