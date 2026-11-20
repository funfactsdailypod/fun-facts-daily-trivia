import { CATEGORIES } from './config.js';
import { formatPubDate, formatTime } from './audio-player.js';
import {
  applyEpisodeOverride,
  deleteGlobalOverride,
  fetchGlobalOverrides,
  saveGlobalOverride
} from './storage.js';

// SHA-256 hash of Kyle's strong administrator password (so plaintext password is never exposed in source)
const ADMIN_PASSWORD_SHA256 = '1e8bf783bdaf288a42ec5ac403f96d0e55c67257cbdb0af1c3be9c9d3711bebd';
const SESSION_STORAGE_KEY = 'ffd_admin_authenticated_v1';

const adminState = {
  rawEpisodes: [],
  episodes: [],
  overrides: {},
  selectedGuid: '',
  slot: 'main', // 'main' | 'vault'
  selectedFields: new Set()
};

/**
 * Pure-JS SHA-256 fallback in case page is opened over plain HTTP LAN IP where crypto.subtle is unavailable.
 */
function sha256HexPureJs(ascii) {
  const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';

  const words = [];
  const asciiBitLength = ascii.length * 8;

  let hash = [];
  const k = [];
  let primeCounter = 0;

  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii.length % 64) - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? 0 : '') + b.toString(16);
    }
  }
  return result;
}

async function computeSha256Hex(text) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const buf = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fallback to pure JS
    }
  }
  return sha256HexPureJs(text);
}

function getSelectedEpisode() {
  return adminState.episodes.find((e) => e.guid === adminState.selectedGuid) || adminState.episodes[0] || null;
}

function getActiveQuestionObject(ep) {
  if (!ep) return null;
  if (adminState.slot === 'vault') {
    return (
      ep.vaultBonus || {
        cueSeconds: 300,
        question: ep.question,
        options: [...(ep.options || ['', '', '', ''])],
        correctIndex: ep.correctIndex || 0,
        explanation: ep.explanation || ''
      }
    );
  }
  return ep;
}

function rebuildEpisodesWithOverrides() {
  adminState.episodes = adminState.rawEpisodes.map((raw) =>
    applyEpisodeOverride(
      JSON.parse(JSON.stringify(raw)),
      adminState.overrides[raw.guid]
    )
  );
}

function populateCategoryDropdown() {
  const sel = document.getElementById('input-edit-category');
  sel.innerHTML = CATEGORIES.filter((c) => c.id !== 'ALL')
    .map((c) => `<option value="${c.id}">${c.icon} ${c.label}</option>`)
    .join('');
}

function populateEpisodeSelect(filterQuery = '') {
  const q = String(filterQuery || '').toLowerCase().trim();
  const sel = document.getElementById('admin-ep-select');
  const filtered = adminState.episodes.filter(
    (ep) =>
      !q ||
      ep.title.toLowerCase().includes(q) ||
      ep.question.toLowerCase().includes(q) ||
      (ep.category || '').toLowerCase().includes(q)
  );

  document.getElementById('admin-ep-count').textContent = String(filtered.length);

  sel.innerHTML = filtered
    .map((ep, idx) => {
      const isLatest = ep.guid === adminState.episodes[0]?.guid;
      const hasEdit = Boolean(adminState.overrides[ep.guid]);
      const prefix = isLatest ? '⭐ [LATEST] ' : '';
      const suffix = hasEdit ? ' ✏️ (Edited)' : '';
      return `<option value="${ep.guid}">${prefix}${ep.title} (${formatPubDate(ep.pubDate)})${suffix}</option>`;
    })
    .join('');

  if (filtered.length > 0) {
    if (!filtered.some((e) => e.guid === adminState.selectedGuid)) {
      adminState.selectedGuid = filtered[0].guid;
    }
    sel.value = adminState.selectedGuid;
  }
}

