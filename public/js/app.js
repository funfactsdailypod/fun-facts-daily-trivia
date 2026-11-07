import { AVATARS, BADGES, CATEGORIES, SHOW_CONFIG } from './config.js';
import { MemphisPodcastPlayer, formatPubDate, formatTime } from './audio-player.js';
import {
  addEpisodeToPlaylist,
  createPlaylist,
  decodePlaylistShareParam,
  deletePlaylist,
  encodePlaylistShareParam,
  evaluateNewBadges,
  exportSyncCode,
  getWeekendKey,
  importSyncCode,
  isWeekendDay,
  loadHostOverrides,
  loadPlayerState,
  markApplePodcastVisited,
  markEpisodePlayed,
  markGroupGamePlayed,
  moveEpisodeInPlaylist,
  recordArchiveSubmission,
  recordDailyDoubleSubmission,
  recordWeekendVaultSubmission,
  removeEpisodeFromPlaylist,
  saveHostOverride,
  savePlayerState,
  toggleFavoriteEpisode
} from './storage.js';
import {
  GroupGameService,
  formatTimeRemaining,
  isRoomActive,
  normalizeCode
} from './multiplayer.js';
import { renderQrSvg } from './qr.js';
import {
  buildShareCaption,
  canvasToPngBlob,
  renderScoreCardCanvas
} from './share-card.js';

const PLAYLIST_ICONS = ['🎧', '🚗', '🚀', '🐾', '🔬', '🏛️', '🎨', '🌙'];

// ============================================================================
// APP STATE
// ============================================================================
const state = {
  episodes: [],
  episodesByGuid: new Map(),
  player: loadPlayerState(),
  mode: 'solo', // 'solo' | 'episodes' | 'playlists' | 'group'

  // Daily Double / Weekend Vault UI state
  dailyTab: 'main', // 'main' | 'weekend'
  dailySelectedIdx: null,

  // More to Explore UI state
  archiveCategory: 'ALL',
  currentArchiveEp: null,
  archiveSelectedIdx: null,
  archiveSubmitted: false,

  // Episodes Discovery Hub state
  epSearchQuery: '',
  epCategory: 'ALL',
  epStatusFilter: 'all', // 'all' | 'favorites' | 'unheard' | 'listened'
  epSort: 'newest', // 'newest' | 'oldest' | 'shortest'
  epVisibleLimit: 18,

  // Playlists state
  selectedPlaylistId: 'FAVORITES', // 'FAVORITES' or custom playlist.id
  newPlaylistIcon: '🎧',
  activeQueueGuids: [],
  activeQueueIndex: -1,
  pickerTargetGuid: null,

  // Social Score Card state
  scoreCardContext: { episode: null, attempt: null },

  // PWA Install Prompt
  deferredInstallPrompt: null,

  // Group Game UI state
  groupService: new GroupGameService(),
  clientId: getOrCreateClientId(),
  selectedAvatarId: 'fox',
  hostTopics: new Set(['ALL']),
  hostQuestionCount: 10,
  hostPacing: 'live',
  hostDuration: '1h',
  activeRoom: null,
  activeRole: null,
  lastRenderedHostKey: '',
  lastRenderedPlayerKey: '',

  // Studio state
  editingGuid: null
};

let heroPlayer = null;
let archivePlayer = null;
let libraryPlayer = null;
let playlistPlayer = null;
let codeCheckTimeout = null;

function getOrCreateClientId() {
  const key = 'ffd_trivia_client_id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `cid_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCategoryMeta(catId) {
  return CATEGORIES.find((c) => c.id === catId) || CATEGORIES[0];
}

// ============================================================================
// CONFETTI & TOAST CELEBRATIONS
// ============================================================================
function showToast(message, icon = '✨') {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = 'memphis-toast';
  el.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    el.style.transition = 'all 0.25s ease';
    setTimeout(() => el.remove(), 260);
  }, 3800);
}

function fireConfetti(count = 55) {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#FFD23F', '#FF7A00', '#00BFA6', '#FF4D6D', '#4CC9F0', '#9B5DE5'];
  const pieces = Array.from({ length: count }, () => ({
    x: window.innerWidth * (0.25 + Math.random() * 0.5),
    y: window.innerHeight * 0.32,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 5,
    size: 7 + Math.random() * 7,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.25
  }));

  let frame = 0;
  function step() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.42;
      p.rot += p.vrot;
      if (p.y < canvas.height + 30) alive = true;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#181824';
      ctx.lineWidth = 1.5;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.strokeRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
    }
    if (alive && frame < 140) {
      requestAnimationFrame(step);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(step);
}

function celebrateBadges(newlyUnlocked) {
  if (!newlyUnlocked || !newlyUnlocked.length) return;
  for (const b of newlyUnlocked) {
    showToast(`Badge Unlocked: ${b.title}!`, b.icon);
  }
  fireConfetti(70);
  renderHeaderStats();
  renderBadgesBoard();
}

// ============================================================================
// INITIALIZATION & PWA REGISTRATION
// ============================================================================
async function initApp() {
  state.selectedAvatarId = state.player.preferredAvatarId || 'fox';

  // Detect if embedded inside a Google Sites iframe so mobile Safari users can pop out full-screen
  try {
    if (window.self !== window.top) {
      document.getElementById('embed-popout-bar').hidden = false;
      document.getElementById('embed-popout-link').href = window.location.href;
    }
  } catch {
    document.getElementById('embed-popout-bar').hidden = false;
  }

  registerPwaSupport();

  await Promise.all([loadCatalog(), state.groupService.init()]);

  initAudioPlayers();
  bindGlobalEvents();
  bindSoloEvents();
  bindEpisodesHubEvents();
  bindPlaylistsEvents();
  bindGroupEvents();
  bindModalEvents();

  evaluateNewBadges(state.player);
  renderHeaderStats();
  renderDailySection();
  renderCategoryFilterBar();
  pickNextArchiveQuestion();
  renderBadgesBoard();
  renderEpisodesCategoryBar();
  renderEpisodesCatalog();
  renderNewPlaylistIconPicker();
  renderPlaylistsView();
  renderAvatarPicker();
  renderHostTopicSelector();

  handleUrlDeepLinks();
}

function registerPwaSupport() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    state.deferredInstallPrompt = ev;
    document.getElementById('native-pwa-install-wrap').hidden = false;
  });
}

function handleUrlDeepLinks() {
  const params = new URLSearchParams(window.location.search);

  // 1) Group Game QR link (?group=CODE)
  const joinCode = params.get('group');
  if (joinCode) {
    switchMode('group');
    document.getElementById('join-code-input').value = normalizeCode(joinCode);
    document.getElementById('join-name-input').focus();
    showToast(`Ready to join Room ${normalizeCode(joinCode)}! Pick your name & avatar.`, '🎉');
    return;
  }

  // 2) Shared Playlist link (?playlist=...)
  const sharedPl = params.get('playlist');
  if (sharedPl) {
    try {
      const decoded = decodePlaylistShareParam(sharedPl, state.episodes);
      if (decoded.guids.length > 0) {
        const created = createPlaylist(state.player, {
          name: decoded.name,
          icon: decoded.icon,
          color: decoded.color,
          initialGuids: decoded.guids
        });
        state.selectedPlaylistId = created.id;
        renderHeaderStats();
        renderPlaylistsView();
        switchMode('playlists');
        showToast(`Imported shared playlist "${created.name}" (${created.guids.length} episodes)!`, '🎧');
      }
    } catch {
      showToast('Could not read shared playlist link.', '⚠️');
    }
    return;
  }

  // 3) Direct tab shortcut (?tab=episodes | playlists | group | solo)
  const tab = params.get('tab');
  if (tab && ['solo', 'episodes', 'playlists', 'group'].includes(tab)) {
    switchMode(tab);
  }
}

async function loadCatalog() {
  const res = await fetch('./data/questions.json', { cache: 'no-cache' });
  const rawList = await res.json();
  const overrides = loadHostOverrides();

  state.episodes = rawList.map((ep) => {
    const patch = overrides[ep.guid];
    return patch ? { ...ep, ...patch } : ep;
  });
  state.episodesByGuid.clear();
  for (const ep of state.episodes) {
    state.episodesByGuid.set(ep.guid, ep);
  }
}

function initAudioPlayers() {
  const sharedHooks = {
    onPlayEpisode: (ep) => {
      const unlocked = markEpisodePlayed(state.player, ep?.guid);
      celebrateBadges(unlocked);
      if (state.mode === 'episodes') renderEpisodesCatalog();
    },
    onAppleClick: () => {
      const unlocked = markApplePodcastVisited(state.player);
      celebrateBadges(unlocked);
    },
    onToggleFavorite: (ep) => {
      const added = toggleFavoriteEpisode(state.player, ep.guid);
      showToast(added ? 'Saved to My Favorites ❤️' : 'Removed from Favorites', added ? '❤️' : '🤍');
      renderHeaderStats();
      if (state.mode === 'episodes') renderEpisodesCatalog();
      if (state.mode === 'playlists') renderPlaylistsView();
    },
    isFavoriteCheck: (guid) => state.player.favoriteGuids.includes(guid)
  };

  heroPlayer = new MemphisPodcastPlayer(document.getElementById('hero-player-mount'), {
    ...sharedHooks,
    compact: false,
    preload: 'metadata'
  });

  archivePlayer = new MemphisPodcastPlayer(document.getElementById('archive-player-mount'), {
    ...sharedHooks,
    compact: true,
    preload: 'none'
  });

  libraryPlayer = new MemphisPodcastPlayer(document.getElementById('library-player-mount'), {
    ...sharedHooks,
    compact: true,
    preload: 'none'
  });

  playlistPlayer = new MemphisPodcastPlayer(document.getElementById('playlist-player-mount'), {
    ...sharedHooks,
    compact: true,
    preload: 'none',
    onTrackEnded: () => advancePlaylistQueue()
  });

  if (state.episodes.length > 0) {
    heroPlayer.loadEpisode(state.episodes[0], { cueSeconds: 0, autoPlay: false });
    libraryPlayer.loadEpisode(state.episodes[0], { cueSeconds: 0, autoPlay: false });
  }

  document.getElementById('top-follow-apple-link').addEventListener('click', sharedHooks.onAppleClick);
}

// ============================================================================
// HEADER & 4-TAB NAVIGATION
// ============================================================================
function renderHeaderStats(bumpScore = false) {
  document.getElementById('header-streak-val').textContent = String(state.player.currentStreak);
  document.getElementById('header-score-val').textContent = state.player.totalPoints.toLocaleString();
  const unlockedCount = Object.keys(state.player.unlockedBadges || {}).length;
  document.getElementById('header-badges-val').textContent = `${unlockedCount}/${BADGES.length}`;

  const totalSavedItems = state.player.favoriteGuids.length + state.player.playlists.length;
  const navPlCount = document.getElementById('nav-playlist-count');
  navPlCount.textContent = String(state.player.playlists.length || state.player.favoriteGuids.length);
  navPlCount.hidden = totalSavedItems === 0;

  if (bumpScore) {
    const pill = document.getElementById('score-pill');
    pill.classList.remove('stat-bump');
    void pill.offsetWidth;
    pill.classList.add('stat-bump');
  }
}

