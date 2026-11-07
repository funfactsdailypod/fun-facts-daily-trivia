import { CLOUD_CONFIG, SHOW_CONFIG, isFamilyFriendlyText } from './config.js';

const LOCAL_ROOMS_KEY = 'ffd_trivia_group_rooms_v1';
const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const DURATION_OPTIONS = [
  { id: '1h', label: '1 Hour', ms: 60 * 60 * 1000, hint: 'Best for live parties & classrooms' },
  { id: '1d', label: '1 Day', ms: 24 * 60 * 60 * 1000, hint: 'Great for daily group challenges' },
  { id: '1w', label: '1 Week', ms: 7 * 24 * 60 * 60 * 1000, hint: 'Ideal for classrooms & listeners all week' }
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
 * Unified Group Room Client:
 * 1) Uses Supabase REST/Realtime if CLOUD_CONFIG is set (for $0/mo Cloudflare Pages cloud deployment)
 * 2) Automatically uses local server `/api/rooms` when running `ruby server.rb` (supports phones via QR on Wi-Fi!)
 * 3) Always syncs via BroadcastChannel + localStorage for instant multi-tab updates
 */
export class GroupGameService {
  constructor() {
    this.mode = 'local'; // 'supabase' | 'api' | 'local'
    this.serverOrigin = window.location.origin;
    this.lanJoinOrigin = window.location.origin;
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
    window.addEventListener('storage', (ev) => {
      if (ev.key === LOCAL_ROOMS_KEY && this.activeSubscriptionCode) {
        const rooms = this.readLocalRooms();
        const r = rooms[this.activeSubscriptionCode];
        if (r) this.onRoomUpdate?.(r);
      }
    });
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

  // --- Storage Helpers ---
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
      return rows[0].state;
    }

    if (this.mode === 'api') {
      const res = await fetch(`/api/rooms/${encodeURIComponent(clean)}`, { cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Unable to check game room');
      const data = await res.json();
      return isRoomActive(data.room) ? data.room : null;
    }

    const rooms = this.readLocalRooms();
    const room = rooms[clean] || null;
    return isRoomActive(room) ? room : null;
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

  async createRoom({ code, hostId, pacingMode, durationId, categories, questionGuids, speedTimer }) {
    const check = await this.checkCodeAvailability(code);
    if (!check.available) {
      const err = new Error(check.reason);
      err.suggestedCode = check.suggestedCode;
      throw err;
    }

    const durOpt = DURATION_OPTIONS.find((d) => d.id === durationId) || DURATION_OPTIONS[0];
    const now = Date.now();
    const room = {
      code: check.code,
      hostId,
      pacingMode: pacingMode === 'self_paced' ? 'self_paced' : 'live',
      durationId: durOpt.id,
      durationLabel: durOpt.label,
      createdAt: now,
      expiresAt: now + durOpt.ms,
      categories,
      questionGuids,
      speedTimer: Boolean(speedTimer),
      phase: pacingMode === 'self_paced' ? 'self_paced' : 'lobby',
      currentQuestionIndex: 0,
      questionStartedAt: null,
      players: {}, // { [playerId]: { id, name, avatarId, score, streak, answers: { [qIdx]: { selectedIndex, correct, points, answeredAt } } } }
      updatedAt: now
    };

    await this.persistRoom(room, true);
    return room;
  }

  async persistRoom(room, isCreate = false) {
    room.updatedAt = Date.now();
    if (this.mode === 'supabase') {
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
    } else if (this.mode === 'api') {
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
    }
    this.writeLocalRoom(room);
    return room;
  }

  async joinRoom({ code, playerId, name, avatarId }) {
    const cleanCode = normalizeCode(code);
    const cleanName = String(name || '').trim().slice(0, 22);
    if (!cleanName || !isFamilyFriendlyText(cleanName)) {
      throw new Error('Please enter a family-friendly display name (1–22 characters).');
    }

    const room = await this.fetchRoom(cleanCode);
    if (!room || !isRoomActive(room)) {
      throw new Error(`Game code "${cleanCode}" was not found or has expired.`);
    }

    const existingPlayer = room.players[playerId];
    room.players[playerId] = {
      id: playerId,
      name: cleanName,
      avatarId: avatarId || 'fox',
      score: existingPlayer ? existingPlayer.score : 0,
      streak: existingPlayer ? existingPlayer.streak : 0,
      joinedAt: existingPlayer ? existingPlayer.joinedAt : Date.now(),
      answers: existingPlayer ? existingPlayer.answers : {}
    };

    await this.persistRoom(room);
    return room;
  }

  async submitPlayerAnswer({ code, playerId, questionIndex, selectedIndex, correctIndex }) {
    const room = await this.fetchRoom(code);
    if (!room || !isRoomActive(room)) {
      throw new Error('This game room has expired.');
    }
    const player = room.players[playerId];
    if (!player) {
      throw new Error('Player session not found in this room.');
    }
    if (player.answers[questionIndex]) {
      return room; // Already locked in
    }

    const correct = selectedIndex === correctIndex;
    let points = 0;
    if (correct) {
      points = SHOW_CONFIG.points.groupBase;
      if (room.pacingMode === 'live' && room.speedTimer && room.questionStartedAt) {
        const elapsedSec = Math.max(0, (Date.now() - room.questionStartedAt) / 1000);
        const speedRatio = Math.max(0, 1 - elapsedSec / 25);
        points += Math.round(speedRatio * SHOW_CONFIG.points.groupSpeedBonusMax);
      }
      player.streak = (player.streak || 0) + 1;
    } else {
      player.streak = 0;
    }

    player.score = (player.score || 0) + points;
    player.answers[questionIndex] = {
      selectedIndex,
      correct,
      points,
      answeredAt: Date.now()
    };

    await this.persistRoom(room);
    return room;
  }

  async updateHostPhase({ code, hostId, phase, currentQuestionIndex }) {
    const room = await this.fetchRoom(code);
    if (!room || room.hostId !== hostId) {
      throw new Error('Only the game host can advance this game.');
    }
    if (typeof currentQuestionIndex === 'number') {
      room.currentQuestionIndex = currentQuestionIndex;
    }
    room.phase = phase;
    if (phase === 'question') {
      room.questionStartedAt = Date.now();
    }
    await this.persistRoom(room);
    return room;
  }

  async closeRoom({ code, hostId }) {
    const room = await this.fetchRoom(code);
    if (!room || room.hostId !== hostId) return;
    room.terminated = true;
    room.expiresAt = Date.now() - 1000;
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

    this.pollTimer = setInterval(poll, 1200);
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
