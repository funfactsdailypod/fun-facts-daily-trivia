#!/usr/bin/env node
/**
 * Fun Facts Daily — Automated Weekday RSS Feed & Gemini Flash Audio Trivia Agent
 * Zero npm dependencies required (uses built-in Node 20/22 fetch & fs).
 *
 * Environment variables:
 *   GEMINI_API_KEY     (Required for AI generation — free key from https://aistudio.google.com/apikey)
 *   SUPABASE_URL       (Optional — pings Supabase Free Tier to clean expired rooms & prevent 7-day sleep)
 *   SUPABASE_ANON_KEY  (Optional — paired with SUPABASE_URL)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = path.resolve(__dirname, '../public/data/questions.json');

const RSS_FEED_URL = 'https://feeds.megaphone.fm/ARML3789803370';
const APPLE_LOOKUP_URL = 'https://itunes.apple.com/lookup?id=1810507693&entity=podcastEpisode&limit=50';
const APPLE_SHOW_FALLBACK = 'https://podcasts.apple.com/us/podcast/fun-facts-daily/id1810507693';

const ALLOWED_CATEGORIES = [
  'Animals',
  'Foods',
  'Art',
  'Science',
  'Geography',
  'History',
  'Pop Culture',
  'Biographies'
];

function extractTag(block, tagName) {
  const cdataRe = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
  const m1 = block.match(cdataRe);
  if (m1) return m1[1].trim();

  const plainRe = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const m2 = block.match(plainRe);
  return m2 ? m2[1].trim() : '';
}

function extractAttr(block, tagName, attrName) {
  const re = new RegExp(`<${tagName}[^>]*\\b${attrName}="([^"]+)"`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function cleanDescription(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\u2060/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*Listen Ad-Free on Patreon.*$/i, '')
    .replace(/\s*More to explore:.*$/i, '')
    .replace(/\s*Want to learn more\? Head over to my website.*$/i, '')
    .trim();
}

async function fetchAppleEpisodeLinks() {
  const byGuid = new Map();
  const byTitle = new Map();
  try {
    const res = await fetch(APPLE_LOOKUP_URL);
    if (!res.ok) return { byGuid, byTitle };
    const data = await res.json();
    for (const r of data.results || []) {
      if (r.wrapperType !== 'podcastEpisode') continue;
      if (r.episodeGuid) byGuid.set(String(r.episodeGuid).trim(), r.trackViewUrl);
      if (r.trackName) byTitle.set(String(r.trackName).toLowerCase().trim(), r.trackViewUrl);
    }
  } catch (err) {
    console.warn('Apple Lookup warning (using show URL fallback):', err.message);
  }
  return { byGuid, byTitle };
}

async function fetchRssEpisodes(appleMaps) {
  const res = await fetch(RSS_FEED_URL);
  if (!res.ok) throw new Error(`Failed to fetch RSS feed: ${res.status}`);
  const xml = await res.text();

  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const parsed = [];

  for (const block of itemBlocks) {
    const epType = extractTag(block, 'itunes:episodeType').toLowerCase();
    const title = extractTag(block, 'title');
    if (
      epType === 'trailer' ||
      epType === 'bonus' ||
      /^(You Might Also Like|Introducing|Preview|Trailer)/i.test(title)
    ) {
      continue;
    }

    const guid = extractTag(block, 'guid');
    const pubDate = extractTag(block, 'pubDate');
    const durationSec = Number(extractTag(block, 'itunes:duration')) || 900;
    const rawImg = extractAttr(block, 'itunes:image', 'href');
    const defaultArt =
      'https://megaphone.imgix.net/podcasts/fe3784ae-198b-11f0-91a3-0f6a7cb73d31/image/68ba595ba6ba941c972898366cb62e76.png?ixlib=rails-4.3.1&max-w=600&max-h=600&fit=crop&auto=format,compress';
    const artworkUrl = rawImg
      ? rawImg.replace('max-w=3000&max-h=3000', 'max-w=600&max-h=600')
      : defaultArt;
    const audioUrl = extractAttr(block, 'enclosure', 'url');
    const description = cleanDescription(extractTag(block, 'description'));

    const appleUrl =
      appleMaps.byGuid.get(guid) ||
      appleMaps.byTitle.get(title.toLowerCase()) ||
      APPLE_SHOW_FALLBACK;

    parsed.push({
      guid,
      title,
      pubDate,
      durationSec,
      artworkUrl,
      audioUrl,
      appleUrl,
      description
    });
  }
  return parsed;
}

async function uploadAudioToGeminiFileApi(audioUrl, apiKey) {
  try {
    const mp3Res = await fetch(audioUrl, { redirect: 'follow' });
    if (!mp3Res.ok) return null;
    const buf = Buffer.from(await mp3Res.arrayBuffer());
    // Skip inline/upload if unexpectedly huge (>28 MB)
    if (buf.byteLength > 28 * 1024 * 1024) return null;

    const startRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(buf.byteLength),
          'X-Goog-Upload-Header-Content-Type': 'audio/mpeg',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ file: { display_name: 'ffd-episode.mp3' } })
      }
    );
    const uploadUrl = startRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) return null;

    const finishRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': String(buf.byteLength),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize'
      },
      body: buf
    });
    if (!finishRes.ok) return null;
    const meta = await finishRes.json();
    return meta.file?.uri || null;
  } catch (err) {
    console.warn('Audio upload skipped, falling back to RSS show notes:', err.message);
    return null;
  }
}

async function generateTriviaWithGemini(episode, apiKey) {
  const fileUri = await uploadAudioToGeminiFileApi(episode.audioUrl, apiKey);

  const prompt = `You write engaging, family-friendly multiple-choice trivia questions for listeners of the podcast "Fun Facts Daily" hosted by Kyle Wood.

Episode Title: ${episode.title}
Episode Duration: ${episode.durationSec} seconds
Episode Show Notes:
${episode.description}

Return a single JSON object matching this exact structure:
{
  "category": "<strictly one of: ${ALLOWED_CATEGORIES.join(' | ')}>",
  "cueSeconds": <integer timestamp in seconds where the primary trivia fact is explained in the episode>,
  "question": "<engaging multiple-choice trivia question from a standout fun fact in this episode>",
  "options": ["<Option A>", "<Option B>", "<Option C>", "<Option D>"],
  "correctIndex": <0, 1, 2, or 3>,
  "explanation": "<2-3 warm, upbeat sentences explaining the correct answer>",
  "vaultBonus": {
    "cueSeconds": <integer timestamp in seconds for a second distinct fact>,
    "question": "<second trivia question from a DIFFERENT fact in this episode>",
    "options": ["<Option A>", "<Option B>", "<Option C>", "<Option D>"],
    "correctIndex": <0, 1, 2, or 3>,
    "explanation": "<2-3 warm sentences explaining the second fact>"
  }
}`;

  const parts = [];
  if (fileUri) {
    parts.push({ file_data: { mime_type: 'audio/mpeg', file_uri: fileUri } });
  }
  parts.push({ text: prompt });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const body = await res.json();
  const rawJson = body.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(rawJson);

  if (!ALLOWED_CATEGORIES.includes(parsed.category)) {
    parsed.category = 'History';
  }
  return parsed;
}

async function pingSupabaseKeepAlive() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/rpc/cleanup_expired_group_rooms`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    console.log('Pinged Supabase Free Tier & cleaned expired group rooms.');
  } catch (err) {
    console.warn('Supabase keep-alive warning:', err.message);
  }
}

async function main() {
  await pingSupabaseKeepAlive();

  const existingRaw = await fs.readFile(QUESTIONS_PATH, 'utf8');
  const existing = JSON.parse(existingRaw);
  const knownGuids = new Set(existing.map((q) => q.guid));

  const appleMaps = await fetchAppleEpisodeLinks();
  const rssEpisodes = await fetchRssEpisodes(appleMaps);

  // Refresh Apple deep links on existing recent episodes if newly indexed by Apple
  let appleLinksUpdated = 0;
  for (const q of existing) {
    if (q.appleUrl === APPLE_SHOW_FALLBACK) {
      const match = appleMaps.byGuid.get(q.guid) || appleMaps.byTitle.get(q.title.toLowerCase());
      if (match) {
        q.appleUrl = match;
        appleLinksUpdated++;
      }
    }
  }

  const newEpisodes = rssEpisodes.filter((ep) => !knownGuids.has(ep.guid));
  if (newEpisodes.length === 0) {
    if (appleLinksUpdated > 0) {
      await fs.writeFile(QUESTIONS_PATH, JSON.stringify(existing, null, 2) + '\n');
      console.log(`Updated ${appleLinksUpdated} Apple Podcasts episode deep links.`);
    } else {
      console.log('Catalog is already up to date with the latest RSS feed.');
    }
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      `Found ${newEpisodes.length} new episode(s), but GEMINI_API_KEY is not set.`
    );
  }

  // Process up to 3 new episodes per weekday run (oldest-first so newest lands at index 0)
  const batch = newEpisodes.slice(0, 3).reverse();
  for (const ep of batch) {
    console.log(`Generating trivia for new episode: ${ep.title} (${ep.pubDate})...`);
    const trivia = await generateTriviaWithGemini(ep, apiKey);
    existing.unshift({
      guid: ep.guid,
      title: ep.title,
      pubDate: ep.pubDate,
      durationSec: ep.durationSec,
      artworkUrl: ep.artworkUrl,
      audioUrl: ep.audioUrl,
      appleUrl: ep.appleUrl,
      category: trivia.category,
      cueSeconds: trivia.cueSeconds,
      question: trivia.question,
      options: trivia.options,
      correctIndex: trivia.correctIndex,
      explanation: trivia.explanation,
      vaultBonus: trivia.vaultBonus
    });
  }

  await fs.writeFile(QUESTIONS_PATH, JSON.stringify(existing, null, 2) + '\n');
  console.log(`Successfully added ${batch.length} new episode(s) to questions.json!`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