function switchMode(targetMode) {
  const valid = ['solo', 'episodes', 'playlists', 'group'];
  state.mode = valid.includes(targetMode) ? targetMode : 'solo';
  document.body.dataset.mode = state.mode === 'group' ? 'group' : 'solo';

  for (const m of valid) {
    document.getElementById(`btn-mode-${m}`)?.classList.toggle('is-active', state.mode === m);
    document.getElementById(`${m}-view`).hidden = state.mode !== m;
  }

  if (state.mode === 'episodes') {
    renderEpisodesCatalog();
  } else if (state.mode === 'playlists') {
    renderPlaylistsView();
  }
}

function bindGlobalEvents() {
  document.querySelectorAll('[data-switch-mode]').forEach((btn) => {
    btn.addEventListener('click', () => switchMode(btn.dataset.switchMode));
  });

  document.getElementById('brand-home-link').addEventListener('click', (ev) => {
    ev.preventDefault();
    switchMode('solo');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('badges-pill').addEventListener('click', () => {
    switchMode('solo');
    document.getElementById('badges-section').scrollIntoView({ behavior: 'smooth' });
  });
}

// ============================================================================
// DAILY DOUBLE & WEEKEND VAULT BONUS
// ============================================================================
function getWeekendVaultCandidate() {
  const wkKey = getWeekendKey();
  const withBonus = state.episodes.filter((ep) => ep.vaultBonus && ep.vaultBonus.question);
  if (!withBonus.length) return null;
  let hash = 0;
  for (let i = 0; i < wkKey.length; i++) {
    hash = (hash * 31 + wkKey.charCodeAt(i)) >>> 0;
  }
  const ep = withBonus[hash % withBonus.length];
  return { episode: ep, bonus: ep.vaultBonus };
}

function isWeekendBonusAvailable() {
  const latest = state.episodes[0];
  if (!latest) return false;
  const candidate = getWeekendVaultCandidate();
  if (!candidate) return false;
  return isWeekendDay() || Boolean(state.player.dailyAttempts[latest.guid]);
}

function renderDailySection() {
  const latest = state.episodes[0];
  if (!latest) return;

  const bonusAvail = isWeekendBonusAvailable();
  const tabMain = document.getElementById('tab-daily-main');
  const tabWeekend = document.getElementById('tab-weekend-vault');
  tabWeekend.hidden = !bonusAvail;
  if (!bonusAvail && state.dailyTab === 'weekend') {
    state.dailyTab = 'main';
  }
  tabMain.classList.toggle('is-active', state.dailyTab === 'main');
  tabWeekend.classList.toggle('is-active', state.dailyTab === 'weekend');

  const streakMsgEl = document.getElementById('daily-streak-msg');
  const weekendNow = isWeekendDay();
  const mainAttempt = state.player.dailyAttempts[latest.guid];

  if (weekendNow && mainAttempt?.correct) {
    streakMsgEl.textContent = `🔥 ${state.player.currentStreak}-Day Streak Safe! Weekday streaks bridge Friday → Monday automatically.`;
  } else if (weekendNow && !mainAttempt) {
    streakMsgEl.textContent = `☀️ Weekend Catch-Up! Answer Friday’s latest episode below to lock in your streak for Monday.`;
  } else if (mainAttempt?.correct) {
    streakMsgEl.textContent = `🔥 ${state.player.currentStreak}-Day Streak Active! Come back next weekday episode to keep it rolling.`;
  } else if (state.player.currentStreak > 0) {
    streakMsgEl.textContent = `🔥 ${state.player.currentStreak}-Day Streak on the line! Answer today’s Daily Double (+20 pts).`;
  } else {
    streakMsgEl.textContent = `⚡ Published Mon–Fri! Start a new Daily Double streak today (+20 pts).`;
  }

  if (state.dailyTab === 'weekend') {
    renderWeekendBonusView();
    return;
  }

  const catMeta = getCategoryMeta(latest.category);
  const catTag = document.getElementById('daily-category-tag');
  catTag.textContent = `${catMeta.icon} ${latest.category}`;
  catTag.style.backgroundColor = catMeta.color;

  document.getElementById('daily-ep-title').textContent = latest.title;
  document.getElementById('daily-ep-date').textContent = `• ${formatPubDate(latest.pubDate)}`;
  document.getElementById('daily-question-text').textContent = latest.question;

  state.dailySelectedIdx = null;
  const submitBtn = document.getElementById('btn-daily-submit');
  submitBtn.textContent = 'Lock In Daily Double (+20 PTS)';
  submitBtn.disabled = true;

  renderChoiceButtons({
    container: document.getElementById('daily-options-list'),
    options: latest.options,
    attempt: mainAttempt,
    correctIndex: latest.correctIndex,
    onSelect: (idx) => {
      state.dailySelectedIdx = idx;
      submitBtn.disabled = false;
    }
  });

  document.getElementById('daily-submit-row').hidden = Boolean(mainAttempt);
  document.getElementById('daily-hint-row').hidden = Boolean(mainAttempt);

  const revealBox = document.getElementById('daily-reveal-box');
  if (mainAttempt) {
    revealBox.hidden = false;
    const banner = document.getElementById('daily-reveal-banner');
    banner.className = `reveal-banner ${mainAttempt.correct ? 'reveal-banner--correct' : 'reveal-banner--wrong'}`;
    banner.textContent = mainAttempt.correct
      ? `🎉 Daily Double Nailed! +${SHOW_CONFIG.points.dailyDouble} Points`
      : '💡 Good Try! Here’s the Fun Fact:';
    document.getElementById('daily-correct-line').textContent =
      `Correct Answer: ${latest.options[latest.correctIndex]}`;
    document.getElementById('daily-explanation-text').textContent = latest.explanation;

    const wkAttempt = state.player.weekendVaultAttempts[getWeekendKey()];
    document.getElementById('btn-try-weekend-bonus').hidden = !(isWeekendBonusAvailable() && !wkAttempt);
    document.getElementById('btn-share-daily').hidden = false;
  } else {
    revealBox.hidden = true;
  }
}

function renderWeekendBonusView() {
  const candidate = getWeekendVaultCandidate();
  if (!candidate) return;
  const { episode, bonus } = candidate;
  const wkKey = getWeekendKey();
  const attempt = state.player.weekendVaultAttempts[wkKey];

  const catMeta = getCategoryMeta(episode.category);
  const catTag = document.getElementById('daily-category-tag');
  catTag.textContent = `${catMeta.icon} ${episode.category}`;
  catTag.style.backgroundColor = catMeta.color;

  document.getElementById('daily-ep-title').textContent = `${episode.title} (Vault Bonus)`;
  document.getElementById('daily-ep-date').textContent = `• ${formatPubDate(episode.pubDate)}`;
  document.getElementById('daily-question-text').textContent = bonus.question;

  state.dailySelectedIdx = null;
  const submitBtn = document.getElementById('btn-daily-submit');
  submitBtn.textContent = 'Lock In Weekend Bonus (+15 PTS)';
  submitBtn.disabled = true;

  renderChoiceButtons({
    container: document.getElementById('daily-options-list'),
    options: bonus.options,
    attempt,
    correctIndex: bonus.correctIndex,
    onSelect: (idx) => {
      state.dailySelectedIdx = idx;
      submitBtn.disabled = false;
    }
  });

  document.getElementById('daily-submit-row').hidden = Boolean(attempt);
  document.getElementById('daily-hint-row').hidden = Boolean(attempt);

  const revealBox = document.getElementById('daily-reveal-box');
  if (attempt) {
    revealBox.hidden = false;
    const banner = document.getElementById('daily-reveal-banner');
    banner.className = `reveal-banner ${attempt.correct ? 'reveal-banner--correct' : 'reveal-banner--wrong'}`;
    banner.textContent = attempt.correct
      ? `🎁 Weekend Bonus Correct! +${SHOW_CONFIG.points.weekendVault} Points`
      : '💡 Great Guess! Here’s the Story:';
    document.getElementById('daily-correct-line').textContent =
      `Correct Answer: ${bonus.options[bonus.correctIndex]}`;
    document.getElementById('daily-explanation-text').textContent = bonus.explanation;
    document.getElementById('btn-try-weekend-bonus').hidden = true;
    document.getElementById('btn-share-daily').hidden = true;
  } else {
    revealBox.hidden = true;
  }
}

function renderChoiceButtons({ container, options, attempt, correctIndex, onSelect }) {
  const letters = ['A', 'B', 'C', 'D'];
  container.innerHTML = '';

  options.forEach((optText, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-choice-btn';

    if (attempt) {
      btn.disabled = true;
      if (idx === correctIndex) {
        btn.classList.add('is-correct');
      } else if (idx === attempt.selectedIndex && !attempt.correct) {
        btn.classList.add('is-wrong');
      }
    }

    btn.innerHTML = `
      <span class="option-letter">${letters[idx] || idx + 1}</span>
      <span>${escapeHtml(optText)}</span>
    `;

    if (!attempt) {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.option-choice-btn').forEach((b) => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        onSelect(idx);
      });
    }

    container.appendChild(btn);
  });
}

// ============================================================================
// MORE TO EXPLORE — RANDOMIZED ARCHIVE ENGINE
// ============================================================================
function getUnseenArchivePool(categoryId = state.archiveCategory) {
  const seenSet = new Set(state.player.seenArchiveGuids);
  const dailyGuid = state.episodes[0]?.guid;

  return state.episodes.filter((ep) => {
    if (ep.guid === dailyGuid) return false;
    if (seenSet.has(ep.guid)) return false;
    if (categoryId !== 'ALL' && ep.category !== categoryId) return false;
    return true;
  });
}

