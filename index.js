import Parser from "rss-parser";
import fetch from "node-fetch";
import fs from "fs";

// ---- CONFIG ----
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CHANNEL = "@news_fetan_mereja";
const SEEN_FILE = "./seen.json";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

const FEEDS = [
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", hashtags: "#WorldNews #BBC" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", hashtags: "#WorldNews #AlJazeera" },
  { name: "Middle East Eye", url: "https://www.middleeasteye.net/rss", hashtags: "#IslamicNews #MiddleEast" },
  { name: "Ethiopia Insight", url: "https://ethiopia-insight.com/feed", hashtags: "#Ethiopia #HornOfAfrica" },
  { name: "Horn Observer", url: "https://hornobserver.com/feed", hashtags: "#HornOfAfrica #EastAfrica" },
  { name: "Addis Fortune", url: "https://addisfortune.news/feed", hashtags: "#Ethiopia #AddisAbaba" },
];

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

function extractImageUrl(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;
  if (Array.isArray(item.mediaContent) && item.mediaContent[0]?.$?.url) {
    return item.mediaContent[0].$.url;
  }
  const html = item["content:encoded"] || item.content || item.contentSnippet || "";
  const match = html.match(/<img[^>]+src="([^">]+)"/i);
  return match ? match[1] : null;
}

async function fetchArticleContent(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlHudaNewsBot/1.0)" },
    });
    const html = await res.text();

    const paragraphs = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gis)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
      .filter((p) => p.length > 40);

    const text = paragraphs.join(" ").slice(0, 3000);

    const imageMatch = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    );
    const image = imageMatch ? imageMatch[1] : null;

    return { text: text || null, image };
  } catch (err) {
    console.error(`Failed to fetch article content: ${err.message}`);
    return { text: null, image: null };
  }
}

function loadSeen() {
  if (!fs.existsSync(SEEN_FILE)) return [];
  return JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8"));
}

function saveSeen(seenList) {
  const trimmed = seenList.slice(-500);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(trimmed, null, 2));
}

async function processWithAI(title, articleText) {
  const prompt = `You are a news assistant. Given this news headline and article content, write a clear, easy-to-understand summary IN YOUR OWN WORDS (do not copy sentences directly from the article) covering the key facts. Respond with ONLY a JSON object (no markdown, no backticks, no extra text) with exactly these keys:
{
  "english": "a clear 3-4 sentence summary in English, in your own words, covering the key facts",
  "amharic": "the same summary translated into natural Amharic",
  "oromo": "the same summary translated into natural Oromo (Afaan Oromoo)"
}

Headline: ${title}
Article content: ${articleText || "(no additional detail available, summarize from the headline alone)"}`;

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    console.error("Gemini returned no text:", JSON.stringify(data));
    return null;
  }

  try {
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse Gemini JSON:", rawText);
    return null;
  }
}

async function postToTelegram(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHANNEL,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("Telegram error:", data);
  } else {
    console.log("Posted:", text.split("\n")[0]);
  }
}

async function postPhotoToTelegram(photoUrl, caption) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHANNEL,
      photo: photoUrl,
      caption,
      parse_mode: "HTML",
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("Telegram photo error:", data);
    return false;
  }
  console.log("Posted with photo:", caption.split("\n")[0]);
  return true;
}

async function run() {
  if (!BOT_TOKEN) {
    console.error("Missing TELEGRAM_BOT_TOKEN environment variable.");
    process.exit(1);
  }

  const seen = loadSeen();
  const seenSet = new Set(seen);
  let newLinks = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const latestItems = parsed.items.slice(0, 5);

      for (const item of latestItems) {
        if (seenSet.has(item.link)) continue;

        const { text: articleText, image: ogImage } = await fetchArticleContent(item.link);
        const image = ogImage || extractImageUrl(item);
        const ai = await processWithAI(item.title, articleText || item.contentSnippet);

        let message;
        if (ai) {
          message =
            `${feed.hashtags}\n\n` +
            `🇪🇹 <b>${escapeHtml(ai.amharic)}</b>\n\n` +
            `🇪🇹 ${escapeHtml(ai.oromo)}\n\n` +
            `🇬🇧 ${escapeHtml(ai.english)}\n\n` +
            `Source: ${feed.name}`;
        } else {
          message =
            `${feed.hashtags}\n\n` +
            `<b>${escapeHtml(item.title)}</b>\n` +
            `Source: ${feed.name}`;
        }

        if (image && message.length <= 1024) {
          const ok = await postPhotoToTelegram(image, message);
          if (!ok) await postToTelegram(message);
        } else if (image) {
          const shortCaption = `${feed.hashtags}\n\n<b>${escapeHtml(item.title)}</b>`;
          const ok = await postPhotoToTelegram(image, shortCaption);
          await postToTelegram(message);
          if (!ok) console.error("Photo failed to send, posted text only.");
        } else {
          await postToTelegram(message);
        }

        newLinks.push(item.link);
        seenSet.add(item.link);
      }
    } catch (err) {
      console.error(`Failed to fetch ${feed.name}:`, err.message);
    }
  }

  if (newLinks.length > 0) {
    saveSeen([...seen, ...newLinks]);
    console.log(`Done. Posted ${newLinks.length} new item(s).`);
  } else {
    console.log("Done. No new items this run.");
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

run();
