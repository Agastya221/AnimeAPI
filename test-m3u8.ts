import { extractCompatStreamingInfo } from "./src/services/hianimeCompat.js";
import axios from "axios";

async function test() {
  process.env.ANIWATCH_DOMAIN = "kaido.to";
  console.log("Extracting links...");
  try {
    const result = await extractCompatStreamingInfo("one-piece-100?ep=2142", "Vidcloud", "sub", false);
    const link = result.streamingLink[0].link;
    console.log("Link found: " + link);
    console.log("Attempting to fetch M3U8 string with rapid-cloud referer...");
    const resp = await axios.get(link, {
        headers: {
            "Referer": "https://rapid-cloud.co/",
            "Origin": "https://rapid-cloud.co",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
    });
    console.log("Success! M3U8 payload:");
    console.log(resp.data.substring(0, 300));
  } catch (err: any) {
    console.error("Error fetching m3u8 HTTP " + err?.response?.status);
  }
}
test();