function renderCategoryFilterBar() {
  const bar = document.getElementById('archive-category-bar');
  bar.innerHTML = '';

  const totalArchiveCount = Math.max(0, state.episodes.length - 1);
  const seenCount = state.player.seenArchiveGuids.length;
  document.getElementById('explore-progress-count').textContent = `${seenCount} / ${totalArchiveCount}`;

  for (const cat of CATEGORIES) {
    const unseenCount = getUnseenArchivePool(cat.id).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cat-filter-btn ${state.archiveCategory === cat.id ? 'is-active' : ''}`;
    btn.innerHTML = `
      <span>${cat.icon}</span>
      <span>${escapeHtml(cat.label)}</span>
      <span class="cat-count-chip">${unseenCount}</span>
    `;
    btn.addEventListener('click', () => {
      state.archiveCategory = cat.id;
      renderCategoryFilterBar();
      pickNextArchiveQuestion();
    });
    bar.appendChild(btn);
  }
}

function pickNextArchiveQuestion(specificEpisode = null) {
  const stageEl = document.getElementById('archive-stage');
  const completeEl = document.getElementById('archive-complete-box');

  if (specificEpisode) {
    stageEl.hidden = false;
    completeEl.hidden = true;
    state.currentArchiveEp = specificEpisode;
    state.archiveSelectedIdx = null;
    state.archiveSubmitted = false;
    renderArchiveQuestionCard();
    return;
  }

  const pool = getUnseenArchivePool(state.archiveCategory);
  if (pool.length === 0) {
    stageEl.hidden = true;
    completeEl.hidden = false;
    const allRemaining = getUnseenArchivePool('ALL').length;
    if (allRemaining === 0) {
      document.getElementById('archive-complete-title').textContent =
        'Incredible! You answered every single archive episode!';
      document.getElementById('archive-complete-desc').textContent =
        'New episodes drop Monday through Friday—check back tomorrow for a brand-new question!';
      document.getElementById('btn-reset-filter-all').hidden = true;
    } else {
      document.getElementById('archive-complete-title').textContent =
        `You conquered every ${state.archiveCategory} question in the archive!`;
      document.getElementById('archive-complete-desc').textContent =
        `There are still ${allRemaining} unseen episodes waiting in other topics.`;
      document.getElementById('btn-reset-filter-all').hidden = false;
    }
    return;
  }

  stageEl.hidden = false;
  completeEl.hidden = true;

  let candidates = pool;
  if (pool.length > 1 && state.currentArchiveEp) {
    candidates = pool.filter((e) => e.guid !== state.currentArchiveEp.guid);
  }
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];

  state.currentArchiveEp = chosen;
  state.archiveSelectedIdx = null;
  state.archiveSubmitted = false;

  renderArchiveQuestionCard();
}

function renderArchiveQuestionCard() {
  const ep = state.currentArchiveEp;
  if (!ep) return;

  const catMeta = getCategoryMeta(ep.category);
  const catTag = document.getElementById('archive-category-tag');
  catTag.textContent = `${catMeta.icon} ${ep.category}`;
  catTag.style.backgroundColor = catMeta.color;

  document.getElementById('archive-ep-origin').textContent =
    `${ep.title} • ${formatPubDate(ep.pubDate)}`;
  document.getElementById('archive-question-text').textContent = ep.question;

  const submitBtn = document.getElementById('btn-archive-submit');
  submitBtn.disabled = true;

  renderChoiceButtons({
    container: document.getElementById('archive-options-list'),
    options: ep.options,
    attempt: null,
    correctIndex: ep.correctIndex,
    onSelect: (idx) => {
      state.archiveSelectedIdx = idx;
      submitBtn.disabled = false;
    }
  });

  document.getElementById('archive-submit-row').hidden = false;
  document.getElementById('btn-archive-shuffle').hidden = false;
  document.getElementById('archive-reveal-box').hidden = true;
}

function bindSoloEvents() {
  document.getElementById('tab-daily-main').addEventListener('click', () => {
    state.dailyTab = 'main';
    renderDailySection();
  });
  document.getElementById('tab-weekend-vault').addEventListener('click', () => {
    state.dailyTab = 'weekend';
    renderDailySection();
  });
  document.getElementById('btn-try-weekend-bonus').addEventListener('click', () => {
    state.dailyTab = 'weekend';
    renderDailySection();
  });

  document.getElementById('btn-daily-cue-hint').addEventListener('click', () => {
    const latest = state.episodes[0];
    if (!latest) return;
    if (state.dailyTab === 'weekend') {
      const cand = getWeekendVaultCandidate();
      if (cand) {
        heroPlayer.loadEpisode(cand.episode, {
          cueSeconds: Math.max(0, (cand.bonus.cueSeconds || 180) - 15),
          autoPlay: true
        });
      }
    } else {
      heroPlayer.loadEpisode(latest, {
        cueSeconds: Math.max(0, (latest.cueSeconds || 180) - 15),
        autoPlay: true
      });
    }
    showToast('Cued episode player to the hint section!', '🎧');
  });

  document.getElementById('btn-play-daily-answer').addEventListener('click', () => {
    const latest = state.episodes[0];
    if (!latest) return;
    if (state.dailyTab === 'weekend') {
      const cand = getWeekendVaultCandidate();
      if (cand) {
        heroPlayer.loadEpisode(cand.episode, { cueSeconds: cand.bonus.cueSeconds || 180, autoPlay: true });
      }
    } else {
      heroPlayer.loadEpisode(latest, { cueSeconds: latest.cueSeconds || 180, autoPlay: true });
    }
  });

  document.getElementById('btn-add-daily-playlist').addEventListener('click', () => {
    const latest = state.episodes[0];
    if (latest) openPlaylistPickerModal(latest.guid);
  });

  document.getElementById('btn-add-archive-playlist').addEventListener('click', () => {
    if (state.currentArchiveEp) openPlaylistPickerModal(state.currentArchiveEp.guid);
  });

  document.getElementById('daily-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (state.dailySelectedIdx === null) return;

    if (state.dailyTab === 'weekend') {
      const cand = getWeekendVaultCandidate();
      if (!cand) return;
      const res = recordWeekendVaultSubmission(
        state.player,
        cand.episode,
        cand.bonus,
        state.dailySelectedIdx
      );
      if (res.correct) {
        fireConfetti(45);
        showToast(`+${res.pointsEarned} Weekend Bonus Points!`, '🎁');
      }
      renderHeaderStats(res.correct);
      renderDailySection();
      renderBadgesBoard();
      celebrateBadges(res.newlyUnlocked);
      return;
    }

    const latest = state.episodes[0];
    if (!latest) return;
    const res = recordDailyDoubleSubmission(state.player, latest, state.dailySelectedIdx);
    if (res.correct) {
      fireConfetti(65);
      showToast(`Daily Double! +${res.pointsEarned} pts • 🔥 ${state.player.currentStreak}-Day Streak!`, '☀️');
    }
    renderHeaderStats(res.correct);
    renderDailySection();
    renderBadgesBoard();
    celebrateBadges(res.newlyUnlocked);
  });

  // Visual Social Media Score Card Triggers
  document.getElementById('btn-share-daily').addEventListener('click', () => {
    const latest = state.episodes[0];
    const attempt = state.player.dailyAttempts[latest?.guid];
    openScoreCardModal({ episode: latest, attempt });
  });

  document.getElementById('btn-share-overall-card').addEventListener('click', () => {
    openScoreCardModal({ episode: null, attempt: null });
  });

  // More to Explore events
  document.getElementById('btn-archive-shuffle').addEventListener('click', () => {
    pickNextArchiveQuestion();
  });

  document.getElementById('btn-reset-filter-all').addEventListener('click', () => {
    state.archiveCategory = 'ALL';
    renderCategoryFilterBar();
    pickNextArchiveQuestion();
  });

  document.getElementById('archive-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const ep = state.currentArchiveEp;
    if (!ep || state.archiveSelectedIdx === null || state.archiveSubmitted) return;

    state.archiveSubmitted = true;
    const res = recordArchiveSubmission(state.player, ep, state.archiveSelectedIdx);

    renderChoiceButtons({
      container: document.getElementById('archive-options-list'),
      options: ep.options,
      attempt: { selectedIndex: state.archiveSelectedIdx, correct: res.correct },
      correctIndex: ep.correctIndex,
      onSelect: () => {}
    });

    document.getElementById('archive-submit-row').hidden = true;
    document.getElementById('btn-archive-shuffle').hidden = true;

    const revealBox = document.getElementById('archive-reveal-box');
    revealBox.hidden = false;

    const banner = document.getElementById('archive-reveal-banner');
    banner.className = `reveal-banner ${res.correct ? 'reveal-banner--correct' : 'reveal-banner--wrong'}`;
    banner.textContent = res.correct
      ? `✨ Spot On! +${SHOW_CONFIG.points.archiveQuestion} Points`
      : '💡 Fascinating Fact! Here’s Why:';

    document.getElementById('archive-correct-line').textContent =
      `Correct Answer: ${ep.options[ep.correctIndex]}`;
    document.getElementById('archive-explanation-text').textContent = ep.explanation;

    const cueSec = Number(ep.cueSeconds) || 180;
    document.getElementById('archive-cue-note').textContent =
      `Cued to ${formatTime(cueSec)} in "${ep.title}" right where the answer is explained — hit Play below to listen and learn more!`;

    archivePlayer.loadEpisode(ep, { cueSeconds: cueSec, autoPlay: false });

    if (res.correct) {
      fireConfetti(32);
    }
    renderHeaderStats(res.correct);
    renderCategoryFilterBar();
    renderBadgesBoard();
    celebrateBadges(res.newlyUnlocked);
  });

  document.getElementById('btn-next-archive').addEventListener('click', () => {
    archivePlayer.audio.pause();
    pickNextArchiveQuestion();
    document.getElementById('explore-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

// ============================================================================
// TAB 2: EPISODES SEARCH & DISCOVERY HUB
// ============================================================================
function getFilteredEpisodes() {
  const q = state.epSearchQuery.toLowerCase().trim();
  const favSet = new Set(state.player.favoriteGuids);
  const listenedSet = new Set(state.player.listenedGuids);

  const filtered = state.episodes.filter((ep) => {
    if (state.epCategory !== 'ALL' && ep.category !== state.epCategory) return false;
    if (state.epStatusFilter === 'favorites' && !favSet.has(ep.guid)) return false;
    if (state.epStatusFilter === 'unheard' && listenedSet.has(ep.guid)) return false;
    if (state.epStatusFilter === 'listened' && !listenedSet.has(ep.guid)) return false;
    if (q) {
      const hay = `${ep.title} ${ep.category} ${ep.question} ${ep.explanation}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (state.epSort === 'oldest') {
    filtered.reverse();
  } else if (state.epSort === 'shortest') {
    filtered.sort((a, b) => (a.durationSec || 9999) - (b.durationSec || 9999));
  }
  return filtered;
}

function renderEpisodesCategoryBar() {
  const bar = document.getElementById('episodes-category-bar');
  bar.innerHTML = '';

  for (const cat of CATEGORIES) {
    const count =
      cat.id === 'ALL'
        ? state.episodes.length
        : state.episodes.filter((e) => e.category === cat.id).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cat-filter-btn ${state.epCategory === cat.id ? 'is-active' : ''}`;
    btn.innerHTML = `
      <span>${cat.icon}</span>
      <span>${escapeHtml(cat.id === 'ALL' ? 'All Topics' : cat.label)}</span>
      <span class="cat-count-chip">${count}</span>
    `;
    btn.addEventListener('click', () => {
      state.epCategory = cat.id;
      state.epVisibleLimit = 18;
      renderEpisodesCategoryBar();
      renderEpisodesCatalog();
    });
    bar.appendChild(btn);
  }
}

function renderEpisodesCatalog() {
  const matches = getFilteredEpisodes();
  document.getElementById('episodes-match-count').textContent = String(matches.length);

  const grid = document.getElementById('episodes-catalog-grid');
  grid.innerHTML = '';

  if (matches.length === 0) {
    grid.innerHTML = `
      <div class="archive-complete-box" style="grid-column:1/-1">
        <div class="complete-emoji">🔍</div>
        <h3>No matching episodes found</h3>
        <p>Try clearing your search or switching topic filters!</p>
      </div>
    `;
    document.getElementById('episodes-load-more-wrap').hidden = true;
    return;
  }

  const favSet = new Set(state.player.favoriteGuids);
  const listenedSet = new Set(state.player.listenedGuids);
  const slice = matches.slice(0, state.epVisibleLimit);

  for (const ep of slice) {
    const isFav = favSet.has(ep.guid);
    const isListened = listenedSet.has(ep.guid);
    const catMeta = getCategoryMeta(ep.category);
    const mins = Math.max(1, Math.round((ep.durationSec || 900) / 60));

    const card = document.createElement('article');
    card.className = 'ep-catalog-card';
    card.innerHTML = `
      <div class="ep-card-top">
        <img class="ep-card-thumb" src="${escapeHtml(ep.artworkUrl)}" alt="" loading="lazy" />
        <div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="category-tag" style="padding:2px 8px;font-size:0.72rem;background:${catMeta.color}">
              ${catMeta.icon} ${escapeHtml(ep.category)}
            </span>
            ${isListened ? '<span class="ep-listened-pill">✓ Listened</span>' : ''}
          </div>
          <h3 class="ep-card-title">${escapeHtml(ep.title)}</h3>
          <div class="ep-card-sub">${formatPubDate(ep.pubDate)} • ${mins} min</div>
        </div>
      </div>
      <p class="ep-card-teaser">❓ Trivia: ${escapeHtml(ep.question)}</p>
      <div class="ep-card-actions">
        <button type="button" class="ep-mini-btn ep-mini-btn--play" data-ep-play="${escapeHtml(ep.guid)}">
          ▶ Listen
        </button>
        <button type="button" class="ep-mini-btn" data-ep-fav="${escapeHtml(ep.guid)}" title="Favorite">
          ${isFav ? '❤️ Saved' : '🤍 Favorite'}
        </button>
        <button type="button" class="ep-mini-btn" data-ep-addpl="${escapeHtml(ep.guid)}">
          ➕ Playlist
        </button>
        <button type="button" class="ep-mini-btn" data-ep-quiz="${escapeHtml(ep.guid)}">
          ❓ Quiz
        </button>
      </div>
    `;
    grid.appendChild(card);
  }

  grid.querySelectorAll('[data-ep-play]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ep = state.episodesByGuid.get(btn.dataset.epPlay);
      if (!ep) return;
      libraryPlayer.loadEpisode(ep, { cueSeconds: 0, autoPlay: true });
      document.querySelector('.library-player-banner').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  grid.querySelectorAll('[data-ep-fav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const added = toggleFavoriteEpisode(state.player, btn.dataset.epFav);
      showToast(added ? 'Added to My Favorites ❤️' : 'Removed from Favorites', added ? '❤️' : '🤍');
      heroPlayer.refreshFavoriteUi();
      renderHeaderStats();
      renderEpisodesCatalog();
    });
  });

  grid.querySelectorAll('[data-ep-addpl]').forEach((btn) => {
    btn.addEventListener('click', () => openPlaylistPickerModal(btn.dataset.epAddpl));
  });

  grid.querySelectorAll('[data-ep-quiz]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ep = state.episodesByGuid.get(btn.dataset.epQuiz);
      if (!ep) return;
      switchMode('solo');
      if (ep.guid === state.episodes[0]?.guid) {
        state.dailyTab = 'main';
        renderDailySection();
        document.getElementById('daily-double-card').scrollIntoView({ behavior: 'smooth' });
      } else {
        pickNextArchiveQuestion(ep);
        document.getElementById('explore-section').scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  document.getElementById('episodes-load-more-wrap').hidden = matches.length <= state.epVisibleLimit;
}

function bindEpisodesHubEvents() {
  document.getElementById('episodes-search-input').addEventListener('input', (ev) => {
    state.epSearchQuery = ev.target.value;
    state.epVisibleLimit = 18;
    renderEpisodesCatalog();
  });

  document.getElementById('episodes-sort-select').addEventListener('change', (ev) => {
    state.epSort = ev.target.value;
    state.epVisibleLimit = 18;
    renderEpisodesCatalog();
  });

  document.querySelectorAll('#episodes-status-bar [data-ep-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.epStatusFilter = btn.dataset.epStatus;
      state.epVisibleLimit = 18;
      document.querySelectorAll('#episodes-status-bar .seg-pill').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      renderEpisodesCatalog();
    });
  });

  document.getElementById('btn-episodes-load-more').addEventListener('click', () => {
    state.epVisibleLimit += 24;
    renderEpisodesCatalog();
  });

  document.getElementById('btn-surprise-episode').addEventListener('click', () => {
    if (!state.episodes.length) return;
    const rand = state.episodes[Math.floor(Math.random() * state.episodes.length)];
    libraryPlayer.loadEpisode(rand, { cueSeconds: 0, autoPlay: true });
    showToast(`Now playing surprise episode: ${rand.title}`, '🎲');
  });
}

// ============================================================================
// TAB 3: FAVORITES & CUSTOM PLAYLISTS
// ============================================================================
function renderNewPlaylistIconPicker() {
  const row = document.getElementById('new-playlist-icons');
  row.innerHTML = '';
  for (const icon of PLAYLIST_ICONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pl-icon-btn ${state.newPlaylistIcon === icon ? 'is-selected' : ''}`;
    btn.textContent = icon;
    btn.addEventListener('click', () => {
      state.newPlaylistIcon = icon;
      row.querySelectorAll('.pl-icon-btn').forEach((b) => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
    });
    row.appendChild(btn);
  }
}

function getActiveCollection() {
  if (state.selectedPlaylistId === 'FAVORITES') {
    return {
      id: 'FAVORITES',
      name: 'My Favorites',
      icon: '❤️',
      color: '#FF4D6D',
      guids: state.player.favoriteGuids,
      isBuiltIn: true
    };
  }
  const found = state.player.playlists.find((p) => p.id === state.selectedPlaylistId);
  if (found) return found;
  state.selectedPlaylistId = 'FAVORITES';
  return getActiveCollection();
}

function renderPlaylistsView() {
  const listEl = document.getElementById('playlist-selector-list');
  const active = getActiveCollection();

  const allCollections = [
    {
      id: 'FAVORITES',
      name: 'My Favorites',
      icon: '❤️',
      guids: state.player.favoriteGuids
    },
    ...state.player.playlists
  ];

  listEl.innerHTML = allCollections
    .map(
      (col) => `
      <button type="button" class="pl-select-btn ${col.id === active.id ? 'is-active' : ''}" data-select-pl="${escapeHtml(col.id)}">
        <span>${col.icon} ${escapeHtml(col.name)}</span>
        <span class="cat-count-chip">${col.guids.length}</span>
      </button>
    `
    )
    .join('');

  listEl.querySelectorAll('[data-select-pl]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedPlaylistId = btn.dataset.selectPl;
      renderPlaylistsView();
    });
  });

  // Render Right Stage
  const tracks = active.guids.map((g) => state.episodesByGuid.get(g)).filter(Boolean);
  const totalMins = Math.round(tracks.reduce((sum, ep) => sum + (ep.durationSec || 900), 0) / 60);

  const headerEl = document.getElementById('playlist-stage-header');
  headerEl.innerHTML = `
    <div>
      <div class="section-eyebrow">${active.isBuiltIn ? 'BUILT-IN COLLECTION' : 'CUSTOM PLAYLIST'}</div>
      <h2 class="section-title" style="margin-bottom:4px">${active.icon} ${escapeHtml(active.name)}</h2>
      <p class="section-subtitle">${tracks.length} episode${tracks.length === 1 ? '' : 's'} • ~${totalMins} min listening time</p>
    </div>
    <div class="reveal-actions" style="margin-top:0">
      <button type="button" class="primary-cta-btn" id="btn-play-all-playlist" ${tracks.length === 0 ? 'disabled' : ''}>
        ▶ Play All
      </button>
      <button type="button" class="secondary-cta-btn" id="btn-share-playlist-link" ${tracks.length === 0 ? 'disabled' : ''}>
        🔗 Share Playlist
      </button>
      ${
        active.isBuiltIn
          ? ''
          : `<button type="button" class="chip-link-btn chip-link-btn--danger" id="btn-delete-playlist">🗑 Delete</button>`
      }
    </div>
  `;

  document.getElementById('playlist-player-box').hidden = tracks.length === 0 && !playlistPlayer.episode;

  const tracksEl = document.getElementById('playlist-tracks-list');
  if (tracks.length === 0) {
    tracksEl.innerHTML = `
      <div class="archive-complete-box">
        <div class="complete-emoji">${active.icon}</div>
        <h3>This playlist doesn’t have any episodes yet!</h3>
        <p>Browse the <strong>🔎 Episodes</strong> tab, tap ❤️ on any player, or click a <strong>1-Click Starter Pack</strong> on the left to fill it up.</p>
        <div class="reveal-actions" style="justify-content:center">
          <button type="button" class="primary-cta-btn" id="btn-jump-browse-eps">
            🔎 Browse 404 Episodes →
          </button>
        </div>
      </div>
    `;
    document.getElementById('btn-jump-browse-eps')?.addEventListener('click', () => switchMode('episodes'));
  } else {
    if (!playlistPlayer.episode) {
      playlistPlayer.loadEpisode(tracks[0], {
        cueSeconds: 0,
        autoPlay: false,
        queueLabel: `${active.icon} ${active.name} (1/${tracks.length})`
      });
    }

    tracksEl.innerHTML = tracks
      .map((ep, idx) => {
        const mins = Math.max(1, Math.round((ep.durationSec || 900) / 60));
        const isCurrent = playlistPlayer.episode?.guid === ep.guid;
        return `
          <div class="pl-track-row ${isCurrent ? 'is-playing-track' : ''}">
            <div class="pl-track-left">
              <span class="pl-track-num">${idx + 1}.</span>
              <img class="pl-track-thumb" src="${escapeHtml(ep.artworkUrl)}" alt="" loading="lazy" />
              <div class="pl-track-info">
                <div class="pl-track-title">${escapeHtml(ep.title)}</div>
                <div class="pl-track-meta">${escapeHtml(ep.category)} • ${mins} min</div>
              </div>
            </div>
            <div class="pl-track-controls">
              <button type="button" class="ep-mini-btn ep-mini-btn--play" data-pl-play-idx="${idx}">▶ Play</button>
              ${
                !active.isBuiltIn && idx > 0
                  ? `<button type="button" class="ep-mini-btn" data-pl-up="${idx}" title="Move up">↑</button>`
                  : ''
              }
              ${
                !active.isBuiltIn && idx < tracks.length - 1
                  ? `<button type="button" class="ep-mini-btn" data-pl-down="${idx}" title="Move down">↓</button>`
                  : ''
              }
              <button type="button" class="ep-mini-btn" data-pl-remove="${escapeHtml(ep.guid)}" title="Remove">✕</button>
            </div>
          </div>
        `;
      })
      .join('');

    tracksEl.querySelectorAll('[data-pl-play-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        startPlaylistPlayback(active, Number(btn.dataset.plPlayIdx));
      });
    });

    tracksEl.querySelectorAll('[data-pl-up]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.plUp);
        moveEpisodeInPlaylist(state.player, active.id, i, i - 1);
        renderPlaylistsView();
      });
    });

    tracksEl.querySelectorAll('[data-pl-down]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.plDown);
        moveEpisodeInPlaylist(state.player, active.id, i, i + 1);
        renderPlaylistsView();
      });
    });

    tracksEl.querySelectorAll('[data-pl-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (active.isBuiltIn) {
          toggleFavoriteEpisode(state.player, btn.dataset.plRemove);
          heroPlayer.refreshFavoriteUi();
        } else {
          removeEpisodeFromPlaylist(state.player, active.id, btn.dataset.plRemove);
        }
        renderHeaderStats();
        renderPlaylistsView();
      });
    });
  }

  document.getElementById('btn-play-all-playlist')?.addEventListener('click', () => {
    startPlaylistPlayback(active, 0);
  });

  document.getElementById('btn-share-playlist-link')?.addEventListener('click', async () => {
    const encoded = encodePlaylistShareParam(active);
    const base = window.location.origin + window.location.pathname.replace(/\/index\.html$/, '');
    const shareUrl = `${base.replace(/\/$/, '')}/?playlist=${encoded}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Copied shareable playlist link! Send it to friends, family, or students.', '🔗');
    } catch {
      showToast(shareUrl, '🔗');
    }
  });

  document.getElementById('btn-delete-playlist')?.addEventListener('click', () => {
    deletePlaylist(state.player, active.id);
    state.selectedPlaylistId = 'FAVORITES';
    renderHeaderStats();
    renderPlaylistsView();
    showToast('Playlist deleted.', '🗑');
  });
}

function startPlaylistPlayback(collection, startIndex = 0) {
  const validGuids = collection.guids.filter((g) => state.episodesByGuid.has(g));
  if (!validGuids.length) return;
  state.activeQueueGuids = validGuids;
  state.activeQueueIndex = Math.max(0, Math.min(startIndex, validGuids.length - 1));

  const ep = state.episodesByGuid.get(validGuids[state.activeQueueIndex]);
  document.getElementById('playlist-player-box').hidden = false;
  playlistPlayer.loadEpisode(ep, {
    cueSeconds: 0,
    autoPlay: true,
    queueLabel: `${collection.icon} ${collection.name} (${state.activeQueueIndex + 1}/${validGuids.length})`
  });
  renderPlaylistsView();
}

function advancePlaylistQueue() {
  if (!state.activeQueueGuids.length) return;
  const nextIdx = state.activeQueueIndex + 1;
  if (nextIdx >= state.activeQueueGuids.length) {
    showToast('Finished playing playlist!', '🎉');
    return;
  }
  state.activeQueueIndex = nextIdx;
  const ep = state.episodesByGuid.get(state.activeQueueGuids[nextIdx]);
  if (!ep) return;
  const active = getActiveCollection();
  playlistPlayer.loadEpisode(ep, {
    cueSeconds: 0,
    autoPlay: true,
    queueLabel: `${active.icon} ${active.name} (${nextIdx + 1}/${state.activeQueueGuids.length})`
  });
  if (state.mode === 'playlists') renderPlaylistsView();
}

function bindPlaylistsEvents() {
  document.getElementById('create-playlist-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = document.getElementById('new-playlist-name');
    const pl = createPlaylist(state.player, {
      name: input.value,
      icon: state.newPlaylistIcon
    });
    input.value = '';
    state.selectedPlaylistId = pl.id;
    renderHeaderStats();
    renderPlaylistsView();
    showToast(`Created playlist "${pl.name}"!`, pl.icon);
  });

  document.querySelectorAll('[data-starter-pack]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.starterPack;
      const catMeta = getCategoryMeta(cat);
      const pool = [...state.episodes.filter((e) => e.category === cat)];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const picks = pool.slice(0, 5).map((e) => e.guid);
      const pl = createPlaylist(state.player, {
        name: `5 ${cat} Gems`,
        icon: catMeta.icon,
        color: catMeta.color,
        initialGuids: picks
      });
      state.selectedPlaylistId = pl.id;
      renderHeaderStats();
      renderPlaylistsView();
      showToast(`Generated "${pl.name}" with 5 episodes! Hit Play All to listen.`, catMeta.icon);
    });
  });
}

function openPlaylistPickerModal(guid) {
  const ep = state.episodesByGuid.get(guid);
  if (!ep) return;
  state.pickerTargetGuid = guid;

  document.getElementById('pl-picker-ep-label').textContent = `Save "${ep.title}" into:`;
  renderPlaylistPickerList();
  document.getElementById('playlist-picker-modal').hidden = false;
}

function renderPlaylistPickerList() {
  const listEl = document.getElementById('playlist-picker-list');
  const guid = state.pickerTargetGuid;
  const inFav = state.player.favoriteGuids.includes(guid);

  const itemsHtml = [
    `<button type="button" class="pl-select-btn" data-pick-fav="1">
      <span>❤️ My Favorites</span>
      <span>${inFav ? '✓ Saved' : '+ Add'}</span>
    </button>`,
    ...state.player.playlists.map((pl) => {
      const hasIt = pl.guids.includes(guid);
      return `<button type="button" class="pl-select-btn" data-pick-pl="${escapeHtml(pl.id)}">
        <span>${pl.icon} ${escapeHtml(pl.name)} (${pl.guids.length})</span>
        <span>${hasIt ? '✓ Added' : '+ Add'}</span>
      </button>`;
    })
  ];

  listEl.innerHTML = itemsHtml.join('');

  listEl.querySelector('[data-pick-fav]')?.addEventListener('click', () => {
    if (!state.player.favoriteGuids.includes(guid)) {
      toggleFavoriteEpisode(state.player, guid);
      heroPlayer.refreshFavoriteUi();
      renderHeaderStats();
    }
    document.getElementById('playlist-picker-modal').hidden = true;
    showToast('Saved to My Favorites ❤️', '❤️');
  });

  listEl.querySelectorAll('[data-pick-pl]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const plId = btn.dataset.pickPl;
      const added = addEpisodeToPlaylist(state.player, plId, guid);
      document.getElementById('playlist-picker-modal').hidden = true;
      renderHeaderStats();
      showToast(added ? 'Episode added to playlist!' : 'Already in that playlist!', '🎧');
    });
  });
}

// ============================================================================
// SOCIAL MEDIA SCORE CARD MODAL
// ============================================================================
function openScoreCardModal({ episode = null, attempt = null } = {}) {
  state.scoreCardContext = { episode, attempt };
  const canvas = document.getElementById('scorecard-canvas');
  renderScoreCardCanvas(canvas, {
    playerState: state.player,
    episode,
    attempt
  });
  document.getElementById('scorecard-modal').hidden = false;
}

// ============================================================================
// BADGE BOARD RENDERER
// ============================================================================
function renderBadgesBoard() {
  const grid = document.getElementById('badges-grid');
  grid.innerHTML = '';

  let unlockedTotal = 0;
  for (const b of BADGES) {
    const unlockedIso = state.player.unlockedBadges[b.id];
    const isUnlocked = Boolean(unlockedIso);
    if (isUnlocked) unlockedTotal++;

    const [cur, target] = b.progress(state.player);
    const pct = Math.min(100, Math.round((cur / target) * 100));

    const card = document.createElement('div');
    card.className = `badge-card ${isUnlocked ? 'is-unlocked' : ''}`;
    card.innerHTML = `
      <div class="badge-top">
        <div class="badge-medallion" style="${isUnlocked ? `background:${b.color}` : ''}">${b.icon}</div>
        <div>
          <h3 class="badge-title">${escapeHtml(b.title)}</h3>
          <span class="badge-status-chip">
            ${isUnlocked ? '✓ Unlocked!' : `Progress: ${cur} / ${target}`}
          </span>
        </div>
      </div>
      <p class="badge-desc">${escapeHtml(b.description)}</p>
      <div class="badge-meter" aria-hidden="true">
        <div class="badge-meter-fill" style="width:${pct}%"></div>
      </div>
    `;
    grid.appendChild(card);
  }

  document.getElementById('badges-unlocked-summary').textContent = `${unlockedTotal} / ${BADGES.length}`;
}

// ============================================================================
// GROUP GAME MODE (HOST + PLAYER + QR + UNIQUE EXPIRING CODES)
// ============================================================================
function showGroupScreen(screenName) {
  const ids = {
    entry: 'group-screen-entry',
    setup: 'group-screen-host-setup',
    hostRoom: 'group-screen-host-room',
    playerRoom: 'group-screen-player-room'
  };
  for (const [key, domId] of Object.entries(ids)) {
    document.getElementById(domId).hidden = key !== screenName;
  }
}

function renderAvatarPicker() {
  const grid = document.getElementById('join-avatar-grid');
  const nameInput = document.getElementById('join-name-input');
  if (state.player.preferredPlayerName) {
    nameInput.value = state.player.preferredPlayerName;
  }

  grid.innerHTML = '';
  for (const av of AVATARS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `avatar-choice-btn ${state.selectedAvatarId === av.id ? 'is-selected' : ''}`;
    btn.style.backgroundColor = av.bg;
    btn.title = av.name;
    btn.setAttribute('aria-label', av.name);
    btn.textContent = av.emoji;
    btn.addEventListener('click', () => {
      state.selectedAvatarId = av.id;
      grid.querySelectorAll('.avatar-choice-btn').forEach((b) => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
    });
    grid.appendChild(btn);
  }
}

function getHostMatchingEpisodes() {
  if (state.hostTopics.has('ALL')) return state.episodes;
  return state.episodes.filter((ep) => state.hostTopics.has(ep.category));
}

function renderHostTopicSelector() {
  const container = document.getElementById('host-topics-grid');
  container.innerHTML = '';

  for (const cat of CATEGORIES) {
    const active = state.hostTopics.has(cat.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cat-filter-btn ${active ? 'is-active' : ''}`;
    btn.innerHTML = `<span>${cat.icon}</span><span>${escapeHtml(cat.id === 'ALL' ? 'All Topics' : cat.label)}</span>`;
    btn.addEventListener('click', () => {
      if (cat.id === 'ALL') {
        state.hostTopics = new Set(['ALL']);
      } else {
        state.hostTopics.delete('ALL');
        if (state.hostTopics.has(cat.id)) {
          state.hostTopics.delete(cat.id);
        } else {
          state.hostTopics.add(cat.id);
        }
        if (state.hostTopics.size === 0) {
          state.hostTopics.add('ALL');
        }
      }
      renderHostTopicSelector();
    });
    container.appendChild(btn);
  }

  document.getElementById('host-pool-count').textContent = String(getHostMatchingEpisodes().length);
}

