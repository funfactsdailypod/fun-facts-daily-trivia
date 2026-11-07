# Fun Facts Daily — Official Podcast Trivia Game 💡

An interactive solo + multiplayer trivia web app built for listeners of **Fun Facts Daily** hosted by Kyle Wood (`https://feeds.megaphone.fm/ARML3789803370`).

## Features Included

- **☀️ Warm Memphis Design + Podcast Branding:** Bright yellows, warm oranges, and playful neo-Memphis geometry that smoothly shifts into a festive party palette when switching to **Group Game** mode.
- **⚡ Daily Double (+20 Points) & Weekday-Safe Streaks:** Pulls from the latest weekday episode (Mon–Fri). Streaks automatically bridge Friday → Monday across weekends, and unlock an optional **🎁 Weekend Vault Bonus (+15 Points)** on Saturdays & Sundays!
- **🎧 Custom Memphis Episode Player + Apple Podcasts Growth Links:**
  - Large 1:1 square cover art from each episode, bold episode title underneath, Play/Pause, `-30s` / `+30s` skip buttons, interactive scrubber, and mute + volume slider.
  - Streams directly from your Megaphone RSS `<enclosure>` URLs (counting toward your Megaphone/Airwave IAB downloads) while pairing every episode with direct **Open & Follow on Apple Podcasts** deep links (`podcasts.apple.com/.../id1810507693?i=...`) to drive native Apple Podcasts app listens, follows, and 5-star reviews.
- **📚 More to Explore (404+ Archive Episodes • +10 Points Each):**
  - Pre-seeded with trivia questions across **all 404 released episodes** of *Fun Facts Daily*!
  - Topic filter bar (*Give me everything!*, *Animals*, *Foods*, *Art*, *Science*, *Geography*, *History*, *Pop Culture*, *Biographies*) with live unseen counts and a strict non-repeat guarantee per player.
  - Submitting an answer reveals the explanation **and** an embedded episode player cued directly to the `MM:SS` timestamp where the answer is explained.
- **🏅 Achievement Badge Board & Portable Sync Code:** 12 unlockable badges (streaks, point milestones, category breadth, listening, Apple Podcasts, Group Game) plus a zero-login Backup/Sync Code to move progress across devices.
- **🎉 Multiplayer Group Game (Kahoot Live Mode + Self-Paced Leaderboard Mode):**
  - Supports both **Live Kahoot Mode** (host controls shared screen while players tap geometric tiles on phones/tablets) and **Self-Paced Leaderboard Mode** (ideal for 1-day or 1-week classroom/family/social challenges).
  - Unique active game codes (custom or random unambiguous 6-character code), scannable offline SVG **QR Code**, player nicknames + 12 Memphis avatars, and **1 Hour / 1 Day / 1 Week** automatic code expiration & reuse.
- **🤖 Automated Weekday Feed Agent:** GitHub Actions workflow + Gemini 2.5 Flash script monitors your Megaphone RSS feed every weekday (Mon–Fri), listens to new episodes, extracts a verified trivia question + exact `MM:SS` audio timestamp, and updates the live app automatically.

---

## Run Locally Right Now (Zero Installs Required!)

You can launch the full app—including local Wi-Fi QR multiplayer for phones & tablets—using macOS's built-in Ruby server:

1. **Double-click** `Start Local Game Server.command` in Finder *(or run `/usr/bin/ruby server.rb` in Terminal)*.
2. Open **http://localhost:8080** in your browser.
3. To test **Group Game** on your phone over home Wi-Fi, click **🎉 Group Game → Set Up a Game as Host** and scan the on-screen QR code!

---

## Deploy Online for $0/Month (Step-by-Step)

### Step 1: Create a Free GitHub Repository ($0)
1. Create a repository on [GitHub](https://github.com/new) (e.g., `fun-facts-daily-trivia`) and upload the files in this folder.

### Step 2: Set Up Free Multiplayer Database on Supabase ($0)
1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and click **Run**.
3. Go to **Project Settings → API** and copy your **Project URL** and **`anon` `public` key**.
4. Paste both values into `public/js/config.js` under `CLOUD_CONFIG`:
   ```js
   export const CLOUD_CONFIG = {
     supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
     supabaseAnonKey: 'YOUR-PUBLIC-ANON-KEY'
   };
   ```

### Step 3: Enable the Weekday AI RSS Feed Agent ($0)
1. Get a free Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. In your GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `GEMINI_API_KEY` — your Google AI Studio key
   - `SUPABASE_URL` — your Supabase Project URL *(keeps your free Supabase DB awake every Mon–Fri!)*
   - `SUPABASE_ANON_KEY` — your Supabase anon key
3. GitHub Actions (`.github/workflows/weekday-feed-agent.yml`) will now check `https://feeds.megaphone.fm/ARML3789803370` every Monday–Friday morning, generate the new Daily Double + exact audio timestamp, and commit it to `public/data/questions.json`.

### Step 4: Host Frontend on Cloudflare Pages ($0, Unlimited Bandwidth)
1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages → Connect to Git**.
2. Select your GitHub repository and configure:
   - **Build command:** *(leave blank)*
   - **Build output directory:** `public`
3. Click **Save and Deploy**. Every weekday when the GitHub Action commits a new episode question, Cloudflare Pages automatically updates your live site in ~20 seconds!
