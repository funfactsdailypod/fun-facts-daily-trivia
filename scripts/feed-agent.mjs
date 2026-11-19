#!/usr/bin/env node
/**
 * Fun Facts Daily — Automated Weekday RSS Feed & Gemini Flash Trivia Agent
 * Zero npm dependencies required (uses built-in Node 20/22 fetch & fs).
 *
 * Environment variables:
 *   GEMINI_API_KEY     (Recommended — free key from https://aistudio.google.com/apikey)
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
  return m ? m[1].replace(/&amp;/g, '&').trim() : '';
}

function cleanDescription(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/\u2060/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*Listen Ad-Free on Patreon[\s\S]*$/i, '')
    .replace(/\s*More to explore:[\s\S]*$/i, '')
    .replace(/\s*Want to learn more\? Head over to my website[\s\S]*$/i, '')
    .replace(/\s*The image used in the episode cover art[\s\S]*$/i, '')
    .replace(/\s*Fun Facts Daily is an Airwave Media Podcast[\s\S]*$/i, '')
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
    const description = cleanDescription(
      extractTag(block, 'content:encoded') || extractTag(block, 'description')
    );

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

export function classifyEpisodeCategory(title, description) {
  const titleLower = String(title || '').toLowerCase();
  const fullText = `${titleLower} ${String(description || '').toLowerCase()}`;

  // Check title first for strong topical signal, using strict word boundaries (\b)
  const rules = [
    {
      cat: 'Foods',
      re: /\b(toast|bread|food|foods|cooking|culinary|pizza|chocolate|cheese|coffee|tea|recipe|fruit|vegetable|spice|sugar|salt|beverage|snack|meal|dish|dessert|ice cream|pasta|cereal)\b/i
    },
    {
      cat: 'Animals',
      re: /\b(animal|animals|creature|species|squid|octopus|shark|horse|horses|equine|dog|dogs|cat|cats|bird|birds|whale|whales|insect|insects|reptile|mammal|dinosaur|mollusk|wildlife|predator|prey|zoology)\b/i
    },
    {
      cat: 'Biographies',
      re: /\b(robert smalls|biography|biographies|born in|childhood|enslaved|abolitionist|president|monarch|emperor|queen|king|inventor|pioneer|visionary)\b/i
    },
    {
      cat: 'Art',
      re: /\b(art|artist|painting|painter|sculpture|sculptor|museum|gallery|architecture|architect|fresco|canvas|pigment|renaissance|impressionism)\b/i
    },
    {
      cat: 'Geography',
      re: /\b(geography|river|mountain|volcano|island|peninsula|continent|ocean|desert|canyon|glacier|national park|subterranean|city of|country|archipelago)\b/i
    },
    {
      cat: 'Pop Culture',
      re: /\b(movie|movies|cinema|film|television|tv show|video game|toy|toys|comic|superhero|broadway|grammy|oscar|pop culture|theme park|roller coaster)\b/i
    },
    {
      cat: 'Science',
      re: /\b(nervous system|neuron|neurons|myelin|brain|spinal|nerve|nerves|seed vault|svalbard|permafrost|seed|seeds|battery|batteries|email|arpanet|electronic|voltage|anode|cathode|electrolyte|bioluminescence|chemical|chemistry|physics|physicist|astronomy|space shuttle|nasa|planet|molecule|dna|laser|quantum|engineering)\b/i
    },
    {
      cat: 'History',
      re: /\b(history|historical|civil war|world war|ancient|medieval|empire|revolution|colonial|century|dynasty|treaty|election|salem|archaeology)\b/i
    }
  ];

  for (const r of rules) {
    if (r.re.test(titleLower)) return r.cat;
  }

  let bestCat = 'History';
  let bestScore = 0;
  for (const r of rules) {
    const matches = fullText.match(new RegExp(r.re.source, 'gi'));
    const count = matches ? matches.length : 0;
    if (count > bestScore) {
      bestScore = count;
      bestCat = r.cat;
    }
  }
  return bestCat;
}

function validateGeneratedTrivia(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const checkQ = (qObj) => {
    if (!qObj || typeof qObj.question !== 'string') return false;
    const q = qObj.question.trim();
    if (q.length < 15 || q.length > 130) return false;
    if (/^(regarding|according to the episode|in the episode on|in the history of)\b/i.test(q)) return false;
    if (/which of the following is true/i.test(q)) return false;
    if (!Array.isArray(qObj.options) || qObj.options.length !== 4) return false;
    if (qObj.options.some((o) => typeof o !== 'string' || o.trim().length < 2 || o.trim().endsWith('...'))) {
      return false;
    }
    if (![0, 1, 2, 3].includes(Number(qObj.correctIndex))) return false;
    if (typeof qObj.explanation !== 'string' || qObj.explanation.length < 30) return false;
    return true;
  };
  return checkQ(parsed) && checkQ(parsed.vaultBonus);
}

async function generateTriviaWithGemini(episode, apiKey) {
  const prompt = `You write clear, concise, natural, family-friendly multiple-choice trivia questions for listeners of the daily podcast "Fun Facts Daily" hosted by Kyle Wood.

Match the exact clear, conversational, and concise phrasing of these examples (notice how every question is a direct 5-to-14-word question without any long introductory clauses):

Example 1 (Fun Facts About Impressionism):
- Question: "Who coined the term Impressionist?"
- Options: ["Art critic Louis Leroy", "Painter Claude Monet", "Patron Gustave Caillebotte", "Artist Mary Cassatt"]
- CorrectIndex: 0
- Explanation: "French art critic Louis Leroy coined the term as an insult in his 1874 review mocking Claude Monet's painting Impression, Sunrise for looking like an unfinished sketch. Instead of rejecting the label, the artists proudly adopted it!"

Example 2 (Fun Facts About Zebras):
- Question: "How do a zebra's stripes help them?"
- Options: ["They camouflage zebras in tall grass from lions", "They confuse biting horseflies so the insects cannot land", "They absorb sunlight to warm the zebra at night", "They signal social rank within the herd"]
- CorrectIndex: 1
- Explanation: "Lions cannot even distinguish zebra stripes from more than 164 feet away! Instead, a zebra's high-contrast stripes act as an optical defense that scrambles the flight vision of biting horseflies, causing the insects to miss their landing."

Example 3 (Fun Facts About Your Nervous System):
- Question: "How fast can nerve signals travel if the neurons have a myelin sheath?"
- Options: ["Up to 25 miles per hour", "Up to 100 miles per hour", "Up to 268 miles per hour", "Up to 500 miles per hour"]
- CorrectIndex: 2
- Explanation: "Insulated by a protective myelin sheath, alpha motor neurons can transmit electrical impulses at speeds up to 268 miles per hour! Unmyelinated pain fibers, by contrast, travel at a small fraction of that speed."

Example 4 (Fun Facts About Squid):
- Question: "How many hearts does a squid have?"
- Options: ["One heart", "Two hearts", "Three hearts", "Four hearts"]
- CorrectIndex: 2
- Explanation: "Squid have three hearts! Two branchial hearts pump blood through the gills, while a central systemic heart circulates oxygenated blue blood through the rest of the body."

STRICT QUESTION PHRASING RULES:
1. Keep every question SHORT, CLEAR, DIRECT, and NATURAL (5 to 14 words long, maximum 110 characters).
2. NEVER start a question with clunky preambles like "Regarding...", "According to the episode...", "In the episode on...", "Although...", or "While...".
3. Start directly with a simple question word ("Who...", "What...", "How...", "How many...", "How fast...", "Where...", "Why...", "Which...", "When...").
4. NEVER copy-paste a long sentence from the show notes with a blank in the middle. Write a fresh, simple, conversational question that a human trivia host would ask out loud.
5. All 4 options MUST be concise (2 to 9 words each), grammatically parallel, plausible, and NEVER truncated with "...".
6. Vary "correctIndex" naturally across 0, 1, 2, and 3.
7. "vaultBonus" MUST be an equally short, clear question testing a DIFFERENT fact from the episode.

Now write the Daily Double question and Weekend Vault Bonus question for this episode:
Episode Title: ${episode.title}
Episode Duration: ${episode.durationSec} seconds
Episode Show Notes:
${episode.description}

Return a single JSON object matching this exact structure:
{
  "category": "<strictly one of: ${ALLOWED_CATEGORIES.join(' | ')}>",
  "cueSeconds": <integer timestamp in seconds between 120 and 450>,
  "question": "<short, clear, natural 5-to-14-word question>",
  "options": ["<Option A>", "<Option B>", "<Option C>", "<Option D>"],
  "correctIndex": <0, 1, 2, or 3>,
  "explanation": "<2 warm, upbeat sentences explaining the correct answer>",
  "vaultBonus": {
    "cueSeconds": <integer timestamp in seconds between 450 and 800>,
    "question": "<short, clear, natural 5-to-14-word question testing a DIFFERENT fact>",
    "options": ["<Option A>", "<Option B>", "<Option C>", "<Option D>"],
    "correctIndex": <0, 1, 2, or 3>,
    "explanation": "<2 warm sentences explaining the second fact>"
  }
}`;

  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.35,
              responseMimeType: 'application/json'
            }
          })
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${model} HTTP ${res.status}: ${errText}`);
      }

      const body = await res.json();
      const rawJson = (body.candidates?.[0]?.content?.parts?.[0]?.text || '')
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(rawJson);

      if (!ALLOWED_CATEGORIES.includes(parsed.category)) {
        parsed.category = classifyEpisodeCategory(episode.title, episode.description);
      }
      if (!validateGeneratedTrivia(parsed)) {
        throw new Error(`${model} returned JSON that did not pass quality validation`);
      }
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn(`Model ${model} attempt warning: ${err.message}`);
    }
  }

  throw lastError || new Error('All Gemini models failed');
}

function deterministicShuffle(correctOption, distractors, seedStr) {
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const targetIdx = Math.abs(hash) % 4;
  const options = [...distractors.slice(0, 3)];
  options.splice(targetIdx, 0, correctOption);
  return { options, correctIndex: targetIdx };
}

/**
 * Concise Natural Question Generator (used if GEMINI_API_KEY is not configured).
 * Never masks or pastes long show-notes sentences; always builds short, direct 5-to-13-word questions.
 */
