export const SHOW_CONFIG = {
  title: 'Fun Facts Daily',
  host: 'Kyle Wood',
  rssFeedUrl: 'https://feeds.megaphone.fm/ARML3789803370',
  appleShowId: '1810507693',
  appleShowUrl: 'https://podcasts.apple.com/us/podcast/fun-facts-daily/id1810507693',
  appleReviewUrl: 'https://podcasts.apple.com/us/podcast/fun-facts-daily/id1810507693?action=write-review',
  patreonUrl: 'https://www.patreon.com/cw/FunFactsDailyPod',
  podlinkUrl: 'https://pod.link/1810507693',
  defaultArtwork:
    'https://megaphone.imgix.net/podcasts/fe3784ae-198b-11f0-91a3-0f6a7cb73d31/image/68ba595ba6ba941c972898366cb62e76.png?ixlib=rails-4.3.1&max-w=600&max-h=600&fit=crop&auto=format,compress',
  points: {
    dailyDouble: 20,
    weekendVault: 15,
    archiveQuestion: 10,
    friendsCorrectBase: 10,
    friendsFirstBonus: 5,
    friendsSecondBonus: 2
  }
};

/**
 * Optional $0/month Supabase Free Tier config for global Play with Friends multiplayer.
 * When left empty, Play with Friends automatically uses the local HTTP room API (for phones on Wi-Fi)
 * plus BroadcastChannel/localStorage sync across browser tabs!
 */
export const CLOUD_CONFIG = {
  supabaseUrl: 'https://bvxpgmhceljtoqppjhvy.supabase.co/rest/v1/',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2eHBnbWhjZWxqdG9xcHBqaHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNzMyMDIsImV4cCI6MjEwOTY0OTIwMn0.CnB5eFwkDJRPBBOLp9vS0x2tuXjP8PYZsHIh7JbSQJA'
};

export const CATEGORIES = [
  { id: 'ALL', label: 'Give me everything!', icon: '✨', color: '#FFD23F' },
  { id: 'Animals', label: 'Animals', icon: '🐾', color: '#FF9F1C' },
  { id: 'Foods', label: 'Foods', icon: '🍕', color: '#FF5C5C' },
  { id: 'Art', label: 'Art', icon: '🎨', color: '#C77DFF' },
  { id: 'Science', label: 'Science', icon: '🔬', color: '#00BFA6' },
  { id: 'Geography', label: 'Geography', icon: '🌍', color: '#2EC4B6' },
  { id: 'History', label: 'History', icon: '🏛️', color: '#FF7A00' },
  { id: 'Pop Culture', label: 'Pop Culture', icon: '🎬', color: '#FF4D8D' },
  { id: 'Biographies', label: 'Biographies', icon: '🌟', color: '#4CC9F0' }
];

