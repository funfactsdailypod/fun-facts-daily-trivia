#!/usr/bin/env ruby
# frozen_string_literal: true

require 'net/http'
require 'uri'
require 'json'
require 'time'
require 'set'
require 'zlib'

BASE_DIR = File.expand_path('..', __dir__)
QUESTIONS_PATH = File.join(BASE_DIR, 'public', 'data', 'questions.json')
RSS_URL = 'https://feeds.megaphone.fm/ARML3789803370'
APPLE_LOOKUP_URL = 'https://itunes.apple.com/lookup?id=1810507693&entity=podcastEpisode&limit=50'
APPLE_FALLBACK = 'https://podcasts.apple.com/us/podcast/fun-facts-daily/id1810507693'

puts '============================================================'
puts '  Fun Facts Daily — Local Feed Sync Agent 💡'
puts "  Checking #{RSS_URL}..."
puts '============================================================'

def fetch_url(url_str)
  uri = URI.parse(url_str)
  req = Net::HTTP::Get.new(uri)
  req['User-Agent'] = 'FunFactsDailySyncAgent/2.0'
  Net::HTTP.start(uri.hostname, uri.port, use_ssl: (uri.scheme == 'https'), open_timeout: 10, read_timeout: 20) do |http|
    res = http.request(req)
    if res.is_a?(Net::HTTPRedirection) && res['location']
      fetch_url(res['location'])
    else
      res.body.to_s.force_encoding('UTF-8')
    end
  end
rescue StandardError => e
  warn "Warning fetching #{url_str}: #{e.message}"
  nil
end