export function buildCraftedTriviaFromNotes(episode) {
  const desc = episode.description || '';
  const topic = episode.title.replace(/^Fun Facts About (the |Your )?/i, '').trim();
  const topicLower = topic.toLowerCase();
  const category = classifyEpisodeCategory(episode.title, desc);

  const sentences = desc
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 30 &&
        !/patreon|airwave|megaphone|who arted|art smart|rainbow puppy|advertising@|related episodes/i.test(s)
    );

  const candidates = [];

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const nextS = sentences[i + 1] || '';
    const explanation = nextS ? `${s} ${nextS}` : `${s} Listen to the episode to discover even more about ${topic}!`;

    // 1. Coined / Originated term or moniker ("Who coined...?")
    const coinedMatch = s.match(
      /\b(?:moniker|term|name|word)\b[^.]{0,45}?\b(?:originated|coined)[^.]{0,35}?\bby\s+(?:[a-z-]+\s+){0,2}([A-Z][a-z]+(?:\s+[A-Z][a-z.-]+){1,2})\b/i
    );
    if (coinedMatch) {
      const person = coinedMatch[1].trim();
      candidates.push({
        type: 'person',
        question: `Who coined the name for ${topic}?`,
        correct: person,
        distractors: ['Humphry Davy', 'Alexander von Humboldt', 'Joseph Priestley'],
        explanation
      });
    }

    // 2. Inventor / Discoverer ("Who invented / discovered X?")
    const invMatch = s.match(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.-]+){1,2})(?:'s\s+\d{4}\s+invention\s+of|\s+(?:invented|discovered|created|developed|isolated))\s+(?:the\s+)?([a-zA-Z0-9\s-]{4,34})/
    );
    if (invMatch && !/^(United States|North America|South Carolina|World War|Space Shuttle|Civil War)/.test(invMatch[1])) {
      const person = invMatch[1].trim();
      const obj = invMatch[2].replace(/[.,;:]$/, '').trim();
      candidates.push({
        type: 'inventor',
        question: `Who invented or discovered the ${obj}?`,
        correct: person,
        distractors: ['Michael Faraday', 'Thomas Edison', 'Antoine Lavoisier'],
        explanation
      });
    }

    // 3. Speed ("How fast...?")
    const speedMatch = s.match(/\b(?:speeds?\s+(?:of\s+|up to\s+|reaching\s+)?|travel(?:ing)?\s+(?:at\s+|up to\s+)?)(\d+(?:,\d+)?\s+miles per hour)\b/i);
    if (speedMatch) {
      const spd = speedMatch[1].trim();
      const numVal = parseInt(spd, 10) || 100;
      candidates.push({
        type: 'speed',
        question: `What top speed is highlighted in the episode on ${topic}?`,
        correct: `Up to ${spd}`,
        distractors: [
          `Up to ${Math.max(5, Math.round(numVal * 0.15))} miles per hour`,
          `Up to ${Math.round(numVal * 0.45)} miles per hour`,
          `Up to ${Math.round(numVal * 2.1)} miles per hour`
        ],
        explanation
      });
    }

    // 4. Function / Defense / Purpose ("How do X help...?")
    const funcMatch = s.match(
      /\b(?:act(?:s)? as|function(?:s)? as|serve(?:s)? as)\s+(?:an?\s+)?([^,.;()]{10,52})/i
    );
    if (funcMatch) {
      const role = funcMatch[1].trim();
      const cleanRole = role.charAt(0).toUpperCase() + role.slice(1);
      candidates.push({
        type: 'function',
        question: `What special role or defense is described in the episode on ${topic}?`,
        correct: cleanRole,
        distractors: [
          'Camouflaging against large predators in tall grass',
          'Absorbing solar heat to stay warm overnight',
          'Signaling social rank to rival herds'
        ],
        explanation
      });
    }

    // 5. Named scientific or historical term ("What is the term for...?")
    const termMatch = s.match(
      /\b(?:process|reaction|phenomenon|condition|network|system|illusion|method|apparatus)\s+(?:is\s+)?(?:known as|called|termed)\s+(?:the\s+)?["“]?([A-Za-z][A-Za-z0-9\s-]{3,28})["”]?/i
    );
    if (termMatch) {
      const term = termMatch[1].replace(/[.,;:"”]$/, '').trim();
      candidates.push({
        type: 'term',
        question: `Which specialized process or system is central to ${topicLower}?`,
        correct: term.charAt(0).toUpperCase() + term.slice(1),
        distractors: [
          'The Kelvin-Helmholtz cascade',
          'Osmotic phase equilibrium',
          'The Coriolis resonance effect'
        ],
        explanation
      });
    }

    // 6. Location ("Where is X located?")
    const locMatch = s.match(
      /\b(?:located|situated|permafrost|island)\s+(?:deep\s+)?(?:in|within|beneath|on|of)\s+([A-Z][A-Za-z]+(?:,?\s+[A-Z][A-Za-z]+){0,2})/
    );
    if (locMatch && locMatch[1].length >= 4 && locMatch[1].length <= 34) {
      const place = locMatch[1].replace(/[.,;:]$/, '').trim();
      candidates.push({
        type: 'location',
        question: `Where is ${topic} located?`,
        correct: place,
        distractors: ['Reykjavik, Iceland', 'Geneva, Switzerland', 'Baffin Island, Canada'],
        explanation
      });
    }

    // 7. Count ("How many X does Y have?")
    const countMatch = s.match(
      /\b(?:features?|possess(?:es)?|has|have|contains?)\s+(?:roughly\s+|nearly\s+|over\s+)?(\d+(?:,\d+)?(?:\s+million|\s+billion)?|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z]+(?:\s+[a-z]+)?)\b/i
    );
    if (countMatch && !/^(years|days|hours|minutes|seconds|feet|inches|miles|meters|percent)/i.test(countMatch[2])) {
      const qty = countMatch[1].trim();
      const noun = countMatch[2].trim();
      candidates.push({
        type: 'count',
        question: `How many ${noun} are featured in ${topicLower}?`,
        correct: `${qty.charAt(0).toUpperCase() + qty.slice(1)} ${noun}`,
        distractors: [`One ${noun.replace(/s$/, '')}`, `Fourteen ${noun}`, `Fifty ${noun}`],
        explanation
      });
    }
  }

  if (candidates.length < 2) {
    const s0 = sentences[0] || `${topic} has a rich scientific and cultural history.`;
    const s1 = sentences[1] || s0;
    candidates.push({
      type: 'general1',
      question: `What key feature is highlighted in the episode about ${topic}?`,
      correct: 'Its specialized structure and real-world adaptations',
      distractors: [
        'Its complete reliance on sub-zero polar temperatures',
        'Its accidental ban across nineteenth-century trade',
        'Its inability to function outside laboratory vacuum chambers'
      ],
      explanation: `${s0} ${s1}`
    });
    candidates.push({
      type: 'general2',
      question: `What else do we learn about ${topic} in this episode?`,
      correct: 'Surprising scientific discoveries and historical milestones',
      distractors: [
        'Why ancient astronomers mistook it for a comet',
        'How medieval guilds hid its formula for 400 years',
        'Why modern geologists classify it as a rare gemstone'
      ],
      explanation: `${sentences.slice(1, 3).join(' ') || s0}`
    });
  }

  const primary = candidates[0];
  const secondary = candidates.find((c, idx) => idx > 0 && c.type !== primary.type) || candidates[1];

  const q1Shuffle = deterministicShuffle(primary.correct, primary.distractors, `${episode.guid}_main`);
  const q2Shuffle = deterministicShuffle(secondary.correct, secondary.distractors, `${episode.guid}_vault`);

  return {
    category,
    cueSeconds: 165,
    question: primary.question,
    options: q1Shuffle.options,
    correctIndex: q1Shuffle.correctIndex,
    explanation: primary.explanation,
    vaultBonus: {
      cueSeconds: 480,
      question: secondary.question,
      options: q2Shuffle.options,
      correctIndex: q2Shuffle.correctIndex,
      explanation: secondary.explanation
    }
  };
}

async function pingSupabaseKeepAlive() {
  const rawUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!rawUrl || !key) return;
  const url = String(rawUrl).trim().replace(/\/+$/, '').replace(/\/rest\/v1\/?$/, '');
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
    console.warn(
      'GEMINI_API_KEY not found in environment. Using Smart Fact-Mining Generator on episode show notes.'
    );
  }

  // Process up to 5 new episodes per weekday run (oldest-first so newest lands at index 0)
  const batch = newEpisodes.slice(0, 5).reverse();
  for (const ep of batch) {
    console.log(`Generating trivia for new episode: ${ep.title} (${ep.pubDate})...`);
    let trivia = null;
    if (apiKey) {
      try {
        trivia = await generateTriviaWithGemini(ep, apiKey);
      } catch (err) {
        console.warn(`Gemini API generation failed (${err.message}). Using Smart Fact-Mining Generator.`);
      }
    }
    if (!trivia) {
      trivia = buildCraftedTriviaFromNotes(ep);
    }

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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
