import { SHOW_CONFIG } from './config.js';

const activePlayers = new Set();
const SPEED_STEPS = [1, 1.25, 1.5];

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatPubDate(pubDateStr) {
  if (!pubDateStr) return '';
  const d = new Date(pubDateStr);
  if (Number.isNaN(d.getTime())) return pubDateStr;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export class MemphisPodcastPlayer {
  constructor(
    container,
    {
      compact = false,
      preload = 'metadata',
      onPlayEpisode = null,
      onAppleClick = null,
      onTrackEnded = null,
      onToggleFavorite = null,
      isFavoriteCheck = null
    } = {}
  ) {
    this.container = container;
    this.compact = compact;
    this.preload = preload;
    this.onPlayEpisode = onPlayEpisode;
    this.onAppleClick = onAppleClick;
    this.onTrackEnded = onTrackEnded;
    this.onToggleFavorite = onToggleFavorite;
    this.isFavoriteCheck = isFavoriteCheck;

    this.episode = null;
    this.cueSeconds = 0;
    this.pendingSeek = null;
    this.isDraggingSeek = false;
    this.lastVolume = 0.85;
    this.speedIndex = 0;
    this.queueLabel = '';

    this.audio = new Audio();
    this.audio.preload = preload;
    this.audio.volume = this.lastVolume;

    activePlayers.add(this);
    this.renderShell();
    this.bindEvents();
  }

  renderShell() {
    this.container.innerHTML = `
      <div class="memphis-player ${this.compact ? 'memphis-player--archive' : 'memphis-player--hero'}">
        <div class="mp-main-layout">
          <div class="mp-artwork-wrap">
            <img class="mp-artwork" src="${SHOW_CONFIG.defaultArtwork}" alt="Episode cover art" loading="lazy" />
            <div class="mp-on-air-pill" hidden>
              <span class="mp-eq-bars" aria-hidden="true"><i></i><i></i><i></i></span>
              <span>PLAYING</span>
            </div>
          </div>

          <div class="mp-body">
            <div class="mp-meta-row">
              <span class="mp-ep-date"></span>
              <div class="mp-meta-badges">
                <span class="mp-queue-badge" hidden></span>
                <span class="mp-cue-badge" hidden></span>
                <button type="button" class="mp-fav-btn" data-action="toggle-fav" title="Save to Favorites" aria-label="Toggle favorite episode">
                  🤍
                </button>
              </div>
            </div>
            <h3 class="mp-title">Loading episode…</h3>

            <div class="mp-cue-actions" hidden>
              <button type="button" class="mp-chip-btn mp-chip-btn--primary" data-action="jump-cue">
                🎯 Play Answer Clip (<span data-role="cue-label">0:00</span>)
              </button>
              <button type="button" class="mp-chip-btn" data-action="restart">
                ↺ Start from 0:00
              </button>
            </div>

            <div class="mp-scrubber-wrap">
              <input
                type="range"
                class="mp-seek-slider"
                min="0"
                max="1000"
                value="0"
                aria-label="Episode playback position"
              />
              <div class="mp-time-row">
                <span data-role="current-time">0:00</span>
                <span data-role="total-time">0:00</span>
              </div>
            </div>

            <div class="mp-controls-row">
              <div class="mp-transport">
                <button type="button" class="mp-btn mp-btn--skip" data-action="back-30" title="Back 30 seconds" aria-label="Rewind 30 seconds">
                  ↺ 30s
                </button>
                <button type="button" class="mp-btn mp-btn--play" data-action="toggle-play" aria-label="Play episode">
                  <span data-role="play-icon">▶</span>
                  <span data-role="play-label">Play</span>
                </button>
                <button type="button" class="mp-btn mp-btn--skip" data-action="fwd-30" title="Skip ahead 30 seconds" aria-label="Skip forward 30 seconds">
                  30s ↻
                </button>
                <button type="button" class="mp-btn mp-btn--speed" data-action="cycle-speed" title="Playback speed" aria-label="Change playback speed">
                  1x
                </button>
              </div>

              <div class="mp-volume-group">
                <button type="button" class="mp-btn mp-btn--mute" data-action="toggle-mute" title="Mute or unmute" aria-label="Toggle mute">
                  🔊
                </button>
                <input
                  type="range"
                  class="mp-volume-slider"
                  min="0"
                  max="100"
                  value="85"
                  aria-label="Volume"
                />
              </div>
            </div>

            <div class="mp-status-msg" hidden></div>

            <div class="mp-apple-bar">
              <a
                class="mp-apple-btn"
                data-role="apple-link"
                href="${SHOW_CONFIG.appleShowUrl}"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="mp-apple-icon" aria-hidden="true">🎙️</span>
                <span>Open &amp; Follow on <strong>Apple Podcasts</strong></span>
                <span aria-hidden="true">↗</span>
              </a>
              <a
                class="mp-review-link"
                data-role="review-link"
                href="${SHOW_CONFIG.appleReviewUrl}"
                target="_blank"
                rel="noopener noreferrer"
              >
                ★ Rate 5 Stars
              </a>
            </div>
          </div>
        </div>
      </div>
    `;

    this.els = {
      root: this.container.querySelector('.memphis-player'),
      artwork: this.container.querySelector('.mp-artwork'),
      onAir: this.container.querySelector('.mp-on-air-pill'),
      epDate: this.container.querySelector('.mp-ep-date'),
      queueBadge: this.container.querySelector('.mp-queue-badge'),
      cueBadge: this.container.querySelector('.mp-cue-badge'),
      favBtn: this.container.querySelector('[data-action="toggle-fav"]'),
      title: this.container.querySelector('.mp-title'),
      cueActions: this.container.querySelector('.mp-cue-actions'),
      cueLabel: this.container.querySelector('[data-role="cue-label"]'),
      seekSlider: this.container.querySelector('.mp-seek-slider'),
      currentTime: this.container.querySelector('[data-role="current-time"]'),
      totalTime: this.container.querySelector('[data-role="total-time"]'),
      playBtn: this.container.querySelector('[data-action="toggle-play"]'),
      playIcon: this.container.querySelector('[data-role="play-icon"]'),
      playLabel: this.container.querySelector('[data-role="play-label"]'),
      backBtn: this.container.querySelector('[data-action="back-30"]'),
      fwdBtn: this.container.querySelector('[data-action="fwd-30"]'),
      speedBtn: this.container.querySelector('[data-action="cycle-speed"]'),
      muteBtn: this.container.querySelector('[data-action="toggle-mute"]'),
      volSlider: this.container.querySelector('.mp-volume-slider'),
      statusMsg: this.container.querySelector('.mp-status-msg'),
      appleLink: this.container.querySelector('[data-role="apple-link"]'),
      reviewLink: this.container.querySelector('[data-role="review-link"]'),
      jumpCueBtn: this.container.querySelector('[data-action="jump-cue"]'),
      restartBtn: this.container.querySelector('[data-action="restart"]')
    };
  }

  bindEvents() {
    this.els.artwork.addEventListener('error', () => {
      if (this.els.artwork.src !== SHOW_CONFIG.defaultArtwork) {
        this.els.artwork.src = SHOW_CONFIG.defaultArtwork;
      }
    });

    this.els.playBtn.addEventListener('click', () => this.togglePlay());
    this.els.backBtn.addEventListener('click', () => this.skip(-30));
    this.els.fwdBtn.addEventListener('click', () => this.skip(30));
    this.els.muteBtn.addEventListener('click', () => this.toggleMute());

    this.els.speedBtn.addEventListener('click', () => {
      this.speedIndex = (this.speedIndex + 1) % SPEED_STEPS.length;
      const rate = SPEED_STEPS[this.speedIndex];
      this.audio.playbackRate = rate;
      this.els.speedBtn.textContent = `${rate}x`;
    });

    this.els.favBtn.addEventListener('click', () => {
      if (this.episode && typeof this.onToggleFavorite === 'function') {
        this.onToggleFavorite(this.episode);
        this.refreshFavoriteUi();
      }
    });

    this.els.jumpCueBtn.addEventListener('click', () => {
      this.cueTo(this.cueSeconds, true);
    });
    this.els.restartBtn.addEventListener('click', () => {
      this.cueTo(0, true);
    });

    this.els.volSlider.addEventListener('input', () => {
      const val = Number(this.els.volSlider.value) / 100;
      this.audio.volume = val;
      this.audio.muted = val === 0;
      if (val > 0) this.lastVolume = val;
      this.updateVolumeUi();
    });

    this.els.seekSlider.addEventListener('input', () => {
      this.isDraggingSeek = true;
      const dur = this.getEffectiveDuration();
      if (dur > 0) {
        const previewSec = (Number(this.els.seekSlider.value) / 1000) * dur;
        this.els.currentTime.textContent = formatTime(previewSec);
      }
    });

    this.els.seekSlider.addEventListener('change', () => {
      const dur = this.getEffectiveDuration();
      if (dur > 0) {
        const targetSec = (Number(this.els.seekSlider.value) / 1000) * dur;
        this.seekTo(targetSec);
      }
      this.isDraggingSeek = false;
    });

    const handleApple = () => {
      if (typeof this.onAppleClick === 'function') {
        this.onAppleClick(this.episode);
      }
    };
    this.els.appleLink.addEventListener('click', handleApple);
    this.els.reviewLink.addEventListener('click', handleApple);

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek !== null) {
        const target = Math.min(this.pendingSeek, Math.max(0, (this.audio.duration || 0) - 3));
        try {
          this.audio.currentTime = target;
        } catch {
          // Will apply on canplay if browser defers seek
        }
        this.pendingSeek = null;
      }
      this.audio.playbackRate = SPEED_STEPS[this.speedIndex];
      this.updateTimeUi();
    });

    this.audio.addEventListener('canplay', () => {
      if (this.pendingSeek !== null) {
        try {
          this.audio.currentTime = this.pendingSeek;
          this.pendingSeek = null;
        } catch {
          // Ignore
        }
      }
      this.hideStatus();
    });

    this.audio.addEventListener('timeupdate', () => {
      if (!this.isDraggingSeek) {
        this.updateTimeUi();
      }
    });

    this.audio.addEventListener('play', () => {
      for (const other of activePlayers) {
        if (other !== this && !other.audio.paused) {
          other.audio.pause();
        }
      }
      this.audio.playbackRate = SPEED_STEPS[this.speedIndex];
      this.els.playIcon.textContent = '⏸';
      this.els.playLabel.textContent = 'Pause';
      this.els.onAir.hidden = false;
      this.els.root.classList.add('is-playing');
      this.hideStatus();
      this.syncMediaSession();

      if (typeof this.onPlayEpisode === 'function' && this.episode) {
        this.onPlayEpisode(this.episode);
      }
    });

    this.audio.addEventListener('pause', () => {
      this.els.playIcon.textContent = '▶';
      this.els.playLabel.textContent = 'Play';
      this.els.onAir.hidden = true;
      this.els.root.classList.remove('is-playing');
    });

    this.audio.addEventListener('ended', () => {
      this.els.playIcon.textContent = '▶';
      this.els.playLabel.textContent = 'Replay';
      this.els.onAir.hidden = true;
      this.els.root.classList.remove('is-playing');
      if (typeof this.onTrackEnded === 'function') {
        this.onTrackEnded(this.episode);
      }
    });

    this.audio.addEventListener('waiting', () => {
      this.showStatus('Buffering episode audio…');
    });

    this.audio.addEventListener('error', () => {
      this.showStatus(
        'Audio stream unavailable offline — click "Open & Follow on Apple Podcasts" below to listen directly!'
      );
    });
  }

  syncMediaSession() {
    if (!('mediaSession' in navigator) || !this.episode) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.episode.title,
        artist: `${SHOW_CONFIG.title} • ${SHOW_CONFIG.host}`,
        album: this.queueLabel || SHOW_CONFIG.title,
        artwork: [
          {
            src: this.episode.artworkUrl || SHOW_CONFIG.defaultArtwork,
            sizes: '600x600',
            type: 'image/png'
          }
        ]
      });
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.audio.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => this.skip(-30));
      navigator.mediaSession.setActionHandler('seekforward', () => this.skip(30));
      navigator.mediaSession.setActionHandler(
        'nexttrack',
        typeof this.onTrackEnded === 'function' ? () => this.onTrackEnded(this.episode) : null
      );
    } catch {
      // Ignore unsupported mediaSession handlers on older browsers
    }
  }

  refreshFavoriteUi() {
    for (const p of activePlayers) {
      if (!p.episode || typeof p.isFavoriteCheck !== 'function') continue;
      const fav = p.isFavoriteCheck(p.episode.guid);
      p.els.favBtn.textContent = fav ? '❤️' : '🤍';
      p.els.favBtn.title = fav ? 'Remove from Favorites' : 'Save to Favorites';
    }
  }

  loadEpisode(episode, { cueSeconds = 0, autoPlay = false, queueLabel = '' } = {}) {
    if (!episode) return;
    this.episode = episode;
    this.cueSeconds = Math.max(0, Number(cueSeconds) || 0);
    this.queueLabel = queueLabel;

    this.audio.pause();
    this.audio.src = episode.audioUrl || '';
    this.pendingSeek = this.cueSeconds > 0 ? this.cueSeconds : null;

    this.els.artwork.src = episode.artworkUrl || SHOW_CONFIG.defaultArtwork;
    this.els.artwork.alt = `Cover art for ${episode.title}`;
    this.els.title.textContent = episode.title;
    this.els.epDate.textContent = formatPubDate(episode.pubDate);
    this.els.appleLink.href = episode.appleUrl || SHOW_CONFIG.appleShowUrl;
    this.hideStatus();
    this.refreshFavoriteUi();

    if (queueLabel) {
      this.els.queueBadge.hidden = false;
      this.els.queueBadge.textContent = queueLabel;
    } else {
      this.els.queueBadge.hidden = true;
    }

    const dur = this.getEffectiveDuration();
    this.els.totalTime.textContent = formatTime(dur);
    this.els.currentTime.textContent = formatTime(this.cueSeconds);
    this.els.seekSlider.value = dur > 0 ? Math.round((this.cueSeconds / dur) * 1000) : 0;

    if (this.cueSeconds > 0) {
      this.els.cueBadge.hidden = false;
      this.els.cueBadge.textContent = `Cued to ${formatTime(this.cueSeconds)}`;
      this.els.cueActions.hidden = false;
      this.els.cueLabel.textContent = formatTime(this.cueSeconds);
    } else {
      this.els.cueBadge.hidden = true;
      this.els.cueActions.hidden = true;
    }

    if (autoPlay) {
      this.play();
    }
  }

  cueTo(seconds, autoPlay = false) {
    const target = Math.max(0, Number(seconds) || 0);
    this.seekTo(target);
    if (autoPlay) {
      this.play();
    }
  }

  seekTo(seconds) {
    const dur = this.getEffectiveDuration();
    const clamped =
      dur > 0 ? Math.min(Math.max(0, seconds), Math.max(0, dur - 1)) : Math.max(0, seconds);
    if (this.audio.readyState >= 1) {
      this.audio.currentTime = clamped;
      this.pendingSeek = null;
    } else {
      this.pendingSeek = clamped;
    }
    this.els.currentTime.textContent = formatTime(clamped);
    if (dur > 0) {
      this.els.seekSlider.value = Math.round((clamped / dur) * 1000);
    }
  }

  skip(deltaSec) {
    const base =
      this.audio.readyState >= 1
        ? this.audio.currentTime
        : this.pendingSeek !== null
          ? this.pendingSeek
          : 0;
    this.seekTo(base + deltaSec);
  }

  play() {
    this.hideStatus();
    const playPromise = this.audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        this.showStatus('Tap Play to start streaming from Megaphone, or open in Apple Podcasts below.');
      });
    }
  }

  togglePlay() {
    if (this.audio.paused) {
      this.play();
    } else {
      this.audio.pause();
    }
  }

  toggleMute() {
    if (this.audio.muted || this.audio.volume === 0) {
      this.audio.muted = false;
      this.audio.volume = this.lastVolume > 0 ? this.lastVolume : 0.85;
    } else {
      this.lastVolume = this.audio.volume;
      this.audio.muted = true;
    }
    this.updateVolumeUi();
  }

  updateVolumeUi() {
    const effective = this.audio.muted ? 0 : Math.round(this.audio.volume * 100);
    this.els.volSlider.value = String(effective);
    if (effective === 0) {
      this.els.muteBtn.textContent = '🔇';
    } else if (effective < 50) {
      this.els.muteBtn.textContent = '🔉';
    } else {
      this.els.muteBtn.textContent = '🔊';
    }
  }

  getEffectiveDuration() {
    if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
      return this.audio.duration;
    }
    return Number(this.episode?.durationSec) || 0;
  }

  updateTimeUi() {
    const dur = this.getEffectiveDuration();
    const cur =
      this.audio.readyState >= 1
        ? this.audio.currentTime
        : this.pendingSeek !== null
          ? this.pendingSeek
          : 0;
    this.els.currentTime.textContent = formatTime(cur);
    this.els.totalTime.textContent = formatTime(dur);
    if (dur > 0) {
      this.els.seekSlider.value = Math.min(1000, Math.round((cur / dur) * 1000));
    }
  }

  showStatus(text) {
    this.els.statusMsg.textContent = text;
    this.els.statusMsg.hidden = false;
  }

  hideStatus() {
    this.els.statusMsg.hidden = true;
  }
}
