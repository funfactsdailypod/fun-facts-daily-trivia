import { BADGES, SHOW_CONFIG } from './config.js';

const STORAGE_KEY = 'ffd_trivia_player_v1';
const OVERRIDES_KEY = 'ffd_trivia_host_overrides_v1';

function toDateKey(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

function parseDateKey(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Maps any calendar day to its Mon-Fri podcast broadcast slot:
 * Mon-Fri -> same day; Sat (-1d) & Sun (-2d) -> that week's Friday.
 */
export function getBroadcastSlotDate(date = new Date()) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  const dow = copy.getDay(); // 0=Sun, 6=Sat
  if (dow === 6) copy.setDate(copy.getDate() - 1);
  else if (dow === 0) copy.setDate(copy.getDate() - 2);
  return toDateKey(copy);
}

export function getPreviousBroadcastSlot(slotKey) {
  const d = parseDateKey(slotKey);
  const dow = d.getDay();
  // Monday's previous broadcast day is Friday (3 days back)
  d.setDate(d.getDate() - (dow === 1 ? 3 : 1));
  return toDateKey(d);
}

export function isWeekendDay(date = new Date()) {
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

function createDefaultState() {
  return {
    version: 2,
    totalPoints: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastCorrectSlot: null,
    lastAttemptedSlot: null,
    dailyCorrectCount: 0,
    dailyAttempts: {}, // { [guid]: { selectedIndex, correct, slot, answeredAt } }
    weekendVaultAttempts: {}, // { [weekendKey]: { guid, selectedIndex, correct, answeredAt } }
    seenArchiveGuids: [], // guarantees an archive question never repeats for this player
    archiveAttemptsCount: 0,
    archiveCorrectCount: 0,
    categoryCorrectCounts: {},
    unlockedBadges: {}, // { [badgeId]: unlockedIsoDate }
    episodesPlayedCount: 0,
    applePodcastVisited: false,
    groupGamePlayed: false,
    preferredPlayerName: '',
    preferredAvatarId: 'fox',
    // Companion App features: Favorites, Listened History & Custom Playlists
    favoriteGuids: [],
    listenedGuids: [],
    playlists: [] // [{ id, name, icon, color, guids: [], createdAt }]
  };
}

export function loadPlayerState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    const state = { ...createDefaultState(), ...parsed };
    if (!Array.isArray(state.favoriteGuids)) state.favoriteGuids = [];
    if (!Array.isArray(state.listenedGuids)) state.listenedGuids = [];
    if (!Array.isArray(state.playlists)) state.playlists = [];
    refreshStreakExpiration(state);
    return state;
  } catch {
    return createDefaultState();
  }
}

export function savePlayerState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors in private browsing
  }
}

/**
 * Checks if the player missed one or more full Mon-Fri broadcast slots;
 * Saturdays & Sundays automatically preserve Friday's streak through Monday!
 */
export function refreshStreakExpiration(state, now = new Date()) {
  if (!state.lastCorrectSlot || state.currentStreak === 0) return state;
  const activeSlot = getBroadcastSlotDate(now);
  const prevSlot = getPreviousBroadcastSlot(activeSlot);
  if (state.lastCorrectSlot !== activeSlot && state.lastCorrectSlot !== prevSlot) {
    state.currentStreak = 0;
    savePlayerState(state);
  }
  return state;
}

export function evaluateNewBadges(state) {
  const newlyUnlocked = [];
  const nowIso = new Date().toISOString();
  for (const badge of BADGES) {
    if (!state.unlockedBadges[badge.id] && badge.check(state)) {
      state.unlockedBadges[badge.id] = nowIso;
      newlyUnlocked.push(badge);
    }
  }
  if (newlyUnlocked.length > 0) {
    savePlayerState(state);
  }
  return newlyUnlocked;
}