async function refreshHostCodeValidation() {
  const input = document.getElementById('host-code-input');
  const statusEl = document.getElementById('host-code-status');
  const launchBtn = document.getElementById('btn-launch-room');

  const normalized = normalizeCode(input.value);
  input.value = normalized;

  if (!normalized) {
    statusEl.className = 'code-validation-status';
    statusEl.textContent = 'Enter a custom 4–8 character code or generate a random 6-character code.';
    launchBtn.disabled = true;
    return;
  }

  const check = await state.groupService.checkCodeAvailability(normalized);
  if (check.available) {
    statusEl.className = 'code-validation-status is-ok';
    statusEl.textContent = `✓ Code "${check.code}" is unique and ready to reserve!`;
    launchBtn.disabled = false;
  } else {
    statusEl.className = 'code-validation-status is-taken';
    statusEl.innerHTML = `⚠️ ${escapeHtml(check.reason)} Suggested unique code: <button type="button" class="chip-link-btn" id="btn-use-suggested-code">${escapeHtml(check.suggestedCode)}</button>`;
    launchBtn.disabled = true;
    document.getElementById('btn-use-suggested-code')?.addEventListener('click', () => {
      input.value = check.suggestedCode;
      refreshHostCodeValidation();
    });
  }
}

function bindGroupEvents() {
  document.getElementById('btn-go-host-setup').addEventListener('click', async () => {
    showGroupScreen('setup');
    const codeInput = document.getElementById('host-code-input');
    if (!codeInput.value) {
      codeInput.value = await state.groupService.generateUniqueCode();
    }
    refreshHostCodeValidation();
  });

  document.querySelectorAll('[data-group-back="entry"]').forEach((btn) => {
    btn.addEventListener('click', () => showGroupScreen('entry'));
  });

  document.querySelectorAll('#host-qcount-pills [data-qcount]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.hostQuestionCount = Number(btn.dataset.qcount);
      document.querySelectorAll('#host-qcount-pills .seg-pill').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  document.querySelectorAll('#host-pacing-cards [data-pacing]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.hostPacing = btn.dataset.pacing;
      document.querySelectorAll('#host-pacing-cards .pacing-option').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      document.getElementById('host-speed-timer-wrap').hidden = state.hostPacing !== 'live';
    });
  });

  document.querySelectorAll('#host-duration-pills [data-duration]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.hostDuration = btn.dataset.duration;
      document.querySelectorAll('#host-duration-pills .seg-pill').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  document.getElementById('btn-random-code').addEventListener('click', async () => {
    document.getElementById('host-code-input').value = await state.groupService.generateUniqueCode();
    refreshHostCodeValidation();
  });

  document.getElementById('host-code-input').addEventListener('input', () => {
    clearTimeout(codeCheckTimeout);
    codeCheckTimeout = setTimeout(refreshHostCodeValidation, 220);
  });

  document.getElementById('host-create-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errEl = document.getElementById('host-create-error');
    errEl.hidden = true;

    const pool = [...getHostMatchingEpisodes()];
    if (pool.length === 0) {
      errEl.textContent = 'Please select at least one topic with questions.';
      errEl.hidden = false;
      return;
    }

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const chosenGuids = pool.slice(0, Math.min(state.hostQuestionCount, pool.length)).map((e) => e.guid);

    try {
      const room = await state.groupService.createRoom({
        code: document.getElementById('host-code-input').value,
        hostId: state.clientId,
        pacingMode: state.hostPacing,
        durationId: state.hostDuration,
        categories: Array.from(state.hostTopics),
        questionGuids: chosenGuids,
        speedTimer: document.getElementById('host-speed-timer').checked
      });

      const unlocked = markGroupGamePlayed(state.player);
      celebrateBadges(unlocked);

      enterHostRoom(room);
    } catch (err) {
      errEl.textContent = err.message || 'Could not create game room.';
      errEl.hidden = false;
      if (err.suggestedCode) {
        refreshHostCodeValidation();
      }
    }
  });

  document.getElementById('group-join-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errEl = document.getElementById('join-error-msg');
    errEl.hidden = true;

    const code = document.getElementById('join-code-input').value;
    const name = document.getElementById('join-name-input').value.trim();

    try {
      const room = await state.groupService.joinRoom({
        code,
        playerId: state.clientId,
        name,
        avatarId: state.selectedAvatarId
      });

      state.player.preferredPlayerName = name;
      state.player.preferredAvatarId = state.selectedAvatarId;
      savePlayerState(state.player);

      const unlocked = markGroupGamePlayed(state.player);
      celebrateBadges(unlocked);

      enterPlayerRoom(room);
    } catch (err) {
      errEl.textContent = err.message || 'Could not join game.';
      errEl.hidden = false;
    }
  });

  document.getElementById('btn-copy-join-link').addEventListener('click', async () => {
    if (!state.activeRoom) return;
    const url = state.groupService.getJoinUrl(state.activeRoom.code);
    try {
      await navigator.clipboard.writeText(url);
      showToast('Copied player join link to clipboard!', '🔗');
    } catch {
      showToast(url, '🔗');
    }
  });

  document.getElementById('btn-open-test-player').addEventListener('click', () => {
    if (!state.activeRoom) return;
    const url = state.groupService.getJoinUrl(state.activeRoom.code);
    window.open(url, '_blank', 'noopener');
  });

  document.getElementById('btn-end-host-room').addEventListener('click', async () => {
    if (state.activeRoom) {
      await state.groupService.closeRoom({ code: state.activeRoom.code, hostId: state.clientId });
    }
    leaveGroupRoom();
    showToast('Game room closed. That code is now free for future games!', '👋');
  });

  document.getElementById('btn-leave-player-room').addEventListener('click', () => {
    leaveGroupRoom();
  });
}