def clean_description(raw)
  (raw || '')
    .gsub(/<[^>]+>/, ' ')
    .gsub(/&nbsp;/, ' ')
    .gsub(/&amp;/, '&')
    .gsub(/&#39;|&rsquo;/, "'")
    .gsub(/&ldquo;|&rdquo;|&quot;/, '"')
    .gsub(/\u2060/, '')
    .gsub(/\s+/, ' ')
    .sub(/\s*Listen Ad-Free on Patreon[\s\S]*$/i, '')
    .sub(/\s*More to explore:[\s\S]*$/i, '')
    .sub(/\s*Want to learn more\? Head over to my website[\s\S]*$/i, '')
    .sub(/\s*The image used in the episode cover art[\s\S]*$/i, '')
    .sub(/\s*Fun Facts Daily is an Airwave Media Podcast[\s\S]*$/i, '')
    .strip
end

def classify_category(title, desc)
  title_lower = title.to_s.downcase
  full_text = "#{title_lower} #{desc.to_s.downcase}"

  rules = [
    ['Foods', /\b(toast|bread|food|foods|cooking|culinary|pizza|chocolate|cheese|coffee|tea|recipe|fruit|vegetable|spice|sugar|salt|beverage|snack|meal|dish|dessert|ice cream|pasta|cereal)\b/i],
    ['Animals', /\b(animal|animals|creature|species|squid|octopus|shark|horse|horses|equine|dog|dogs|cat|cats|bird|birds|whale|whales|insect|insects|reptile|mammal|dinosaur|mollusk|wildlife|predator|prey|zoology)\b/i],
    ['Biographies', /\b(robert smalls|biography|biographies|born in|childhood|enslaved|abolitionist|president|monarch|emperor|queen|king|inventor|pioneer|visionary)\b/i],
    ['Art', /\b(art|artist|painting|painter|sculpture|sculptor|museum|gallery|architecture|architect|fresco|canvas|pigment|renaissance|impressionism)\b/i],
    ['Geography', /\b(geography|river|mountain|volcano|island|peninsula|continent|ocean|desert|canyon|glacier|national park|subterranean|city of|country|archipelago)\b/i],
    ['Pop Culture', /\b(movie|movies|cinema|film|television|tv show|video game|toy|toys|comic|superhero|broadway|grammy|oscar|pop culture|theme park|roller coaster)\b/i],
    ['Science', /\b(nervous system|neuron|neurons|myelin|brain|spinal|nerve|nerves|seed vault|svalbard|permafrost|seed|seeds|battery|batteries|email|arpanet|electronic|voltage|anode|cathode|electrolyte|bioluminescence|chemical|chemistry|physics|physicist|astronomy|space shuttle|nasa|planet|molecule|dna|laser|quantum|engineering)\b/i],
    ['History', /\b(history|historical|civil war|world war|ancient|medieval|empire|revolution|colonial|century|dynasty|treaty|election|salem|archaeology)\b/i]
  ]

  rules.each do |cat, re|
    return cat if title_lower.match?(re)
  end

  best_cat = 'History'
  best_score = 0
  rules.each do |cat, re|
    cnt = full_text.scan(re).size
    if cnt > best_score
      best_score = cnt
      best_cat = cat
    end
  end
  best_cat
end

def deterministic_shuffle(correct_opt, distractors, seed_str)
  target_idx = Zlib.crc32(seed_str.to_s) % 4
  options = distractors.first(3).dup
  options.insert(target_idx, correct_opt)
  [options, target_idx]
end

def build_crafted_trivia_from_notes(ep)
  desc = ep[:description].to_s
  topic = ep[:title].sub(/^Fun Facts About (the |Your )?/i, '').strip
  topic_lower = topic.downcase
  category = classify_category(ep[:title], desc)

  sentences = desc
    .split(/(?<=[.?!])\s+/)
    .map(&:strip)
    .select { |s| s.length > 30 && s !~ /patreon|airwave|megaphone|who arted|art smart|rainbow puppy|advertising@|related episodes/i }

  candidates = []

  sentences.each_with_index do |s, idx|
    next_s = sentences[idx + 1]
    explanation = next_s ? "#{s} #{next_s}" : "#{s} Listen to the episode to discover even more about #{topic}!"

    if (m = s.match(/\b(?:moniker|term|name|word)\b[^.]{0,45}?\b(?:originated|coined)[^.]{0,35}?\bby\s+(?:[a-z-]+\s+){0,2}([A-Z][a-z]+(?:\s+[A-Z][a-z.-]+){1,2})\b/i))
      person = m[1].strip
      candidates << {
        type: :person,
        question: "Who coined the name for #{topic}?",
        correct: person,
        distractors: ['Humphry Davy', 'Alexander von Humboldt', 'Joseph Priestley'],
        explanation: explanation
      }
    end

    if (m = s.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z.-]+){1,2})(?:'s\s+\d{4}\s+invention\s+of|\s+(?:invented|discovered|created|developed|isolated))\s+(?:the\s+)?([a-zA-Z0-9\s-]{4,34})/))
      person = m[1].strip
      obj = m[2].sub(/[.,;:]$/, '').strip
      unless person =~ /^(United States|North America|South Carolina|World War|Space Shuttle|Civil War)/
        candidates << {
          type: :inventor,
          question: "Who invented or discovered the #{obj}?",
          correct: person,
          distractors: ['Michael Faraday', 'Thomas Edison', 'Antoine Lavoisier'],
          explanation: explanation
        }
      end
    end

    if (m = s.match(/\b(?:speeds?\s+(?:of\s+|up to\s+|reaching\s+)?|travel(?:ing)?\s+(?:at\s+|up to\s+)?)(\d+(?:,\d+)?\s+miles per hour)\b/i))
      spd = m[1].strip
      num_val = spd.to_i.nonzero? || 100
      candidates << {
        type: :speed,
        question: "What top speed is highlighted in the episode on #{topic}?",
        correct: "Up to #{spd}",
        distractors: [
          "Up to #{[5, (num_val * 0.15).round].max} miles per hour",
          "Up to #{(num_val * 0.45).round} miles per hour",
          "Up to #{(num_val * 2.1).round} miles per hour"
        ],
        explanation: explanation
      }
    end

    if (m = s.match(/\b(?:act(?:s)? as|function(?:s)? as|serve(?:s)? as)\s+(?:an?\s+)?([^,.;()]{10,52})/i))
      role = m[1].strip
      candidates << {
        type: :function,
        question: "What special role or defense is described in the episode on #{topic}?",
        correct: role[0].upcase + role[1..-1],
        distractors: [
          'Camouflaging against large predators in tall grass',
          'Absorbing solar heat to stay warm overnight',
          'Signaling social rank to rival herds'
        ],
        explanation: explanation
      }
    end

    if (m = s.match(/\b(?:process|reaction|phenomenon|condition|network|system|illusion|method|apparatus)\s+(?:is\s+)?(?:known as|called|termed)\s+(?:the\s+)?["“]?([A-Za-z][A-Za-z0-9\s-]{3,28})["”]?/i))
      term = m[1].sub(/[.,;:"”]$/, '').strip
      candidates << {
        type: :term,
        question: "Which specialized process or system is central to #{topic_lower}?",
        correct: term[0].upcase + term[1..-1],
        distractors: ['The Kelvin-Helmholtz cascade', 'Osmotic phase equilibrium', 'The Coriolis resonance effect'],
        explanation: explanation
      }
    end

    if (m = s.match(/\b(?:located|situated|permafrost|island)\s+(?:deep\s+)?(?:in|within|beneath|on|of)\s+([A-Z][A-Za-z]+(?:,?\s+[A-Z][A-Za-z]+){0,2})/))
      place = m[1].sub(/[.,;:]$/, '').strip
      if place.length.between?(4, 34)
        candidates << {
          type: :location,
          question: "Where is #{topic} located?",
          correct: place,
          distractors: ['Reykjavik, Iceland', 'Geneva, Switzerland', 'Baffin Island, Canada'],
          explanation: explanation
        }
      end
    end

    if (m = s.match(/\b(?:features?|possess(?:es)?|has|have|contains?)\s+(?:roughly\s+|nearly\s+|over\s+)?(\d+(?:,\d+)?(?:\s+million|\s+billion)?|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z]+(?:\s+[a-z]+)?)\b/i))
      qty = m[1].strip
      noun = m[2].strip
      unless noun =~ /^(years|days|hours|minutes|seconds|feet|inches|miles|meters|percent)/i
        candidates << {
          type: :count,
          question: "How many #{noun} are featured in #{topic_lower}?",
          correct: "#{qty[0].upcase}#{qty[1..-1]} #{noun}",
          distractors: ["One #{noun.sub(/s$/, '')}", "Fourteen #{noun}", "Fifty #{noun}"],
          explanation: explanation
        }
      end
    end
  end

  if candidates.size < 2
    s0 = sentences[0] || "#{topic} has a rich scientific and cultural history."
    s1 = sentences[1] || s0
    candidates << {
      type: :general1,
      question: "What key feature is highlighted in the episode about #{topic}?",
      correct: 'Its specialized structure and real-world adaptations',
      distractors: [
        'Its complete reliance on sub-zero polar temperatures',
        'Its accidental ban across nineteenth-century trade',
        'Its inability to function outside laboratory vacuum chambers'
      ],
      explanation: "#{s0} #{s1}"
    }
    candidates << {
      type: :general2,
      question: "What else do we learn about #{topic} in this episode?",
      correct: 'Surprising scientific discoveries and historical milestones',
      distractors: [
        'Why ancient astronomers mistook it for a comet',
        'How medieval guilds hid its formula for 400 years',
        'Why modern geologists classify it as a rare gemstone'
      ],
      explanation: sentences[1..2]&.join(' ').to_s.empty? ? s0 : sentences[1..2].join(' ')
    }
  end

  primary = candidates[0]
  secondary = candidates.drop(1).find { |c| c[:type] != primary[:type] } || candidates[1]

  q1_opts, q1_idx = deterministic_shuffle(primary[:correct], primary[:distractors], "#{ep[:guid]}_main")
  q2_opts, q2_idx = deterministic_shuffle(secondary[:correct], secondary[:distractors], "#{ep[:guid]}_vault")

  {
    'category' => category,
    'cueSeconds' => 165,
    'question' => primary[:question],
    'options' => q1_opts,
    'correctIndex' => q1_idx,
    'explanation' => primary[:explanation],
    'vaultBonus' => {
      'cueSeconds' => 480,
      'question' => secondary[:question],
      'options' => q2_opts,
      'correctIndex' => q2_idx,
      'explanation' => secondary[:explanation]
    }
  }
end

# 1. Fetch Apple links
apple_by_guid = {}
apple_by_title = {}
apple_raw = fetch_url(APPLE_LOOKUP_URL)
if apple_raw
  begin
    data = JSON.parse(apple_raw)
    (data['results'] || []).each do |r|
      next unless r['wrapperType'] == 'podcastEpisode'

      guid = r['episodeGuid'].to_s.strip
      track = r['trackName'].to_s.strip.downcase
      link = r['trackViewUrl']
      apple_by_guid[guid] = link unless guid.empty?
      apple_by_title[track] = link unless track.empty?
    end
  rescue StandardError => e
    warn "Apple lookup parse warning: #{e.message}"
  end
end

# 2. Fetch RSS
rss_xml = fetch_url(RSS_URL)
abort 'Error: Could not reach Megaphone RSS feed.' unless rss_xml

items = rss_xml.scan(/<item>[\s\S]*?<\/item>/)
puts "Found #{items.size} total items in RSS feed."

# 3. Read existing questions.json
questions = JSON.parse(File.read(QUESTIONS_PATH))
known_guids = questions.map { |q| q['guid'] }.to_set
puts "Current questions catalog contains #{questions.size} episodes."

# Refresh Apple deep links on recent episodes
apple_updates = 0
questions.first(30).each do |q|
  next unless q['appleUrl'] == APPLE_FALLBACK

  link = apple_by_guid[q['guid']] || apple_by_title[q['title'].to_s.downcase]
  if link
    q['appleUrl'] = link
    apple_updates += 1
  end
end

new_episodes = []
recent_items_dump = []

items.each_with_index do |item, idx|
  title = item[/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i, 1].to_s.strip
  ep_type = item[/<itunes:episodeType>([\s\S]*?)<\/itunes:episodeType>/i, 1].to_s.strip.downcase
  next if ep_type == 'trailer' || ep_type == 'bonus' || title =~ /^(You Might Also Like|Introducing|Preview|Trailer)/i

  guid = item[/<guid[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/guid>/i, 1].to_s.strip
  pub_date = item[/<pubDate>([\s\S]*?)<\/pubDate>/i, 1].to_s.strip
  duration_sec = (item[/<itunes:duration>([\s\S]*?)<\/itunes:duration>/i, 1] || 900).to_i
  raw_img = item[/<itunes:image[^>]*href="([^"]+)"/i, 1].to_s.gsub('&amp;', '&')
  art_url = if !raw_img.empty?
              raw_img.sub('max-w=3000&max-h=3000', 'max-w=600&max-h=600')
            else
              'https://megaphone.imgix.net/podcasts/fe3784ae-198b-11f0-91a3-0f6a7cb73d31/image/68ba595ba6ba941c972898366cb62e76.png?ixlib=rails-4.3.1&max-w=600&max-h=600&fit=crop&auto=format,compress'
            end
  audio_url = item[/<enclosure[^>]*url="([^"]+)"/i, 1]
  raw_desc = item[/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/i, 1] ||
             item[/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i, 1]
  clean_desc = clean_description(raw_desc)
  apple_url = apple_by_guid[guid] || apple_by_title[title.downcase] || APPLE_FALLBACK

  ep_hash = {
    guid: guid,
    title: title,
    pubDate: pub_date,
    durationSec: duration_sec,
    artworkUrl: art_url,
    audioUrl: audio_url,
    appleUrl: apple_url,
    description: clean_desc
  }
  recent_items_dump << ep_hash if recent_items_dump.size < 18
  next if guid.empty? || known_guids.include?(guid)

  new_episodes << ep_hash
end

File.write('/tmp/ffd_latest_rss.json', JSON.pretty_generate(recent_items_dump))

if new_episodes.empty?
  if apple_updates > 0
    File.write(QUESTIONS_PATH, JSON.pretty_generate(questions) + "\n")
    puts "✓ Catalog is up to date! Refreshed #{apple_updates} Apple Podcasts deep links."
  else
    puts "✓ Catalog is already up to date with the latest published episode: \"#{questions[0]['title']}\""
  end
  exit 0
end

puts "Found #{new_episodes.size} new episode(s) to add:"

new_episodes.reverse_each do |ep|
  trivia = build_crafted_trivia_from_notes(ep)
  entry = {
    'guid' => ep[:guid],
    'title' => ep[:title],
    'pubDate' => ep[:pubDate],
    'durationSec' => ep[:durationSec],
    'artworkUrl' => ep[:artworkUrl],
    'audioUrl' => ep[:audioUrl],
    'appleUrl' => ep[:appleUrl]
  }.merge(trivia)

  questions.unshift(entry)
  puts "  + Added \"#{ep[:title]}\" (#{trivia['category']})"
end

File.write(QUESTIONS_PATH, JSON.pretty_generate(questions) + "\n")
puts '============================================================'
puts "  ✓ Success! Catalog updated to #{questions.size} episodes."
puts "  Latest episode: \"#{questions[0]['title']}\""
puts '============================================================'
