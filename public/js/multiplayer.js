import { CLOUD_CONFIG, SHOW_CONFIG, isFamilyFriendlyText } from './config.js';

const LOCAL_ROOMS_KEY = 'ffd_trivia_group_rooms_v1';
const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const DURATION_OPTIONS = [
  { id: '1h', label: '1 Hour', ms: 60 * 60 * 1000, hint: 'Best for live game nights' },
  { id: '1d', label: '1 Day', ms: 24 * 60 * 60 * 1000, hint: 'Great for classroom & friend challenges' },
  { id: '1w', label: '1 Week', ms: 7 * 24 * 60 * 60 * 1000, hint: 'Stays reserved all week' }
];

export const QUESTION_TIMER_OPTIONS = [
  { sec: 15, label: '15s' },
  { sec: 20, label: '20s' },
  { sec: 30, label: '30s' },
  { sec: 45, label: '45s' },
  { sec: 60, label: '60s' }
];

export function normalizeCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
}

export function generateRandomCode(existingCodesSet = new Set()) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
    }
    if (!existingCodesSet.has(code) && isFamilyFriendlyText(code)) {
      return code;
    }
  }
  return `FFD${Math.floor(100 + Math.random() * 899)}`;
}

export function isRoomActive(room, nowMs = Date.now()) {
  if (!room) return false;
  return Number(room.expiresAt) > nowMs && !room.terminated;
}

export function formatTimeRemaining(expiresAtMs, nowMs = Date.now()) {
  const diff = Math.max(0, Number(expiresAtMs) - nowMs);
  if (diff <= 0) return 'Expired';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ${mins % 60}m left`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h left`;
}

/**
 * Deterministically computes every player's score across all questions:
 * - Correct answer base: +10 points
 * - 1st player to answer correctly: +5 bonus points (15 total)
 * - 2nd player to answer correctly: +2 bonus points (12 total)
 * - Wrong or unanswered: 0 points
 */
export function recomputeRoomScores(room) {
  if (!room || typeof room.players !== 'object' || !room.players) return room;

  const basePts = SHOW_CONFIG.points.friendsCorrectBase || 10;
  const firstBonus = SHOW_CONFIG.points.friendsFirstBonus || 5;
  const secondBonus = SHOW_CONFIG.points.friendsSecondBonus || 2;
  const qCount = Array.isArray(room.questionGuids) ? room.questionGuids.length : 0;

  for (const player of Object.values(room.players)) {
    player.score = 0;
    player.correctCount = 0;
    player.firstBonuses = 0;
    player.secondBonuses = 0;
    if (!player.answers || typeof player.answers !== 'object') {
      player.answers = {};
    }
  }

  for (let qIdx = 0; qIdx < qCount; qIdx++) {
    const qKey = String(qIdx);
    const correctEntries = [];

    for (const [pid, player] of Object.entries(room.players)) {
      const ans = player.answers[qKey] || player.answers[qIdx];
      if (!ans) continue;
      if (qIdx in player.answers && qKey !== qIdx) {
        player.answers[qKey] = ans;
      }
      if (ans.correct) {
        correctEntries.push({ pid, player, ans });
      } else {
        ans.basePoints = 0;
        ans.bonusPoints = 0;
        ans.points = 0;
        ans.speedRank = null;
      }
    }

    correctEntries.sort((a, b) => {
      const tDiff = (Number(a.ans.answeredAt) || 0) - (Number(b.ans.answeredAt) || 0);
      return tDiff !== 0 ? tDiff : a.pid.localeCompare(b.pid);
    });

    correctEntries.forEach(({ player, ans }, rankIdx) => {
      const bonus = rankIdx === 0 ? firstBonus : rankIdx === 1 ? secondBonus : 0;
      ans.basePoints = basePts;
      ans.bonusPoints = bonus;
      ans.points = basePts + bonus;
      ans.speedRank = rankIdx + 1;
      if (rankIdx === 0) player.firstBonuses += 1;
      if (rankIdx === 1) player.secondBonuses += 1;
    });
  }

  for (const player of Object.values(room.players)) {
    for (const ans of Object.values(player.answers || {})) {
      if (!ans) continue;
      player.score += Number(ans.points) || 0;
      if (ans.correct) player.correctCount += 1;
    }
  }

  return room;
}

