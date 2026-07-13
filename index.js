import Parser from "rss-parser";
import fetch from "node-fetch";
import fs from "fs";

// ---- CONFIG ----
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // never hardcode this
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // never hardcode this
const CHANNEL = "@news_fetan_mereja";
const SEEN_FILE = "./seen.json";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// Start with a small set of trusted, free RSS feeds.
// We'll expand this list once the pipeline works end-to-end.
const FEEDS = [
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
];

const parser = new Parser();

// ---- DEDUPE STORAGE ----
function loadSeen() {
  if (!fs.existsSync(SEEN_FILE)) return [];
  return JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8"));
}

function saveSeen(seenList) {
  // Keep only the last 500 links so the file doesn't grow forever
  const trimmed = seenList.slice(-500);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(trimmed, null, 2));
}

// ---- AI PROCESSING (summarize + translate) ----
async function processWithAI(title, snippet) {
  const prompt = You are a news assistant. Given this news headline and snippet, respond with ONLY a JSON object (no markdown, no backticks, no extra text) with exactly these keys:
{
  "english": "a simple, clear, easy-to-understand 1-2 sentence summary in English",
  "amharic": "the same summary translated into natural Amharic",
  "oromo": "the same summary translated into natural Oromo (Afaan Oromoo)"
}

Headline: ${title}
Snippet: ${snippet || "(no extra detail available)"};

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
    // Strip accidental markdown fences just in case
    const cleaned = rawText.replace(/`json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse Gemini JSON:", rawText);
    return null;
  }
}

// ---- TELEGRAM ----
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

// ---- MAIN ----
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
      // Only check the newest 5 items per feed each run
      const latestItems = parsed.items.slice(0, 5);

      for (const item of latestItems) {
        if (seenSet.has(item.link)) continue;

        const ai = await processWithAI(item.title, item.contentSnippet);

        let message;
        if (ai) {
          message =
            `🇬🇧 <b>${escapeHtml(ai.english)}</b>\n\n` +
            `🇪🇹 ${escapeHtml(ai.amharic)}\n\n` +
            `🇪🇹 ${escapeHtml(ai.oromo)}\n\n` +
            `Source: ${feed.name}\n${item.link}`;
        } else {
          // Fallback: if AI fails, still post the raw headline so nothing is lost
          message =
            `<b>${escapeHtml(item.title)}</b>\n` +
            `Source: ${feed.name}\n` +
            `${item.link}`;
        }
[7/13/2026 9:58 PM] Muba: await postToTelegram(message);
        newLinks.push(item.link);
        seenSet.add(item.link);
      }
    } catch (err) {
      console.error(Failed to fetch ${feed.name}:, err.message);
    }
  }

  if (newLinks.length > 0) {
    saveSeen([...seen, ...newLinks]);
    console.log(Done. Posted ${newLinks.length} new item(s).);
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
