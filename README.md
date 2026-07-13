# Al-Huda News Bot — Step 1 (Telegram test)

This is the first working piece: it checks two RSS feeds (BBC World, Al Jazeera)
and posts any new headlines to your Telegram channel @news_fetan_mereja.

## Run it on your PC (first test)

1. Install Node.js if you don't have it (nodejs.org — download and install).
2. Open a terminal in this folder and run:
   ```
   npm install
   ```
3. Set your bot token as an environment variable (do NOT put it in the code):

   **On Windows (PowerShell):**
   ```
   $env:TELEGRAM_BOT_TOKEN="8929675715:AAG5tjyCoXzlQ5EFPobQnhMjC8sUOmGIwCY"
   ```

   **On Mac/Linux/Termux:**
   ```
   export TELEGRAM_BOT_TOKEN="8929675715:AAG5tjyCoXzlQ5EFPobQnhMjC8sUOmGIwCY"
   ```

4. Run it:
   ```
   node index.js
   ```

You should see it print "Posted: ..." for each headline, and the messages
should appear in your Telegram channel within seconds.

Run `node index.js` again right away — it should say "No new items this run"
because it remembers what it already posted (stored in `seen.json`).

## What happens next (once this test works)

- We'll add AI summarization + Amharic/Oromo translation before posting
- We'll add more sources (Islamic affairs, Horn of Africa/regional news)
- We'll automate it with **GitHub Actions** (free) so it runs by itself every
  5–15 minutes, forever, with no PC needed and no cost
- We'll connect the same data to your website and mobile app

## Important

- Never commit `seen.json` issues aside — the real thing to protect is your
  bot token. Don't paste it into public code, GitHub repos, or screenshots.
- If you ever think the token leaked, message @BotFather → `/mybots` →
  your bot → **API Token** → **Revoke current token** to get a new one.
