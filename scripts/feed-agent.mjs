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
      re: /\b(battery|batteries|email|arpanet|electronic|voltage|anode|cathode|electrolyte|bioluminescence|chemical|chemistry|physics|physicist|astronomy|space shuttle|nasa|planet|molecule|dna|neuron|laser|quantum|engineering)\b/i
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
    if (!qObj || typeof qObj.question !== 'string' || qObj.question.length < 20) return false;
    if (/which of the following is true/i.test(qObj.question)) return false;
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
  const prompt = `You write engaging, family-friendly multiple-choice trivia questions for listeners of the daily podcast "Fun Facts Daily" hosted by Kyle Wood.

Match the exact quality, specificity, and upbeat tone of these gold-standard examples from the first 400 episodes:

Example 1 (Fun Facts About Horses):
- Question: "Although James Watt defined one horsepower as lifting 33,000 foot-pounds per minute, roughly how much peak power can a single draft horse generate in a brief burst?"
- Options: ["Exactly 1 horsepower", "About 4 horsepower", "Nearly 15 horsepower", "Over 45 horsepower"]
- CorrectIndex: 2
- Explanation: "Watt's famous horsepower metric measured sustainable work averaged over an entire workday rather than maximum athletic output. During short, explosive efforts, a powerful draft horse can actually generate close to 15 horsepower!"

Example 2 (Fun Facts About Kid Inventors):
- Question: "Which breakthrough in electronic image transmission was famously conceptualized by 14-year-old Philo Farnsworth after observing the parallel rows of a plowed field?"
- Options: ["Fiber-optic cabling", "The rotary dial telephone", "All-electronic television", "Marine radar navigation"]
- CorrectIndex: 2
- Explanation: "At age 14, farm teen Philo Farnsworth realized an electron beam could scan pictures line by line just like rows in a plowed field. Turning everyday observation into complex engineering, he laid the foundation for modern electronic television."

Example 3 (Fun Facts About Toast):
- Question: "Which chemical process—discovered by a French physician in 1912—rearranges amino acids and simple sugars between 280°F and 330°F to give toast its golden-brown crust and aroma?"
- Options: ["The Pasteur fermentation cycle", "The Maillard reaction", "Alkaline hydrolysis", "Starch sublimation"]
- CorrectIndex: 1
- Explanation: "Named after French physician Louis-Camille Maillard, the Maillard reaction occurs when heat triggers amino acids and simple sugars to form Amadori compounds and savory aroma molecules that give toasted bread, roasted coffee, and seared foods their signature flavor."

STRICT QUALITY RULES:
1. NEVER write generic questions like "Which of the following is true about X?" or "What is another detail shared about X?".
2. Always ask a specific, curiosity-sparking question about a standout concrete fact from the episode (a specific person, invention, chemical/biological mechanism, historical event, ship/place, or surprising measurement).
3. All 4 options MUST be concise (2 to 9 words each), grammatically parallel, plausible within the same domain, and NEVER truncated with "...".
4. Vary "correctIndex" naturally across 0, 1, 2, and 3.
5. "vaultBonus" MUST test a completely DIFFERENT fact from the episode than the main question.

Now write the Daily Double question and Weekend Vault Bonus question for this episode:
Episode Title: ${episode.title}
Episode Duration: ${episode.durationSec} seconds
Episode Show Notes:
${episode.description}

Return a single JSON object matching this exact structure:
{
  "category": "<strictly one of: ${ALLOWED_CATEGORIES.join(' | ')}>",
  "cueSeconds": <integer timestamp in seconds between 120 and 450>,
  "question": "<specific, engaging multiple-choice trivia question>",
  "options": ["<Option A>", "<Option B>", "<Option C>", "<Option D>"],
  "correctIndex": <0, 1, 2, or 3>,
  "explanation": "<2-3 warm, upbeat sentences explaining the correct answer>",
  "vaultBonus": {
    "cueSeconds": <integer timestamp in seconds between 450 and 800>,
    "question": "<second specific trivia question testing a DIFFERENT fact from the episode>",
    "options": ["<Option A>", "<Option B>", "<Option C>", "<Option D>"],
    "correctIndex": <0, 1, 2, or 3>,
    "explanation": "<2-3 warm sentences explaining the second fact>"
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
 * Smart Fact-Mining Question Generator (used if GEMINI_API_KEY is not configured).
 * Extracts concrete named terms, pioneers/inventors, years, and measurements from the show notes
 * to build natural, specific multiple-choice questions matching the style of the first 400 episodes.
 */
export function buildCraftedTriviaFromNotes(episode) {
  const desc = episode.description || '';
  const topic = episode.title.replace(/^Fun Facts About (the )?/i, '').trim();
  const category = classifyEpisodeCategory(episode.title, desc);

  const sentences = desc
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 30 &&
        !/patreon|airwave|megaphone|who arted|art smart|rainbow puppy|advertising@/i.test(s)
    );

  const candidates = [];

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const nextS = sentences[i + 1] || '';
    const explanation = nextS ? `${s} ${nextS}` : `${s} Listen to the episode to discover even more about ${topic}!`;

    // 1. Named term / process / phenomenon ("known as X", "called X", "termed X")
    const termMatch = s.match(
      /\b(?:known as|called|termed|named|dubbed)\s+(?:the\s+)?["“]?([A-Z]?[a-zA-Z0-9-]+(?:\s+[a-zA-Z0-9-]+){0,3})["”]?/
    );
    if (termMatch && termMatch[1].length >= 4 && termMatch[1].length <= 36) {
      const term = termMatch[1].replace(/[.,;:"”]$/, '').trim();
      const clue = s
        .replace(termMatch[0], 'what specialized term or phenomenon')
        .replace(/\.$/, '');
      candidates.push({
        type: 'term',
        question: `In the episode on ${topic}, ${clue.charAt(0).toLowerCase() + clue.slice(1)}?`,
        correct: term.charAt(0).toUpperCase() + term.slice(1),
        distractors: [
          'The Kelvin-Helmholtz cascade',
          'Osmotic phase equilibrium',
          'The Coriolis resonance effect'
        ],
        explanation
      });
    }

    // 2. Named historical figure / scientist / pioneer
    const personMatch = s.match(
      /\b(?:by|when)\s+(?:[a-z-]+\s+){0,3}([A-Z][a-z]+(?:\s+[A-Z][a-z.-]+){1,2})\b/
    );
    if (personMatch && !/^(United States|North America|South Carolina|World War|Space Shuttle|Civil War)/.test(personMatch[1])) {
      const person = personMatch[1].trim();
      const masked = s.replace(person, 'which historical figure or researcher').replace(/\.$/, '');
      candidates.push({
        type: 'person',
        question: `According to the episode on ${topic}, ${masked.charAt(0).toLowerCase() + masked.slice(1)}?`,
        correct: person,
        distractors: ['Humphry Davy', 'alexander von Humboldt', 'Joseph Priestley'].map(
          (n) => n.charAt(0).toUpperCase() + n.slice(1)
        ),
        explanation
      });
    }

    // 3. Specific numeric measurement with units
    const numMatch = s.match(
      /\b((?:roughly\s+|nearly\s+|over\s+|up to\s+)?(?:\d+(?:,\d+)?(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred)\s+(?:to\s+\d+\s+)?(?:hearts|degrees(?:\s+Fahrenheit)?|miles per hour|percent|inches|feet|meters|volts|horsepower|checkpoints|terms|cells|years))\b/i
    );
    if (numMatch) {
      const qty = numMatch[1].trim();
      const unitWord = qty.split(/\s+/).pop();
      const masked = s.replace(numMatch[1], `how many ${unitWord}`).replace(/\.$/, '');
      candidates.push({
        type: 'number',
        question: `Regarding ${topic}, ${masked.charAt(0).toLowerCase() + masked.slice(1)}?`,
        correct: qty.charAt(0).toUpperCase() + qty.slice(1),
        distractors: [
          `Exactly 2 ${unitWord}`,
          `Roughly 45 ${unitWord}`,
          `More than 250 ${unitWord}`
        ].filter((d) => d.toLowerCase() !== qty.toLowerCase()),
        explanation
      });
    }

    // 4. Specific year milestone
    const yearMatch = s.match(/\b(?:in|during)\s+(?:late\s+|early\s+)?(1[6-9]\d\d|20[0-2]\d)\b/i);
    if (yearMatch) {
      const yr = Number(yearMatch[1]);
      const masked = s.replace(yearMatch[1], 'what year').replace(/\.$/, '');
      candidates.push({
        type: 'year',
        question: `In the history of ${topic}, ${masked.charAt(0).toLowerCase() + masked.slice(1)}?`,
        correct: String(yr),
        distractors: [String(yr - 18), String(yr + 14), String(yr + 31)],
        explanation
      });
    }
  }

  // Ensure at least 2 distinct questions
  if (candidates.length < 2) {
    const s0 = sentences[0] || `${topic} has a rich scientific and cultural history.`;
    const s1 = sentences[1] || s0;
    candidates.push({
      type: 'general1',
      question: `What primary characteristic or breakthrough is highlighted at the start of the episode on ${topic}?`,
      correct: `Its specialized structure and historical evolution`,
      distractors: [
        'Its complete reliance on sub-zero polar temperatures',
        'Its accidental ban across nineteenth-century maritime trade',
        'Its inability to function outside laboratory vacuum chambers'
      ],
      explanation: `${s0} ${s1}`
    });
    candidates.push({
      type: 'general2',
      question: `Which additional aspect of ${topic} is explored later in the episode?`,
      correct: `Real-world applications and surprising physical adaptations`,
      distractors: [
        'Why ancient astronomers mistook it for a planetary alignment',
        'How medieval guilds kept its formula secret for 400 years',
        'Why modern scientists classify it as a synthetic mineral'
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