function leaveGroupRoom() {
  state.groupService.unsubscribe();
  state.activeRoom = null;
  state.activeRole = null;
  state.lastRenderedHostKey = '';
  state.lastRenderedPlayerKey = '';
  showGroupScreen('entry');
}

function enterHostRoom(room) {
  state.activeRoom = room;
  state.activeRole = 'host';
  state.lastRenderedHostKey = '';
  showGroupScreen('hostRoom');
  renderHostRoom(room);

  state.groupService.subscribe(room.code, (updated) => {
    state.activeRoom = updated;
    renderHostRoom(updated);
  });
}

function getSortedPlayers(room) {
  return Object.values(room.players || {}).sort((a, b) => (b.score || 0) - (a.score || 0));
}

function getAvatarObj(avatarId) {
  return AVATARS.find((a) => a.id === avatarId) || AVATARS[0];
}

function renderHostRoom(room) {
  document.getElementById('host-room-code-display').textContent = room.code;
  document.getElementById('host-room-expiry').textContent = formatTimeRemaining(room.expiresAt);

  if (!isRoomActive(room)) {
    leaveGroupRoom();
    showToast('Game code expired.', '⏱️');
    return;
  }

  const players = getSortedPlayers(room);
  const qIdx = room.currentQuestionIndex || 0;
  const answeredCount = players.filter((p) => Boolean(p.answers?.[qIdx])).length;
  const renderKey = `${room.phase}:${qIdx}:${players.length}:${answeredCount}:${players.map((p) => `${p.id}:${p.score}`).join(',')}`;
  if (renderKey === state.lastRenderedHostKey) return;
  state.lastRenderedHostKey = renderKey;

  const mount = document.getElementById('host-stage-mount');
  const joinUrl = state.groupService.getJoinUrl(room.code);
  const shapes = ['▲', '◆', '●', '■'];

  if (room.pacingMode === 'live' && room.phase === 'question' && players.length > 0 && answeredCount === players.length) {
    state.groupService
      .updateHostPhase({ code: room.code, hostId: state.clientId, phase: 'reveal' })
      .then((r) => {
        state.activeRoom = r;
        renderHostRoom(r);
      });
    return;
  }

  if (room.phase === 'lobby' || room.pacingMode === 'self_paced') {
    const qrSvg = renderQrSvg(joinUrl);
    const isSelfPaced = room.pacingMode === 'self_paced';

    mount.innerHTML = `
      <div class="lobby-grid">
        <div class="qr-box">
          <div class="qr-svg-holder">${qrSvg}</div>
          <p class="qr-caption">Scan with phone or tablet camera to join immediately!</p>
        </div>

        <div class="players-lobby-wrap">
          <div>
            <div class="section-eyebrow">
              ${isSelfPaced ? '🏁 SELF-PACED CHALLENGE ROOM' : '📺 LIVE KAHOOT LOBBY'} • ${room.questionGuids.length} QUESTIONS
            </div>
            <h2 class="section-title" style="margin-bottom:4px">
              ${isSelfPaced ? 'Leaderboard Live! Players Can Join Anytime' : `Players Joined (${players.length})`}
            </h2>
            <p class="section-subtitle">
              Players can scan the QR code or enter code <strong>${escapeHtml(room.code)}</strong> in Group Game mode.
            </p>
          </div>

          ${
            isSelfPaced
              ? renderScoreboardHtml(players, room.questionGuids.length, true)
              : `
                <div class="players-roster-grid">
                  ${
                    players.length === 0
                      ? '<span style="color:var(--ink-muted);font-weight:700">Waiting for players to hop in… (Click "Open Player Window" above to test!)</span>'
                      : players
                          .map((p) => {
                            const av = getAvatarObj(p.avatarId);
                            return `<div class="player-chip">
                              <span class="player-chip-avatar" style="background:${av.bg}">${av.emoji}</span>
                              <span>${escapeHtml(p.name)}</span>
                            </div>`;
                          })
                          .join('')
                  }
                </div>
                <div class="reveal-actions">
                  <button type="button" class="primary-cta-btn" id="btn-host-start-live">
                    ▶ Start Question 1 of ${room.questionGuids.length}
                  </button>
                </div>
              `
          }
        </div>
      </div>
    `;

    document.getElementById('btn-host-start-live')?.addEventListener('click', async () => {
      const updated = await state.groupService.updateHostPhase({
        code: room.code,
        hostId: state.clientId,
        phase: 'question',
        currentQuestionIndex: 0
      });
      state.activeRoom = updated;
      renderHostRoom(updated);
    });
    return;
  }

  const ep = state.episodesByGuid.get(room.questionGuids[qIdx]);
  if (!ep) return;

  if (room.phase === 'question') {
    mount.innerHTML = `
      <div>
        <div class="card-top-bar">
          <span class="section-eyebrow">QUESTION ${qIdx + 1} OF ${room.questionGuids.length} • ${escapeHtml(ep.category)}</span>
          <span class="pts-pill">${answeredCount} / ${players.length} Answered</span>
        </div>
        <h2 class="trivia-question" style="font-size:clamp(1.5rem,2.6vw,2.1rem)">${escapeHtml(ep.question)}</h2>

        <div class="kahoot-options-grid">
          ${ep.options
            .map(
              (opt, idx) => `
              <div class="kahoot-tile kahoot-tile--${idx}">
                <span class="kahoot-shape">${shapes[idx]}</span>
                <span>${escapeHtml(opt)}</span>
              </div>
            `
            )
            .join('')}
        </div>

        <div class="reveal-actions reveal-actions--next">
          <button type="button" class="primary-cta-btn" id="btn-host-reveal">
            ✨ Reveal Correct Answer
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-host-reveal').addEventListener('click', async () => {
      const updated = await state.groupService.updateHostPhase({
        code: room.code,
        hostId: state.clientId,
        phase: 'reveal'
      });
      state.activeRoom = updated;
      renderHostRoom(updated);
    });
    return;
  }

  if (room.phase === 'reveal') {
    const isLast = qIdx >= room.questionGuids.length - 1;
    mount.innerHTML = `
      <div>
        <div class="card-top-bar">
          <span class="section-eyebrow">ANSWER REVEAL • QUESTION ${qIdx + 1} OF ${room.questionGuids.length}</span>
          <span class="category-tag">${escapeHtml(ep.title)}</span>
        </div>
        <h2 class="trivia-question">${escapeHtml(ep.question)}</h2>

        <div class="kahoot-options-grid">
          ${ep.options
            .map((opt, idx) => {
              const pickCount = players.filter((p) => p.answers?.[qIdx]?.selectedIndex === idx).length;
              const isRight = idx === ep.correctIndex;
              return `
                <div class="kahoot-tile kahoot-tile--${idx} ${isRight ? 'is-winner' : 'is-dimmed'}">
                  <span class="kahoot-shape">${isRight ? '✓' : shapes[idx]}</span>
                  <span>${escapeHtml(opt)} <strong>(${pickCount})</strong></span>
                </div>
              `;
            })
            .join('')}
        </div>

        <div class="answer-reveal-box">
          <p class="reveal-correct-line">✓ ${escapeHtml(ep.options[ep.correctIndex])}</p>
          <p class="reveal-explanation">${escapeHtml(ep.explanation)}</p>
        </div>

        <h3 class="setup-step-title" style="margin-top:20px">🏅 Current Standings</h3>
        ${renderScoreboardHtml(players, room.questionGuids.length, false)}

        <div class="reveal-actions reveal-actions--next">
          <button type="button" class="primary-cta-btn" id="btn-host-next-q">
            ${isLast ? '🏆 Show Final Podium!' : `Next Question (${qIdx + 2}/${room.questionGuids.length}) →`}
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-host-next-q').addEventListener('click', async () => {
      const updated = await state.groupService.updateHostPhase({
        code: room.code,
        hostId: state.clientId,
        phase: isLast ? 'finished' : 'question',
        currentQuestionIndex: isLast ? qIdx : qIdx + 1
      });
      if (isLast) fireConfetti(85);
      state.activeRoom = updated;
      renderHostRoom(updated);
    });
    return;
  }

  if (room.phase === 'finished') {
    mount.innerHTML = `
      <div style="text-align:center">
        <div class="complete-emoji">🏆</div>
        <h2 class="section-title">Final Group Game Podium!</h2>
        <p class="section-subtitle" style="margin:0 auto 20px">
          Thanks for playing Fun Facts Daily Trivia together!
        </p>
        ${renderScoreboardHtml(players, room.questionGuids.length, false)}
        <div class="reveal-actions" style="justify-content:center">
          <button type="button" class="primary-cta-btn" id="btn-host-new-game">
            🎉 Set Up Another Game
          </button>
        </div>
      </div>
    `;
    document.getElementById('btn-host-new-game').addEventListener('click', async () => {
      await state.groupService.closeRoom({ code: room.code, hostId: state.clientId });
      leaveGroupRoom();
      showGroupScreen('setup');
      document.getElementById('host-code-input').value = await state.groupService.generateUniqueCode();
      refreshHostCodeValidation();
    });
  }
}