export const BADGES = [
  {
    id: 'first_spark',
    title: 'First Spark',
    icon: '☀️',
    color: '#FFD23F',
    description: 'Answer your first Daily Double correctly.',
    check: (s) => s.dailyCorrectCount >= 1,
    progress: (s) => [Math.min(s.dailyCorrectCount, 1), 1]
  },
  {
    id: 'streak_5',
    title: 'High-Five Streak',
    icon: '🔥',
    color: '#FF7A00',
    description: 'Reach a 5-day weekday streak on the Daily Double.',
    check: (s) => s.bestStreak >= 5,
    progress: (s) => [Math.min(s.bestStreak, 5), 5]
  },
  {
    id: 'streak_10',
    title: 'Two-Week Titan',
    icon: '⚡',
    color: '#FF5C00',
    description: 'Reach a 10-day weekday streak (two full broadcast weeks!).',
    check: (s) => s.bestStreak >= 10,
    progress: (s) => [Math.min(s.bestStreak, 10), 10]
  },
  {
    id: 'streak_20',
    title: 'Monthly Master',
    icon: '👑',
    color: '#FFB703',
    description: 'Reach a 20-day weekday Daily Double streak.',
    check: (s) => s.bestStreak >= 20,
    progress: (s) => [Math.min(s.bestStreak, 20), 20]
  },
  {
    id: 'pts_100',
    title: 'Century Club',
    icon: '💯',
    color: '#00BFA6',
    description: 'Score 100 cumulative trivia points.',
    check: (s) => s.totalPoints >= 100,
    progress: (s) => [Math.min(s.totalPoints, 100), 100]
  },
  {
    id: 'pts_300',
    title: 'Fact Collector',
    icon: '🧠',
    color: '#4CC9F0',
    description: 'Score 300 cumulative trivia points.',
    check: (s) => s.totalPoints >= 300,
    progress: (s) => [Math.min(s.totalPoints, 300), 300]
  },
  {
    id: 'pts_1000',
    title: 'Fun Facts Legend',
    icon: '🏆',
    color: '#C77DFF',
    description: 'Score 1,000 cumulative trivia points across your sessions.',
    check: (s) => s.totalPoints >= 1000,
    progress: (s) => [Math.min(s.totalPoints, 1000), 1000]
  },
  {
    id: 'pts_2000',
    title: '2,000-Point Scholar',
    icon: '🌟',
    color: '#FFD166',
    description: 'Score 2,000 cumulative trivia points across your sessions.',
    check: (s) => s.totalPoints >= 2000,
    progress: (s) => [Math.min(s.totalPoints, 2000), 2000]
  },
  {
    id: 'pts_3000',
    title: '3,000-Point Mastermind',
    icon: '🚀',
    color: '#06D6A0',
    description: 'Score 3,000 cumulative trivia points across your sessions.',
    check: (s) => s.totalPoints >= 3000,
    progress: (s) => [Math.min(s.totalPoints, 3000), 3000]
  },
  {
    id: 'pts_4000',
    title: '4,000-Point Virtuoso',
    icon: '💎',
    color: '#48CAE4',
    description: 'Score 4,000 cumulative trivia points across your sessions.',
    check: (s) => s.totalPoints >= 4000,
    progress: (s) => [Math.min(s.totalPoints, 4000), 4000]
  },
  {
    id: 'pts_5000',
    title: '5,000-Point Hall of Famer',
    icon: '🏛️',
    color: '#FF7A00',
    description: 'Score 5,000 cumulative trivia points across your sessions.',
    check: (s) => s.totalPoints >= 5000,
    progress: (s) => [Math.min(s.totalPoints, 5000), 5000]
  },
  {
    id: 'archive_10',
    title: 'Vault Diver',
    icon: '🧭',
    color: '#2EC4B6',
    description: 'Explore 10 random archive questions in More to Explore.',
    check: (s) => s.seenArchiveGuids.length >= 10,
    progress: (s) => [Math.min(s.seenArchiveGuids.length, 10), 10]
  },
  {
    id: 'polymath_5',
    title: 'Renaissance Listener',
    icon: '🌈',
    color: '#FF4D8D',
    description: 'Answer a question accurately in at least 5 different categories.',
    check: (s) => Object.values(s.categoryCorrectCounts || {}).filter((n) => n > 0).length >= 5,
    progress: (s) => [
      Math.min(Object.values(s.categoryCorrectCounts || {}).filter((n) => n > 0).length, 5),
      5
    ]
  },
  {
    id: 'curious_ears',
    title: 'Curious Ears',
    icon: '🎧',
    color: '#FF9F1C',
    description: 'Play an episode inside the trivia audio player to learn more.',
    check: (s) => s.episodesPlayedCount >= 1,
    progress: (s) => [Math.min(s.episodesPlayedCount, 1), 1]
  },
  {
    id: 'apple_vip',
    title: 'Podcast Booster',
    icon: '💜',
    color: '#9B5DE5',
    description: 'Open or follow Fun Facts Daily on Apple Podcasts.',
    check: (s) => Boolean(s.applePodcastVisited),
    progress: (s) => [s.applePodcastVisited ? 1 : 0, 1]
  },
  {
    id: 'party_starter',
    title: 'Party Starter',
    icon: '🤝',
    color: '#FF5C5C',
    description: 'Create or join a Play with Friends trivia game.',
    check: (s) => Boolean(s.groupGamePlayed),
    progress: (s) => [s.groupGamePlayed ? 1 : 0, 1]
  },
  {
    id: 'completionist_club',
    title: 'Completionist Club',
    icon: '🎓',
    color: '#FFD23F',
    description: 'Answer every available episode trivia question in the catalog!',
    check: (_s, meta) => {
      const total = meta?.totalAvailable || 0;
      const done = meta?.answeredCount || 0;
      return total > 0 && done >= total;
    },
    progress: (_s, meta) => {
      const total = Math.max(1, meta?.totalAvailable || 404);
      const done = Math.min(total, meta?.answeredCount || 0);
      return [done, total];
    }
  }
];

export const AVATARS = [
  { id: 'fox', emoji: '🦊', name: 'Clever Fox', bg: '#FF9F1C' },
  { id: 'owl', emoji: '🦉', name: 'Wise Owl', bg: '#FFD23F' },
  { id: 'octopus', emoji: '🐙', name: 'Curious Octo', bg: '#FF4D8D' },
  { id: 'dino', emoji: '🦖', name: 'Dino Detective', bg: '#00BFA6' },
  { id: 'rocket', emoji: '🚀', name: 'Star Explorer', bg: '#4CC9F0' },
  { id: 'palette', emoji: '🎨', name: 'Pop Artist', bg: '#C77DFF' },
  { id: 'taco', emoji: '🌮', name: 'Taco Champ', bg: '#FF7A00' },
  { id: 'bee', emoji: '🐝', name: 'Busy Bee', bg: '#FFE66D' },
  { id: 'flamingo', emoji: '🦩', name: 'Pink Flamingo', bg: '#FF6B8B' },
  { id: 'globe', emoji: '🌎', name: 'Globetrotter', bg: '#2EC4B6' },
  { id: 'bolt', emoji: '⚡', name: 'Brainiac Bolt', bg: '#FFB703' },
  { id: 'penguin', emoji: '🐧', name: 'Cool Penguin', bg: '#72EFDD' }
];

// Family-friendly check for SFW classroom/family Play with Friends games
const BLOCKED_PATTERNS = [
  /f+u+c+k/i,
  /s+h+i+t/i,
  /b+i+t+c+h/i,
  /a+s+s+h+o+l/i,
  /d+a+m+n/i,
  /c+u+n+t/i,
  /d+i+c+k/i,
  /p+o+r+n/i,
  /n+a+z+i/i,
  /s+l+u+t/i,
  /b+a+s+t+a+r+d/i
];

export function isFamilyFriendlyText(input) {
  const clean = String(input || '').trim();
  if (!clean) return false;
  return !BLOCKED_PATTERNS.some((re) => re.test(clean));
}