export function getQuestionRemainingMs(room, nowMs = Date.now()) {
  if (!room || room.phase !== 'question') return 0;
  if (room.paused) {
    return Math.max(0, Number(room.pausedRemainingMs) || (room.timePerQuestionSec || 20) * 1000);
  }
  if (!room.questionDeadlineAt) {
    return (room.timePerQuestionSec || 20) * 1000;
  }
  return Math.max(0, Number(room.questionDeadlineAt) - nowMs);
}

/**
 * Unified Play with Friends Room Client:
 * 1) Uses Supabase REST if CLOUD_CONFIG is set (for $0/mo Cloudflare Pages cloud deployment)
 * 2) Automatically uses local server `/api/rooms` when running `ruby server.rb` (supports phones via QR on Wi-Fi!)
 * 3) Always syncs via BroadcastChannel + localStorage for instant multi-tab updates
 */
export class GroupGameService {
  constructor() {
    this.mode = 'local'; // 'supabase' | 'api' | 'local'
    this.serverOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    this.lanJoinOrigin = this.serverOrigin;
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ffd_group_sync') : null;
    this.pollTimer = null;
    this.activeSubscriptionCode = null;
    this.onRoomUpdate = null;

    if (this.channel) {
      this.channel.addEventListener('message', (ev) => {
        if (ev.data?.type === 'room_updated' && ev.data?.room?.code === this.activeSubscriptionCode) {
          this.onRoomUpdate?.(ev.data.room);
        }
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (ev) => {
        if (ev.key === LOCAL_ROOMS_KEY && this.activeSubscriptionCode) {
          const rooms = this.readLocalRooms();
          const r = rooms[this.activeSubscriptionCode];
          if (r) this.onRoomUpdate?.(r);
        }
      });
    }
  }

  async init() {
    if (CLOUD_CONFIG.supabaseUrl && CLOUD_CONFIG.supabaseAnonKey) {
      this.mode = 'supabase';
      return;
    }
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok) {
        const info = await res.json();
        this.mode = 'api';
        if (info.lanUrl) {
          this.lanJoinOrigin = info.lanUrl;
        }
      }
    } catch {
      this.mode = 'local';
    }
  }

  getJoinUrl(code) {
    const base =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? this.lanJoinOrigin
        : window.location.origin + window.location.pathname.replace(/\/index\.html$/, '');
    const cleanBase = base.replace(/\/$/, '');
    return `${cleanBase}/?group=${encodeURIComponent(code)}`;
  }

  readLocalRooms() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_ROOMS_KEY) || '{}');
      const now = Date.now();
      let changed = false;
      for (const [code, room] of Object.entries(parsed)) {
        if (!isRoomActive(room, now)) {
          delete parsed[code];
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(parsed));
      }
      return parsed;
    } catch {
      return {};
    }
  }

  writeLocalRoom(room) {
    const rooms = this.readLocalRooms();
    rooms[room.code] = room;
    try {
      localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(rooms));
    } catch {
      // Ignore storage quota
    }
    this.channel?.postMessage({ type: 'room_updated', room });
  }

  async supabaseRequest(path, options = {}) {
    const headers = {
      apikey: CLOUD_CONFIG.supabaseAnonKey,
      Authorization: `Bearer ${CLOUD_CONFIG.supabaseAnonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    };
    const res = await fetch(`${CLOUD_CONFIG.supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || 'Supabase request failed');
    }
    return res.json();
  }

  async fetchRoom(code) {
    const clean = normalizeCode(code);
    if (!clean) return null;

    if (this.mode === 'supabase') {
      const nowIso = new Date().toISOString();
      const rows = await this.supabaseRequest(
        `group_rooms?code=eq.${encodeURIComponent(clean)}&expires_at=gt.${encodeURIComponent(nowIso)}&select=*`
      );
      if (!rows.length) return null;
      return recomputeRoomScores(rows[0].state);
    }

    if (this.mode === 'api') {
      const res = await fetch(`/api/rooms/${encodeURIComponent(clean)}`, { cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Unable to check game room');
      const data = await res.json();
      return isRoomActive(data.room) ? recomputeRoomScores(data.room) : null;
    }

    const rooms = this.readLocalRooms();
    const room = rooms[clean] || null;
    return isRoomActive(room) ? recomputeRoomScores(room) : null;
  }

  async checkCodeAvailability(rawCode) {
    const code = normalizeCode(rawCode);
    if (code.length < 4 || code.length > 8) {
      return {
        available: false,
        reason: 'Use 4 to 8 letters or numbers (e.g. FACTS6 or K7M4P9).',
        suggestedCode: await this.generateUniqueCode()
      };
    }
    if (!isFamilyFriendlyText(code)) {
      return {
        available: false,
        reason: 'Please choose a family-friendly game code.',
        suggestedCode: await this.generateUniqueCode()
      };
    }

    const existing = await this.fetchRoom(code);
    if (existing && isRoomActive(existing)) {
      return {
        available: false,
        expiresAt: existing.expiresAt,
        reason: `Code "${code}" is currently active in another game (${formatTimeRemaining(existing.expiresAt)}).`,
        suggestedCode: await this.generateUniqueCode()
      };
    }

    return { available: true, code };
  }

  async generateUniqueCode() {
    const localCodes = new Set(Object.keys(this.readLocalRooms()));
    for (let i = 0; i < 12; i++) {
      const candidate = generateRandomCode(localCodes);
      const existing = await this.fetchRoom(candidate);
      if (!existing) return candidate;
      localCodes.add(candidate);
    }
    return generateRandomCode();
  }

  async createRoom({
    code,
    quizTitle,
    hostId,
    durationId = '1d',
    questionGuids = [],
    timePerQuestionSec = 20
  }) {
    const candidateCode = code ? normalizeCode(code) : await this.generateUniqueCode();
    const check = await this.checkCodeAvailability(candidateCode);
    if (!check.available) {
      const err = new Error(check.reason);
      err.suggestedCode = check.suggestedCode;
      throw err;
    }

    const cleanTitle = String(quizTitle || '').trim().slice(0, 60) || 'Fun Facts Showdown';
    if (!isFamilyFriendlyText(cleanTitle)) {
      throw new Error('Please choose a family-friendly quiz title.');
    }

    if (!Array.isArray(questionGuids) || questionGuids.length === 0) {
      throw new Error('Please select at least 1 question for your quiz.');
    }

    const durOpt = DURATION_OPTIONS.find((d) => d.id === durationId) || DURATION_OPTIONS[1];
    const timerSec = Math.max(5, Math.min(120, Number(timePerQuestionSec) || 20));
    const now = Date.now();

    const room = {
      code: check.code,
      quizTitle: cleanTitle,
      hostId,
      durationId: durOpt.id,
      durationLabel: durOpt.label,
      createdAt: now,
      expiresAt: now + durOpt.ms,
      questionGuids,
      timePerQuestionSec: timerSec,
      phase: 'lobby',
      currentQuestionIndex: 0,
      questionStartedAt: null,
      questionDeadlineAt: null,
      paused: false,
      pausedRemainingMs: null,
      players: {},
      updatedAt: now
    };

    return this.persistRoom(room, true);
  }

  async persistRoom(room, isCreate = false) {
    recomputeRoomScores(room);
    room.updatedAt = Date.now();

    if (this.mode === 'supabase') {
      if (!isCreate && !room.terminated) {
        const latest = await this.fetchRoom(room.code).catch(() => null);
        if (latest && latest.players) {
          if (room._lastUpdateRole === 'player') {
            room.phase = latest.phase;
            room.currentQuestionIndex = latest.currentQuestionIndex;
            room.questionStartedAt = latest.questionStartedAt;
            room.questionDeadlineAt = latest.questionDeadlineAt;
            room.paused = latest.paused;
            room.pausedRemainingMs = latest.pausedRemainingMs;
          }
          for (const [pid, lp] of Object.entries(latest.players)) {
            if (!room.players[pid]) {
              room.players[pid] = lp;
            } else {
              room.players[pid].answers = { ...(lp.answers || {}), ...(room.players[pid].answers || {}) };
            }
          }
          recomputeRoomScores(room);
        }
      }
      await this.supabaseRequest('group_rooms', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          code: room.code,
          expires_at: new Date(room.expiresAt).toISOString(),
          state: room,
          updated_at: new Date(room.updatedAt).toISOString()
        })
      });
      this.writeLocalRoom(room);
      return room;
    }

    if (this.mode === 'api') {
      const res = await fetch(`/api/rooms/${encodeURIComponent(room.code)}`, {
        method: isCreate ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room })
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const err = new Error(errBody.error || 'Could not save room state');
        err.suggestedCode = errBody.suggestedCode;
        throw err;
      }
      const data = await res.json();
      const saved = recomputeRoomScores(data.room || room);
      this.writeLocalRoom(saved);
      return saved;
    }

    this.writeLocalRoom(room);
    return room;
  }

  async joinRoom({ code, playerId, name, avatarId }) {
    const cleanCode = normalizeCode(code);
    const cleanName = String(name || '').trim().slice(0, 22);
    if (!cleanName || !isFamilyFriendlyText(cleanName)) {
      throw new Error('Please enter a family-friendly name (1–22 characters).');
    }

    const room = await this.fetchRoom(cleanCode);
    if (!room || !isRoomActive(room)) {
      throw new Error(`Invite code "${cleanCode}" was not found or has expired.`);
    }

    const existingPlayer = room.players[playerId];
    room.players[playerId] = {
      id: playerId,
      name: cleanName,
      avatarId: avatarId || 'fox',
      score: existingPlayer ? existingPlayer.score : 0,
      correctCount: existingPlayer ? existingPlayer.correctCount : 0,
      firstBonuses: existingPlayer ? existingPlayer.firstBonuses : 0,
      secondBonuses: existingPlayer ? existingPlayer.secondBonuses : 0,
      joinedAt: existingPlayer ? existingPlayer.joinedAt : Date.now(),
      answers: existingPlayer ? existingPlayer.answers : {}
    };
    room._lastUpdateRole = 'player';

    return this.persistRoom(room);
  }

  async submitPlayerAnswer({ code, playerId, questionIndex, selectedIndex, correctIndex }) {
    const room = await this.fetchRoom(code);
    if (!room || !isRoomActive(room)) {
      throw new Error('This game room has expired.');
    }
    if (room.phase !== 'question') {
      return room;
    }
    if (room.paused) {
      throw new Error('The game is currently paused by the game creator.');
    }

    const player = room.players[playerId];
    if (!player) {
      throw new Error('Player session not found in this room.');
    }

    const qKey = String(questionIndex);
    if (player.answers[qKey]) {
      return room; // Already locked in
    }

    player.answers[qKey] = {
      selectedIndex,
      correct: selectedIndex === correctIndex,
      answeredAt: Date.now()
    };
    room._lastUpdateRole = 'player';

    return this.persistRoom(room);
  }

  async updateHostPhase({ code, hostId, phase, currentQuestionIndex }) {
    const room = await this.fetchRoom(code);
    if (!room || room.hostId !== hostId) {
      throw new Error('Only the game creator can control this game.');
    }
    if (typeof currentQuestionIndex === 'number') {
      room.currentQuestionIndex = currentQuestionIndex;
    }
    room.phase = phase;
    room.paused = false;
    room.pausedRemainingMs = null;
    room._lastUpdateRole = 'host';

    if (phase === 'question') {
      const now = Date.now();
      room.questionStartedAt = now;
      room.questionDeadlineAt = now + (Number(room.timePerQuestionSec) || 20) * 1000;
    } else {
      room.questionDeadlineAt = null;
    }

    return this.persistRoom(room);
  }

  async togglePauseRoom({ code, hostId }) {
    const room = await this.fetchRoom(code);
    if (!room || room.hostId !== hostId) {
      throw new Error('Only the game creator can pause or resume this game.');
    }
    if (room.phase !== 'question') return room;

    const now = Date.now();
    if (!room.paused) {
      const rem = Math.max(1000, (Number(room.questionDeadlineAt) || now + 5000) - now);
      room.paused = true;
      room.pausedRemainingMs = rem;
    } else {
      const rem = Math.max(1000, Number(room.pausedRemainingMs) || (Number(room.timePerQuestionSec) || 20) * 1000);
      room.paused = false;
      room.pausedRemainingMs = null;
      room.questionDeadlineAt = now + rem;
    }
    room._lastUpdateRole = 'host';

    return this.persistRoom(room);
  }

  async closeRoom({ code, hostId }) {
    const room = await this.fetchRoom(code);
    if (!room || room.hostId !== hostId) return;
    room.terminated = true;
    room.expiresAt = Date.now() - 1000;
    room._lastUpdateRole = 'host';
    await this.persistRoom(room);
  }

  subscribe(code, callback) {
    this.unsubscribe();
    this.activeSubscriptionCode = normalizeCode(code);
    this.onRoomUpdate = callback;

    const poll = async () => {
      if (!this.activeSubscriptionCode) return;
      try {
        const room = await this.fetchRoom(this.activeSubscriptionCode);
        if (room) {
          this.onRoomUpdate?.(room);
        }
      } catch {
        // Ignore transient network hiccup
      }
    };

    this.pollTimer = setInterval(poll, 800);
  }

  unsubscribe() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.activeSubscriptionCode = null;
    this.onRoomUpdate = null;
  }
}
