# Fun Facts Daily — Official Podcast Trivia Game 💡

An interactive solo + multiplayer trivia web app built for listeners of **Fun Facts Daily** hosted by Kyle Wood (`https://feeds.megaphone.fm/ARML3789803370`).

## Features Included

- **☀️ Warm Memphis Design + Podcast Branding:** Incorporates the official *Fun Facts Daily* logo in the header, app icons, and shareable Score Cards, with bright yellows, warm oranges, a floating scroll-aware mini bar, and a festive party palette when switching to **Play with Friends** mode.
- **⚡ Daily Double (+20 Points) & Weekday-Safe Streaks:** Pulls from the latest weekday episode (Mon–Fri). Streaks automatically bridge Friday → Monday across weekends, and unlock an optional **🎁 Weekend Vault Bonus (+15 Points)** on Saturdays & Sundays!
- **🎧 Custom Memphis Episode Player + Apple Podcasts Growth Links:**
  - Large 1:1 square cover art from each episode, bold episode title underneath, Play/Pause, `-30s` / `+30s` skip buttons, interactive scrubber, and mute + volume slider.
  - Streams directly from your Megaphone RSS `<enclosure>` URLs (counting toward your Megaphone/Airwave IAB downloads) while pairing every episode with direct **Open & Follow on Apple Podcasts** deep links (`podcasts.apple.com/.../id1810507693?i=...`) to drive native Apple Podcasts app listens, follows, and 5-star reviews.
- **📚 More to Explore (404+ Archive Episodes • +10 Points Each) + Random Fact Generator:**
  - Pre-seeded with trivia questions across **all 404 released episodes** of *Fun Facts Daily*, plus searchable episode browsing and drag-and-drop reorderable **Playlists**!
  - Topic filter bar (*Give me everything!*, *Animals*, *Foods*, *Art*, *Science*, *Geography*, *History*, *Pop Culture*, *Biographies*) with live unseen counts and a strict non-repeat guarantee per player.
  - Submitting an answer reveals the explanation **and** an embedded episode player cued directly to the `MM:SS` timestamp where the answer is explained.
- **🏅 Achievement Badge Board & Portable Sync Code:** 17 unlockable badges (streaks, point milestones up to `5,000` points, **Completionist Club** for answering all available questions, category breadth, listening, Apple Podcasts, and Play with Friends) plus a zero-login Backup/Sync Code and downloadable `1080x1080` Social Score Cards.
- **🤝 Play with Friends (Custom Live Trivia Builder):**
  - Name your custom quiz, hand-pick exact episodes from the catalog, or use **Quick Pick** (`10`, `15`, or `20` questions by topic).
  - Select per-question countdown time (`10s`–`45s`), share via **Invite Friends** (random 6-character code + scannable SVG QR code), and hit **Play Now** for live auto-advancing rounds with live **Pause / Resume**, **Top-3 Leaderboard** pauses between questions (**Next Question**), speed-rank bonuses (`+10` base, `+5` fastest correct, `+2` second-fastest correct), and full ranked final standings.
- **🤖 Automated Weekday Feed Agent:** GitHub Actions workflow + Gemini 2.5 Flash script monitors your Megaphone RSS feed every weekday (Mon–Fri), listens to new episodes, extracts a verified trivia question + exact `MM:SS` audio timestamp, and updates the live app automatically.

---

## Run Locally Right Now (Zero Installs Required!)

You can launch the full app—including local Wi-Fi QR multiplayer for phones & tablets—using macOS's built-in Ruby server:

1. **Double-click** `Start Local Game Server.command` in Finder *(or run `/usr/bin/ruby server.rb` in Terminal)*.
2. Open **http://localhost:8080** in your browser.
3. To test **Play with Friends** on your phone over home Wi-Fi, click **🤝 Play with Friends → Invite Friends** and scan the on-screen QR code!

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