function renderScoreboardHtml(players, totalQ, showProgress) {
  if (!players.length) {
    return `<div class="players-roster-grid"><span style="color:var(--ink-muted);font-weight:700">No players have joined yet—scan the QR code to hop in!</span></div>`;
  }
  const medals = ['🥇', '🥈', '🥉'];
  return `
    <div class="leaderboard-list">
      ${players
        .map((p, idx) => {
          const av = getAvatarObj(p.avatarId);
          const doneCount = Object.keys(p.answers || {}).length;
          return `
            <div class="leaderboard-row">
              <div style="display:flex;align-items:center;gap:10px">
                <span>${medals[idx] || `#${idx + 1}`}</span>
                <span class="player-chip-avatar" style="background:${av.bg}">${av.emoji}</span>
                <span>${escapeHtml(p.name)}</span>
                ${showProgress ? `<span style="font-size:0.8rem;color:var(--ink-muted)">(${doneCount}/${totalQ} answered)</span>` : ''}
              </div>
              <span>${(p.score || 0).toLocaleString()} pts</span>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function enterPlayerRoom(room) {
  state.activeRoom = room;
  state.activeRole = 'player';
  state.lastRenderedPlayerKey = '';
  showGroupScreen('playerRoom');
  renderPlayerRoom(room);

  state.groupService.subscribe(room.code, (updated) => {
    state.activeRoom = updated;
    renderPlayerRoom(updated);
  });
}

function renderPlayerRoom(room) {
  if (!isRoomActive(room)) {
    leaveGroupRoom();
    showToast('This game room has ended or expired.', '👋');
    return;
  }

  const me = room.players?.[state.clientId];
  if (!me) {
    leaveGroupRoom();
    return;
  }

  const av = getAvatarObj(me.avatarId);
  document.getElementById('player-identity-pill').innerHTML = `
    <span class="player-chip-avatar" style="background:${av.bg}">${av.emoji}</span>
    <span>${escapeHtml(me.name)}</span>
  `;
  document.getElementById('player-room-code-display').textContent = room.code;
  document.getElementById('player-score-pill').textContent = `${me.score || 0} PTS`;

  const players = getSortedPlayers(room);
  const myAnswerKeys = Object.keys(me.answers || {}).join(',');
  const renderKey = `${room.phase}:${room.currentQuestionIndex}:${myAnswerKeys}:${players.map((p) => `${p.id}:${p.score}`).join(',')}`;
  if (renderKey === state.lastRenderedPlayerKey) return;
  state.lastRenderedPlayerKey = renderKey;

  const mount = document.getElementById('player-stage-mount');
  const shapes = ['▲', '◆', '●', '■'];

  if (room.pacingMode === 'self_paced') {
    let nextIdx = 0;
    while (nextIdx < room.questionGuids.length && me.answers?.[nextIdx]) {
      nextIdx++;
    }

    if (nextIdx >= room.questionGuids.length) {
      mount.innerHTML = `
        <div style="text-align:center">
          <div class="complete-emoji">🎉</div>
          <h2 class="section-title">Challenge Complete!</h2>
          <p class="section-subtitle" style="margin:0 auto 18px">
            You scored <strong>${me.score} points</strong>! Here is the live room leaderboard:
          </p>
          ${renderScoreboardHtml(players, room.questionGuids.length, true)}
        </div>
      `;
      return;
    }

    const ep = state.episodesByGuid.get(room.questionGuids[nextIdx]);
    if (!ep) return;

    mount.innerHTML = `
      <div>
        <div class="card-top-bar">
          <span class="section-eyebrow">SELF-PACED QUESTION ${nextIdx + 1} OF ${room.questionGuids.length}</span>
          <span class="category-tag">${escapeHtml(ep.category)}</span>
        </div>
        <h2 class="trivia-question">${escapeHtml(ep.question)}</h2>
        <div class="kahoot-options-grid" id="player-self-options">
          ${ep.options
            .map(
              (opt, idx) => `
              <button type="button" class="kahoot-tile kahoot-tile--${idx}" data-pick="${idx}">
                <span class="kahoot-shape">${shapes[idx]}</span>
                <span>${escapeHtml(opt)}</span>
              </button>
            `
            )
            .join('')}
        </div>
      </div>
    `;

    mount.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const picked = Number(btn.dataset.pick);
        const updated = await state.groupService.submitPlayerAnswer({
          code: room.code,
          playerId: state.clientId,
          questionIndex: nextIdx,
          selectedIndex: picked,
          correctIndex: ep.correctIndex
        });
        if (picked === ep.correctIndex) {
          fireConfetti(28);
          showToast(`Correct! +${SHOW_CONFIG.points.groupBase} pts`, '🎯');
        } else {
          showToast(`Answer: ${ep.options[ep.correctIndex]}`, '💡');
        }
        state.activeRoom = updated;
        renderPlayerRoom(updated);
      });
    });
    return;
  }

  if (room.phase === 'lobby') {
    mount.innerHTML = `
      <div style="text-align:center;padding:28px 10px">
        <div class="complete-emoji">${av.emoji}</div>
        <h2 class="section-title">You’re In the Lobby, ${escapeHtml(me.name)}!</h2>
        <p class="section-subtitle" style="margin:0 auto">
          Keep your eyes on the host’s screen — answer buttons will pop up right here as soon as Question 1 begins!
        </p>
      </div>
    `;
    return;
  }

  const qIdx = room.currentQuestionIndex || 0;
  const ep = state.episodesByGuid.get(room.questionGuids[qIdx]);
  const myAttempt = me.answers?.[qIdx];

  if (room.phase === 'question' && ep) {
    if (myAttempt) {
      mount.innerHTML = `
        <div style="text-align:center;padding:26px 10px">
          <div class="complete-emoji">🔒</div>
          <h2 class="section-title">Answer Locked In!</h2>
          <p class="section-subtitle" style="margin:0 auto">
            Waiting for the host to reveal the answer…
          </p>
        </div>
      `;
      return;
    }

    mount.innerHTML = `
      <div>
        <div class="section-eyebrow">QUESTION ${qIdx + 1} OF ${room.questionGuids.length} • TAP YOUR ANSWER!</div>
        <h2 class="trivia-question">${escapeHtml(ep.question)}</h2>
        <div class="kahoot-options-grid">
          ${ep.options
            .map(
              (opt, idx) => `
              <button type="button" class="kahoot-tile kahoot-tile--${idx}" data-live-pick="${idx}">
                <span class="kahoot-shape">${shapes[idx]}</span>
                <span>${escapeHtml(opt)}</span>
              </button>
            `
            )
            .join('')}
        </div>
      </div>
    `;

    mount.querySelectorAll('[data-live-pick]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const picked = Number(btn.dataset.livePick);
        const updated = await state.groupService.submitPlayerAnswer({
          code: room.code,
          playerId: state.clientId,
          questionIndex: qIdx,
          selectedIndex: picked,
          correctIndex: ep.correctIndex
        });
        state.activeRoom = updated;
        renderPlayerRoom(updated);
      });
    });
    return;
  }

  if (room.phase === 'reveal' && ep) {
    const gotIt = Boolean(myAttempt?.correct);
    mount.innerHTML = `
      <div>
        <div class="answer-reveal-box" style="margin-top:0">
          <div class="reveal-banner ${gotIt ? 'reveal-banner--correct' : 'reveal-banner--wrong'}">
            ${gotIt ? `🎉 Correct! +${myAttempt.points} pts` : myAttempt ? '💡 So Close!' : '⏰ Time’s Up!'}
          </div>
          <p class="reveal-correct-line">Correct Answer: ${escapeHtml(ep.options[ep.correctIndex])}</p>
          <p class="reveal-explanation">${escapeHtml(ep.explanation)}</p>
        </div>
        <h3 class="setup-step-title" style="margin-top:18px">Live Standings</h3>
        ${renderScoreboardHtml(players, room.questionGuids.length, false)}
      </div>
    `;
    return;
  }

  if (room.phase === 'finished') {
    const myRank = players.findIndex((p) => p.id === state.clientId) + 1;
    mount.innerHTML = `
      <div style="text-align:center">
        <div class="complete-emoji">🏆</div>
        <h2 class="section-title">You Finished #${myRank} with ${me.score} Points!</h2>
        ${renderScoreboardHtml(players, room.questionGuids.length, false)}
      </div>
    `;
  }
}