function renderCurrentPreviewAndInputs(prefillInputs = true) {
  const ep = getSelectedEpisode();
  if (!ep) return;

  const qObj = getActiveQuestionObject(ep);
  const hasOverride = Boolean(adminState.overrides[ep.guid]);

  document.getElementById('preview-ep-meta').textContent = `${ep.title} • ${formatPubDate(ep.pubDate)} • Category: ${ep.category} • Audio Cue: ${formatTime(qObj.cueSeconds || 165)}`;
  document.getElementById('preview-override-badge').hidden = !hasOverride;
  document.getElementById('btn-revert-episode').hidden = !hasOverride;

  document.getElementById('preview-question-text').textContent = qObj.question || '';

  for (let i = 0; i < 4; i++) {
    const optText = qObj.options?.[i] || '';
    const isCorrect = Number(qObj.correctIndex) === i;
    document.getElementById(`preview-opt-${i}`).textContent = optText;
    document.getElementById(`preview-opt-card-${i}`).classList.toggle('is-correct', isCorrect);
    document.getElementById(`preview-correct-tag-${i}`).hidden = !isCorrect;
  }

  document.getElementById('preview-explanation-text').textContent = qObj.explanation || '';

  // Category pill only applies to main episode level
  document.getElementById('pill-wrap-category').hidden = adminState.slot === 'vault';
  if (adminState.slot === 'vault' && adminState.selectedFields.has('category')) {
    adminState.selectedFields.delete('category');
  }

  if (prefillInputs) {
    document.getElementById('input-edit-question').value = qObj.question || '';
    document.getElementById('input-edit-opt0').value = qObj.options?.[0] || '';
    document.getElementById('input-edit-opt1').value = qObj.options?.[1] || '';
    document.getElementById('input-edit-opt2').value = qObj.options?.[2] || '';
    document.getElementById('input-edit-opt3').value = qObj.options?.[3] || '';
    document.getElementById('input-edit-correctIndex').value = String(qObj.correctIndex ?? 0);
    document.getElementById('input-edit-explanation').value = qObj.explanation || '';
    document.getElementById('input-edit-category').value = ep.category || 'History';
    document.getElementById('input-edit-cueSeconds').value = String(qObj.cueSeconds || 165);
  }

  syncFieldSelectionUi();
}

function syncFieldSelectionUi() {
  const allFields = [
    'question',
    'opt0',
    'opt1',
    'opt2',
    'opt3',
    'correctIndex',
    'explanation',
    'category',
    'cueSeconds'
  ];

  for (const field of allFields) {
    const checked = adminState.selectedFields.has(field);
    const pill = document.querySelector(`[data-field-pill="${field}"]`);
    const chk = pill?.querySelector('input[type="checkbox"]');
    if (chk) chk.checked = checked;
    pill?.classList.toggle('is-checked', checked);

    const row = document.getElementById(`edit-row-${field}`);
    if (row) row.hidden = !checked;
  }

  const hasAny = adminState.selectedFields.size > 0;
  document.getElementById('no-fields-hint').hidden = hasAny;
  document.getElementById('edit-fields-container').hidden = !hasAny;
  document.getElementById('btn-finalize-changes').disabled = !hasAny;
}

function setStatusBanner(message, isError = false) {
  const el = document.getElementById('admin-save-status');
  el.textContent = message;
  el.className = `status-banner ${isError ? 'status-banner--err' : 'status-banner--ok'}`;
  el.hidden = false;
}

async function unlockEditor() {
  document.getElementById('admin-login-screen').hidden = true;
  document.getElementById('admin-editor-screen').hidden = false;
  document.getElementById('admin-top-actions').hidden = false;

  const [res, overrides] = await Promise.all([
    fetch('./data/questions.json', { cache: 'no-store' }),
    fetchGlobalOverrides().catch(() => ({}))
  ]);
  adminState.rawEpisodes = await res.json();
  adminState.overrides = overrides || {};
  rebuildEpisodesWithOverrides();

  populateCategoryDropdown();
  adminState.selectedGuid = adminState.episodes[0]?.guid || '';
  populateEpisodeSelect('');
  renderCurrentPreviewAndInputs(true);
}

