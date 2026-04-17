import { extractCompatStreamingInfo } from "./src/services/hianimeCompat.js";

async function test() {
  process.env.ANIWATCH_DOMAIN = "kaido.to";
  console.log("Testing stream extraction for Kaido.to...");
  try {
    // using one-piece-100 ep=2142 to test typical hianime episode
    const result = await extractCompatStreamingInfo("one-piece-100?ep=2142", "HD-1", "sub", false);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