export function recordDailyDoubleSubmission(state, episode, selectedIndex, now = new Date()) {
  if (state.dailyAttempts[episode.guid]) {
    return { alreadyAnswered: true, newlyUnlocked: [] };
  }
  refreshStreakExpiration(state, now);
  const activeSlot = getBroadcastSlotDate(now);
  const prevSlot = getPreviousBroadcastSlot(activeSlot);
  const correct = selectedIndex === episode.correctIndex;

  state.dailyAttempts[episode.guid] = {
    selectedIndex,
    correct,
    slot: activeSlot,
    answeredAt: now.toISOString()
  };
  state.lastAttemptedSlot = activeSlot;

  let pointsEarned = 0;
  if (correct) {
    pointsEarned = SHOW_CONFIG.points.dailyDouble;
    state.totalPoints += pointsEarned;
    state.dailyCorrectCount += 1;
    state.categoryCorrectCounts[episode.category] =
      (state.categoryCorrectCounts[episode.category] || 0) + 1;

    if (state.lastCorrectSlot === activeSlot) {
      state.currentStreak = Math.max(1, state.currentStreak);
    } else if (state.lastCorrectSlot === prevSlot) {
      state.currentStreak += 1;
    } else {
      state.currentStreak = 1;
    }
    state.lastCorrectSlot = activeSlot;
    if (state.currentStreak > state.bestStreak) {
      state.bestStreak = state.currentStreak;
    }
  } else {
    state.currentStreak = 0;
  }

  savePlayerState(state);
  const newlyUnlocked = evaluateNewBadges(state);
  return { correct, pointsEarned, newlyUnlocked };
}

export function getWeekendKey(now = new Date()) {
  return toDateKey(now);
}

export function recordWeekendVaultSubmission(state, episode, bonusQuestion, selectedIndex, now = new Date()) {
  const wkKey = getWeekendKey(now);
  if (state.weekendVaultAttempts[wkKey]) {
    return { alreadyAnswered: true, newlyUnlocked: [] };
  }
  const correct = selectedIndex === bonusQuestion.correctIndex;
  const pointsEarned = correct ? SHOW_CONFIG.points.weekendVault : 0;
  state.weekendVaultAttempts[wkKey] = {
    guid: episode.guid,
    selectedIndex,
    correct,
    answeredAt: now.toISOString()
  };
  if (correct) {
    state.totalPoints += pointsEarned;
    state.categoryCorrectCounts[episode.category] =
      (state.categoryCorrectCounts[episode.category] || 0) + 1;
  }
  savePlayerState(state);
  const newlyUnlocked = evaluateNewBadges(state);
  return { correct, pointsEarned, newlyUnlocked };
}

export function recordArchiveSubmission(state, episode, selectedIndex) {
  const correct = selectedIndex === episode.correctIndex;
  const pointsEarned = correct ? SHOW_CONFIG.points.archiveQuestion : 0;

  if (!state.seenArchiveGuids.includes(episode.guid)) {
    state.seenArchiveGuids.push(episode.guid);
  }
  state.archiveAttemptsCount += 1;
  if (correct) {
    state.archiveCorrectCount += 1;
    state.totalPoints += pointsEarned;
    state.categoryCorrectCounts[episode.category] =
      (state.categoryCorrectCounts[episode.category] || 0) + 1;
  }

  savePlayerState(state);
  const newlyUnlocked = evaluateNewBadges(state);
  return { correct, pointsEarned, newlyUnlocked };
}

export function markEpisodePlayed(state, episodeGuid = null) {
  state.episodesPlayedCount = (state.episodesPlayedCount || 0) + 1;
  if (episodeGuid && !state.listenedGuids.includes(episodeGuid)) {
    state.listenedGuids.push(episodeGuid);
  }
  savePlayerState(state);
  return evaluateNewBadges(state);
}

export function markApplePodcastVisited(state) {
  state.applePodcastVisited = true;
  savePlayerState(state);
  return evaluateNewBadges(state);
}

export function markGroupGamePlayed(state) {
  state.groupGamePlayed = true;
  savePlayerState(state);
  return evaluateNewBadges(state);
}

// ============================================================================
// FAVORITES & CUSTOM PLAYLISTS
// ============================================================================
export function toggleFavoriteEpisode(state, guid) {
  if (!guid) return false;
  const idx = state.favoriteGuids.indexOf(guid);
  let added = false;
  if (idx >= 0) {
    state.favoriteGuids.splice(idx, 1);
  } else {
    state.favoriteGuids.unshift(guid);
    added = true;
  }
  savePlayerState(state);
  return added;
}