function bindAdminEvents() {
  // Password visibility toggle
  document.getElementById('btn-toggle-pw-vis').addEventListener('click', () => {
    const inp = document.getElementById('admin-password-input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Login form submission
  document.getElementById('admin-login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errEl = document.getElementById('admin-login-error');
    errEl.hidden = true;

    const rawPw = document.getElementById('admin-password-input').value.trim();
    const digest = await computeSha256Hex(rawPw);

    if (digest !== ADMIN_PASSWORD_SHA256) {
      errEl.textContent = 'Incorrect login password. Please check your saved ADMIN_LOGIN_CREDENTIALS.txt file.';
      errEl.hidden = false;
      return;
    }

    if (document.getElementById('admin-remember-chk').checked) {
      localStorage.setItem(SESSION_STORAGE_KEY, ADMIN_PASSWORD_SHA256);
    } else {
      sessionStorage.setItem(SESSION_STORAGE_KEY, ADMIN_PASSWORD_SHA256);
    }

    await unlockEditor();
  });

  // Lock / Logout button
  document.getElementById('btn-admin-logout').addEventListener('click', () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    document.getElementById('admin-password-input').value = '';
    document.getElementById('admin-editor-screen').hidden = true;
    document.getElementById('admin-top-actions').hidden = true;
    document.getElementById('admin-login-screen').hidden = false;
  });

  // Episode search & dropdown
  document.getElementById('admin-ep-search').addEventListener('input', (ev) => {
    populateEpisodeSelect(ev.target.value);
    renderCurrentPreviewAndInputs(true);
    document.getElementById('admin-save-status').hidden = true;
  });

  document.getElementById('admin-ep-select').addEventListener('change', (ev) => {
    adminState.selectedGuid = ev.target.value;
    renderCurrentPreviewAndInputs(true);
    document.getElementById('admin-save-status').hidden = true;
  });

  // Slot toggle (Main Question vs Weekend Vault Bonus)
  document.querySelectorAll('#slot-toggle-pills [data-slot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      adminState.slot = btn.dataset.slot;
      document.querySelectorAll('#slot-toggle-pills [data-slot]').forEach((b) =>
        b.classList.toggle('is-active', b.dataset.slot === adminState.slot)
      );
      renderCurrentPreviewAndInputs(true);
      document.getElementById('admin-save-status').hidden = true;
    });
  });

  // Field checkboxes
  document.querySelectorAll('.field-toggle-chk').forEach((chk) => {
    chk.addEventListener('change', () => {
      if (chk.checked) {
        adminState.selectedFields.add(chk.value);
      } else {
        adminState.selectedFields.delete(chk.value);
      }
      syncFieldSelectionUi();
    });
  });

  // Clicking on any preview card item checks its field box and focuses its input
  document.querySelectorAll('[data-toggle-field]').forEach((box) => {
    box.addEventListener('click', () => {
      const field = box.dataset.toggleField;
      adminState.selectedFields.add(field);
      syncFieldSelectionUi();
      document.getElementById(`input-edit-${field}`)?.focus();
    });
  });

  // Select All / Clear Selection buttons
  document.getElementById('btn-select-all-fields').addEventListener('click', () => {
    const all = ['question', 'opt0', 'opt1', 'opt2', 'opt3', 'correctIndex', 'explanation', 'cueSeconds'];
    if (adminState.slot === 'main') all.push('category');
    all.forEach((f) => adminState.selectedFields.add(f));
    syncFieldSelectionUi();
  });

  document.getElementById('btn-clear-all-fields').addEventListener('click', () => {
    adminState.selectedFields.clear();
    syncFieldSelectionUi();
  });

  // Finalize Changes submission
  document.getElementById('admin-finalize-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ep = getSelectedEpisode();
    if (!ep || adminState.selectedFields.size === 0) return;

    const btn = document.getElementById('btn-finalize-changes');
    btn.disabled = true;
    btn.textContent = '⏳ Saving & Publishing…';

    try {
      const qObj = getActiveQuestionObject(ep);
      const subPatch = {};

      if (adminState.selectedFields.has('question')) {
        const val = document.getElementById('input-edit-question').value.trim();
        if (!val) throw new Error('Question wording cannot be blank.');
        subPatch.question = val;
      }

      if (
        adminState.selectedFields.has('opt0') ||
        adminState.selectedFields.has('opt1') ||
        adminState.selectedFields.has('opt2') ||
        adminState.selectedFields.has('opt3')
      ) {
        const nextOptions = [...(qObj.options || ['', '', '', ''])];
        for (let i = 0; i < 4; i++) {
          if (adminState.selectedFields.has(`opt${i}`)) {
            const oVal = document.getElementById(`input-edit-opt${i}`).value.trim();
            if (!oVal) throw new Error(`Option ${['A', 'B', 'C', 'D'][i]} cannot be blank.`);
            nextOptions[i] = oVal;
          }
        }
        subPatch.options = nextOptions;
      }

      if (adminState.selectedFields.has('correctIndex')) {
        subPatch.correctIndex = Number(document.getElementById('input-edit-correctIndex').value);
      }

      if (adminState.selectedFields.has('explanation')) {
        const eVal = document.getElementById('input-edit-explanation').value.trim();
        if (!eVal) throw new Error('Explanation text cannot be blank.');
        subPatch.explanation = eVal;
      }

      if (adminState.selectedFields.has('cueSeconds')) {
        subPatch.cueSeconds = Math.max(0, Number(document.getElementById('input-edit-cueSeconds').value) || 0);
      }

      let episodePatch = {};
      if (adminState.slot === 'vault') {
        episodePatch = {
          vaultBonus: {
            ...(ep.vaultBonus || {}),
            ...subPatch
          }
        };
      } else {
        episodePatch = { ...subPatch };
        if (adminState.selectedFields.has('category')) {
          episodePatch.category = document.getElementById('input-edit-category').value;
        }
      }

      const { overrides, syncedCloud } = await saveGlobalOverride(ep.guid, episodePatch);
      adminState.overrides = overrides;
      rebuildEpisodesWithOverrides();
      populateEpisodeSelect(document.getElementById('admin-ep-search').value);
      renderCurrentPreviewAndInputs(true);

      setStatusBanner(
        syncedCloud
          ? `✓ Changes finalized and published live for "${ep.title}" across all devices!`
          : `✓ Changes finalized and saved for "${ep.title}"!`,
        false
      );
    } catch (err) {
      setStatusBanner(err.message || 'Could not save changes.', true);
    } finally {
      btn.disabled = adminState.selectedFields.size === 0;
      btn.textContent = '✅ Finalize Changes';
    }
  });

  // Reset episode to original
  document.getElementById('btn-revert-episode').addEventListener('click', async () => {
    const ep = getSelectedEpisode();
    if (!ep) return;
    adminState.overrides = await deleteGlobalOverride(ep.guid);
    rebuildEpisodesWithOverrides();
    populateEpisodeSelect(document.getElementById('admin-ep-search').value);
    renderCurrentPreviewAndInputs(true);
    setStatusBanner(`↺ Restored "${ep.title}" to its original catalog question.`, false);
  });

  // Download full questions.json with overrides baked in
  document.getElementById('btn-download-full-json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(adminState.episodes, null, 2) + '\n'], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'questions.json';
    a.click();
    URL.revokeObjectURL(url);
  });
}

async function initAdminPage() {
  bindAdminEvents();
  const savedHash =
    localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (savedHash === ADMIN_PASSWORD_SHA256) {
    await unlockEditor();
  }
}

initAdminPage();