// ============================================================================
// MODALS: SCORE CARD, PLAYLIST PICKER, PWA INSTALL, SYNC & HOST STUDIO
// ============================================================================
function bindModalEvents() {
  const scorecardModal = document.getElementById('scorecard-modal');
  const playlistPickerModal = document.getElementById('playlist-picker-modal');
  const installModal = document.getElementById('install-app-modal');
  const syncModal = document.getElementById('sync-modal');
  const studioModal = document.getElementById('studio-modal');

  // Social Score Card Actions
  document.getElementById('btn-native-share-card').addEventListener('click', async () => {
    const canvas = document.getElementById('scorecard-canvas');
    const caption = buildShareCaption({
      playerState: state.player,
      episode: state.scoreCardContext.episode,
      attempt: state.scoreCardContext.attempt
    });

    try {
      const blob = await canvasToPngBlob(canvas);
      const file = new File([blob], 'fun-facts-daily-scorecard.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Fun Facts Daily Trivia',
          text: caption,
          files: [file]
        });
        return;
      }
      // Desktop fallback: copy PNG image directly to clipboard or download
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Copied score card image to clipboard! Paste it into any social post or chat.', '📸');
        return;
      }
    } catch {
      // Fall through to PNG download if user cancels or browser lacks Web Share
    }
    document.getElementById('btn-download-card-png').click();
  });

  document.getElementById('btn-download-card-png').addEventListener('click', async () => {
    const canvas = document.getElementById('scorecard-canvas');
    const blob = await canvasToPngBlob(canvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fun-facts-daily-scorecard.png';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded score card PNG!', '⬇');
  });

  document.getElementById('btn-copy-card-caption').addEventListener('click', async () => {
    const caption = buildShareCaption({
      playerState: state.player,
      episode: state.scoreCardContext.episode,
      attempt: state.scoreCardContext.attempt
    });
    try {
      await navigator.clipboard.writeText(caption);
      showToast('Copied caption & podcast link to clipboard!', '📋');
    } catch {
      showToast('Caption ready!', '📋');
    }
  });

  // Quick Create Playlist inside Picker Modal
  document.getElementById('quick-create-playlist-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = document.getElementById('quick-playlist-name');
    const guid = state.pickerTargetGuid;
    if (!input.value.trim() || !guid) return;
    const pl = createPlaylist(state.player, {
      name: input.value,
      icon: '🎧',
      initialGuids: [guid]
    });
    input.value = '';
    playlistPickerModal.hidden = true;
    renderHeaderStats();
    showToast(`Created "${pl.name}" and added episode!`, '🎧');
  });

  // Install Mobile App Modal
  document.getElementById('btn-install-app').addEventListener('click', () => {
    installModal.hidden = false;
  });

  document.getElementById('btn-trigger-native-pwa').addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice.catch(() => {});
    state.deferredInstallPrompt = null;
    document.getElementById('native-pwa-install-wrap').hidden = true;
    installModal.hidden = true;
  });

  // Sync Modal
  document.getElementById('btn-open-sync').addEventListener('click', () => {
    document.getElementById('sync-export-box').value = exportSyncCode(state.player);
    document.getElementById('sync-status-msg').hidden = true;
    syncModal.hidden = false;
  });

  document.getElementById('btn-copy-sync-code').addEventListener('click', async () => {
    const val = document.getElementById('sync-export-box').value;
    try {
      await navigator.clipboard.writeText(val);
      showToast('Backup code copied! Paste it on any other device.', '🔄');
    } catch {
      document.getElementById('sync-export-box').select();
    }
  });

  document.getElementById('btn-apply-sync-code').addEventListener('click', () => {
    const msgEl = document.getElementById('sync-status-msg');
    try {
      state.player = importSyncCode(document.getElementById('sync-import-box').value);
      heroPlayer.refreshFavoriteUi();
      renderHeaderStats(true);
      renderDailySection();
      renderCategoryFilterBar();
      pickNextArchiveQuestion();
      renderBadgesBoard();
      renderEpisodesCatalog();
      renderPlaylistsView();
      syncModal.hidden = true;
      showToast('Progress, streaks & playlists restored!', '🎉');
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.hidden = false;
    }
  });

  // Host Studio
  const catSelect = document.getElementById('studio-q-category');
  catSelect.innerHTML = CATEGORIES.filter((c) => c.id !== 'ALL')
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`)
    .join('');

  document.getElementById('btn-open-studio').addEventListener('click', () => {
    document.getElementById('studio-ep-count').textContent = String(state.episodes.length);
    renderStudioResults('');
    studioModal.hidden = false;
  });

  document.getElementById('studio-search-input').addEventListener('input', (ev) => {
    renderStudioResults(ev.target.value);
  });

  document.getElementById('studio-edit-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!state.editingGuid) return;
    const patch = {
      category: document.getElementById('studio-q-category').value,
      cueSeconds: Number(document.getElementById('studio-q-cue').value) || 0,
      question: document.getElementById('studio-q-text').value.trim(),
      options: [
        document.getElementById('studio-opt-0').value.trim(),
        document.getElementById('studio-opt-1').value.trim(),
        document.getElementById('studio-opt-2').value.trim(),
        document.getElementById('studio-opt-3').value.trim()
      ],
      correctIndex: Number(document.getElementById('studio-q-correct').value),
      explanation: document.getElementById('studio-q-exp').value.trim()
    };

    saveHostOverride(state.editingGuid, patch);
    const ep = state.episodesByGuid.get(state.editingGuid);
    if (ep) Object.assign(ep, patch);

    renderDailySection();
    renderCategoryFilterBar();
    renderEpisodesCatalog();
    if (state.currentArchiveEp?.guid === state.editingGuid) {
      renderArchiveQuestionCard();
    }
    showToast('Saved question update!', '💾');
  });

  document.getElementById('btn-export-questions-json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.episodes, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'questions.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.closeModal).hidden = true;
    });
  });

  [scorecardModal, playlistPickerModal, installModal, syncModal, studioModal].forEach((backdrop) => {
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) backdrop.hidden = true;
    });
  });
}

function renderStudioResults(query) {
  const q = String(query || '').toLowerCase().trim();
  const listEl = document.getElementById('studio-results-list');
  const matches = state.episodes
    .filter((ep) => !q || ep.title.toLowerCase().includes(q) || ep.question.toLowerCase().includes(q))
    .slice(0, 40);

  listEl.innerHTML = matches
    .map(
      (ep) => `
      <button type="button" class="studio-ep-item" data-studio-guid="${escapeHtml(ep.guid)}">
        <span>${escapeHtml(ep.title)}</span>
        <span style="color:var(--ink-muted)">${escapeHtml(ep.category)} • ${formatTime(ep.cueSeconds)}</span>
      </button>
    `
    )
    .join('');

  listEl.querySelectorAll('[data-studio-guid]').forEach((btn) => {
    btn.addEventListener('click', () => openStudioEditor(btn.dataset.studioGuid));
  });
}

function openStudioEditor(guid) {
  const ep = state.episodesByGuid.get(guid);
  if (!ep) return;
  state.editingGuid = guid;
  const form = document.getElementById('studio-edit-form');
  form.hidden = false;
  document.getElementById('studio-edit-ep-title').textContent = ep.title;
  document.getElementById('studio-q-category').value = ep.category;
  document.getElementById('studio-q-cue').value = ep.cueSeconds || 180;
  document.getElementById('studio-q-text').value = ep.question;
  document.getElementById('studio-opt-0').value = ep.options[0] || '';
  document.getElementById('studio-opt-1').value = ep.options[1] || '';
  document.getElementById('studio-opt-2').value = ep.options[2] || '';
  document.getElementById('studio-opt-3').value = ep.options[3] || '';
  document.getElementById('studio-q-correct').value = String(ep.correctIndex);
  document.getElementById('studio-q-exp').value = ep.explanation;
}

// Boot application
initApp().catch((err) => {
  console.error('Failed to initialize Fun Facts Daily Trivia:', err);
});
