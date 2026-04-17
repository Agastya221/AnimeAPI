import { extractCompatStreamingInfo } from "./src/services/hianimeCompat.js";

async function test(label: string, server: string, type: "sub" | "dub") {
  process.env.ANIWATCH_DOMAIN = "kaido.to";
  try {
    const result = await extractCompatStreamingInfo("one-piece-100?ep=2142", server, type, false);
    const link = result.streamingLink[0]?.link;
    const cdnHost = link ? new URL(link).hostname : "(no link)";
    console.log(`[${label}] ✓ Server selected: ${result.server} | CDN: ${cdnHost}`);
  } catch (err: any) {
    console.log(`[${label}] ✗ FAILED: ${err.message}`);
  }
}

(async () => {
  await test("HD-1 sub", "HD-1", "sub");
  await test("HD-2 sub", "HD-2", "sub");   // Should retry to HD-1 when HD-2 is blocked upstream 
  await test("Vidcloud sub", "Vidcloud", "sub");
  await test("HD-1 dub", "HD-1", "dub");
  await test("HD-2 dub", "HD-2", "dub");
})();