export function createPlaylist(state, { name, icon = '🎧', color = '#FFD23F', initialGuids = [] }) {
  const cleanName = String(name || '').trim().slice(0, 40) || 'My Fun Facts Mix';
  const playlist = {
    id: `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    icon,
    color,
    guids: Array.from(new Set(initialGuids)),
    createdAt: new Date().toISOString()
  };
  state.playlists.unshift(playlist);
  savePlayerState(state);
  return playlist;
}

export function deletePlaylist(state, playlistId) {
  state.playlists = state.playlists.filter((p) => p.id !== playlistId);
  savePlayerState(state);
}

export function addEpisodeToPlaylist(state, playlistId, guid) {
  const pl = state.playlists.find((p) => p.id === playlistId);
  if (!pl || !guid) return false;
  if (pl.guids.includes(guid)) return false;
  pl.guids.push(guid);
  savePlayerState(state);
  return true;
}

export function removeEpisodeFromPlaylist(state, playlistId, guid) {
  const pl = state.playlists.find((p) => p.id === playlistId);
  if (!pl) return;
  pl.guids = pl.guids.filter((g) => g !== guid);
  savePlayerState(state);
}

export function moveEpisodeInPlaylist(state, playlistId, fromIdx, toIdx) {
  const pl = state.playlists.find((p) => p.id === playlistId);
  if (!pl) return;
  if (fromIdx < 0 || fromIdx >= pl.guids.length || toIdx < 0 || toIdx >= pl.guids.length) return;
  const [moved] = pl.guids.splice(fromIdx, 1);
  pl.guids.splice(toIdx, 0, moved);
  savePlayerState(state);
}

/**
 * Encodes a playlist into a compact URL parameter using 8-char GUID prefixes
 * so teachers, parents, and listeners can share playlists via link with zero login!
 */
export function encodePlaylistShareParam(playlist) {
  const payload = {
    n: playlist.name.slice(0, 40),
    i: playlist.icon || '🎧',
    c: playlist.color || '#FFD23F',
    g: (playlist.guids || []).slice(0, 35).map((g) => String(g).slice(0, 8))
  };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return b64;
}

export function decodePlaylistShareParam(param, allEpisodes) {
  const padded = String(param || '').replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(escape(atob(padded)));
  const data = JSON.parse(json);
  const guids = [];
  for (const prefix of data.g || []) {
    const match = allEpisodes.find((ep) => ep.guid.startsWith(prefix));
    if (match && !guids.includes(match.guid)) {
      guids.push(match.guid);
    }
  }
  return {
    name: String(data.n || 'Shared Playlist').slice(0, 40),
    icon: data.i || '🎧',
    color: data.c || '#FFD23F',
    guids
  };
}

// ============================================================================
// PORTABLE BACKUP / SYNC CODE
// ============================================================================
export function exportSyncCode(state) {
  const payload = JSON.stringify(state);
  const encoded = btoa(unescape(encodeURIComponent(payload)));
  return `FFD1-${encoded}`;
}

export function importSyncCode(codeString) {
  const trimmed = String(codeString || '').trim();
  if (!trimmed.startsWith('FFD1-')) {
    throw new Error('Invalid backup code format (must start with FFD1-).');
  }
  const b64 = trimmed.slice(5);
  const json = decodeURIComponent(escape(atob(b64)));
  const parsed = JSON.parse(json);
  if (typeof parsed.totalPoints !== 'number' || !Array.isArray(parsed.seenArchiveGuids)) {
    throw new Error('Backup code data could not be verified.');
  }
  const merged = { ...createDefaultState(), ...parsed };
  refreshStreakExpiration(merged);
  savePlayerState(merged);
  return merged;
}

export function loadHostOverrides() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveHostOverride(guid, patch) {
  const all = loadHostOverrides();
  all[guid] = { ...(all[guid] || {}), ...patch, updatedAt: new Date().toISOString() };
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(all));
  return all;
}
