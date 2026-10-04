// --- SETTINGS & COMMENT FILTERING ---

const SETTINGS_KEY = 'rowAutomatorSettings';
const MIN_CUSTOM = 1;   // each row gets exactly 1 custom comment...
const MIN_ORIGINAL = 2; // ...and 2 original comments

const OVERRIDES_KEY = 'rowAutomatorCommentOverrides';

let allComments = [];
let overrides = { excluded: {}, edits: {} };
const commentByCode = new Map();

const el = (id) => document.getElementById(id);

// Close popup window handler
el('closeBtn').addEventListener('click', () => {
  window.close();
});

const humanize = (tier) =>
  tier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

async function loadAllComments() {
  const response = await fetch(chrome.runtime.getURL('comments.json'));
  const all = await response.json();
  return all.map((c) => ({
    code: c.code,
    category: c.category,
    source: c.source,
    tone: c.tone,
    tier: c.tier,
    grade_min: c.grade_min,
    grade_max: c.grade_max,
    comment: c.comment
  }));
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch (err) {
    return {};
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Could not save settings:', err);
  }
}

// --- INDIVIDUAL COMMENT MANAGER (include / exclude / edit) ---

function loadOverrides() {
  try {
    const o = JSON.parse(localStorage.getItem(OVERRIDES_KEY));
    return { excluded: (o && o.excluded) || {}, edits: (o && o.edits) || {} };
  } catch (err) {
    return { excluded: {}, edits: {} };
  }
}

function saveOverrides() {
  const o = { excluded: {}, edits: {} };
  for (const c of allComments) {
    if (c.excluded) o.excluded[c.code] = true;
    if (isEdited(c)) {
      o.edits[c.code] = { comment: c.comment, grade_min: c.grade_min, grade_max: c.grade_max };
    }
  }
  overrides = o;
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(o));
  } catch (err) {
    console.warn('Could not save comment edits:', err);
  }
}

// Remember each comment's original values (for reset) and layer saved edits on top
function applyOverrides() {
  commentByCode.clear();
  for (const c of allComments) {
    if (!c.orig) c.orig = { comment: c.comment, grade_min: c.grade_min, grade_max: c.grade_max };
    const edit = overrides.edits[c.code];
    if (edit) {
      if (typeof edit.comment === 'string') c.comment = edit.comment;
      if (Number.isFinite(edit.grade_min)) c.grade_min = edit.grade_min;
      if (Number.isFinite(edit.grade_max)) c.grade_max = edit.grade_max;
    }
    c.excluded = !!overrides.excluded[c.code];
    commentByCode.set(String(c.code), c);
  }
}

const isEdited = (c) =>
  c.comment !== c.orig.comment ||
  c.grade_min !== c.orig.grade_min ||
  c.grade_max !== c.orig.grade_max;

function clampInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : Math.max(0, Math.min(100, n));
}

function getVisibleComments() {
  const query = el('commentSearch').value.trim().toLowerCase();
  const filter = el('commentFilter').value;

  return allComments.filter((c) => {
    if (filter === 'included' && c.excluded) return false;
    if (filter === 'excluded' && !c.excluded) return false;
    if (filter === 'edited' && !isEdited(c)) return false;
    if (filter === 'custom' && c.source !== 'custom') return false;
    if (filter === 'original' && c.source === 'custom') return false;
    if (query && !(c.comment.toLowerCase().includes(query) || String(c.code) === query)) return false;
    return true;
  });
}

function refreshItemState(item, c) {
  const edited = isEdited(c);
  item.classList.toggle('excluded', !!c.excluded);
  item.classList.toggle('edited', edited);
  item.querySelector('.c-inc').checked = !c.excluded;
  item.querySelector('.c-reset').hidden = !edited;
}

function renderCommentList() {
  const list = el('commentList');
  list.innerHTML = '';

  const visible = getVisibleComments();
  if (visible.length === 0) {
    list.innerHTML = '<div class="c-empty">No comments match.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const c of visible) {
    const item = document.createElement('div');
    item.className = 'c-item';
    item.dataset.code = c.code;
    item.innerHTML = `
      <div class="c-top">
        <input type="checkbox" class="c-inc" title="Include this comment">
        <span class="c-code">#${c.code}</span>
        <span class="tone-dot tone-${c.tone}" title="${humanize(c.tier)}"></span>
        ${c.source === 'custom' ? '<span class="c-badge">custom</span>' : ''}
        <span class="c-range" title="Grade range this comment applies to">
          <input type="number" class="c-min" min="0" max="100">
          <span>–</span>
          <input type="number" class="c-max" min="0" max="100">
        </span>
        <button type="button" class="link-btn c-reset" title="Reset to original">Reset</button>
      </div>
      <textarea class="c-text" rows="2" spellcheck="true"></textarea>
    `;
    item.querySelector('.c-text').value = c.comment;
    item.querySelector('.c-min').value = c.grade_min;
    item.querySelector('.c-max').value = c.grade_max;
    refreshItemState(item, c);
    frag.appendChild(item);
  }
  list.appendChild(frag);
}

function updateCommentSummary() {
  const total = allComments.length;
  const excluded = allComments.filter((c) => c.excluded).length;
  const edited = allComments.filter(isEdited).length;
  let text = `(${total - excluded} of ${total} on`;
  if (edited) text += `, ${edited} edited`;
  el('commentSummary').textContent = text + ')';
}

// Tier counts show how many comments are still active in each tier
function updateTierCounts() {
  const totals = {};
  const active = {};
  for (const c of allComments) {
    totals[c.tier] = (totals[c.tier] || 0) + 1;
    if (!c.excluded && c.comment.trim()) active[c.tier] = (active[c.tier] || 0) + 1;
  }
  document.querySelectorAll('[data-count-for]').forEach((node) => {
    const tier = node.dataset.countFor;
    const a = active[tier] || 0;
    node.textContent = a === totals[tier] ? String(a) : `${a}/${totals[tier]}`;
  });
}

function exportComments() {
  const data = allComments.map((c) => ({
    code: c.code,
    category: c.category,
    source: c.source,
    tone: c.tone,
    tier: c.tier,
    grade_min: c.grade_min,
    grade_max: c.grade_max,
    comment: c.comment
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'comments.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initCommentManager() {
  const list = el('commentList');

  list.addEventListener('change', (e) => {
    const item = e.target.closest('.c-item');
    if (!item) return;
    const c = commentByCode.get(item.dataset.code);
    if (!c) return;

    if (e.target.classList.contains('c-inc')) {
      c.excluded = !e.target.checked;
    } else if (e.target.classList.contains('c-min') || e.target.classList.contains('c-max')) {
      const minInput = item.querySelector('.c-min');
      const maxInput = item.querySelector('.c-max');
      let lo = clampInt(minInput.value, c.grade_min);
      let hi = clampInt(maxInput.value, c.grade_max);
      if (lo > hi) [lo, hi] = [hi, lo];
      c.grade_min = lo;
      c.grade_max = hi;
      minInput.value = lo;
      maxInput.value = hi;
    } else {
      return;
    }

    saveOverrides();
    refreshItemState(item, c);
    updateUI();
  });

  list.addEventListener('input', (e) => {
    if (!e.target.classList.contains('c-text')) return;
    const item = e.target.closest('.c-item');
    const c = item && commentByCode.get(item.dataset.code);
    if (!c) return;

    c.comment = e.target.value;
    saveOverrides();
    refreshItemState(item, c);
    updateUI();
  });

  // A blank comment can't be used, so restore the original text when leaving the box
  list.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('c-text') || e.target.value.trim()) return;
    const item = e.target.closest('.c-item');
    const c = item && commentByCode.get(item.dataset.code);
    if (!c) return;

    c.comment = c.orig.comment;
    e.target.value = c.comment;
    saveOverrides();
    refreshItemState(item, c);
    updateUI();
  });

  list.addEventListener('click', (e) => {
    if (!e.target.classList.contains('c-reset')) return;
    const item = e.target.closest('.c-item');
    const c = item && commentByCode.get(item.dataset.code);
    if (!c) return;

    c.comment = c.orig.comment;
    c.grade_min = c.orig.grade_min;
    c.grade_max = c.orig.grade_max;
    item.querySelector('.c-text').value = c.comment;
    item.querySelector('.c-min').value = c.grade_min;
    item.querySelector('.c-max').value = c.grade_max;
    saveOverrides();
    refreshItemState(item, c);
    updateUI();
  });

  el('commentSearch').addEventListener('input', renderCommentList);
  el('commentFilter').addEventListener('change', renderCommentList);

  el('commentsIncludeShown').addEventListener('click', () => {
    getVisibleComments().forEach((c) => (c.excluded = false));
    saveOverrides();
    renderCommentList();
    updateUI();
  });
  el('commentsExcludeShown').addEventListener('click', () => {
    getVisibleComments().forEach((c) => (c.excluded = true));
    saveOverrides();
    renderCommentList();
    updateUI();
  });

  el('commentsResetAll').addEventListener('click', () => {
    if (!confirm('Reset all comment edits and re-include every comment?')) return;
    for (const c of allComments) {
      c.comment = c.orig.comment;
      c.grade_min = c.orig.grade_min;
      c.grade_max = c.orig.grade_max;
      c.excluded = false;
    }
    saveOverrides();
    renderCommentList();
    updateUI();
  });

  el('commentsExport').addEventListener('click', exportComments);

  renderCommentList();
}

// One entry per tier, ordered from highest grades to lowest
function getTiers() {
  const map = new Map();
  for (const c of allComments) {
    if (!map.has(c.tier)) {
      map.set(c.tier, { tier: c.tier, min: c.grade_min, max: c.grade_max, tone: c.tone, count: 0 });
    }
    map.get(c.tier).count++;
  }
  return [...map.values()].sort((a, b) => b.min - a.min || b.max - a.max);
}

function buildTierList(saved) {
  const container = el('tierList');
  container.innerHTML = '';

  for (const t of getTiers()) {
    // Default: positive tiers on, everything else off
    const checked = saved.tiers && t.tier in saved.tiers ? saved.tiers[t.tier] : t.tone === 'positive';

    const row = document.createElement('label');
    row.className = 'tier-row';
    row.innerHTML = `
      <input type="checkbox" data-tier="${t.tier}" ${checked ? 'checked' : ''}>
      <span class="tone-dot tone-${t.tone}"></span>
      <span class="tier-name">${humanize(t.tier)}</span>
      <span class="tier-range">${t.min}–${t.max}</span>
      <span class="tier-count" data-count-for="${t.tier}">${t.count}</span>
    `;
    container.appendChild(row);
  }
}

function readSettingsFromUI() {
  const tiers = {};
  document.querySelectorAll('#tierList input[data-tier]').forEach((box) => {
    tiers[box.dataset.tier] = box.checked;
  });
  return {
    tiers,
    matchGrade: el('matchGrade').checked,
    useRange: el('useRange').checked,
    rangeMin: el('rangeMin').value,
    rangeMax: el('rangeMax').value
  };
}

function normalizedRange(settings) {
  const clamp = (v, fallback) => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? fallback : Math.max(0, Math.min(100, n));
  };
  let lo = clamp(settings.rangeMin, 0);
  let hi = clamp(settings.rangeMax, 100);
  if (lo > hi) [lo, hi] = [hi, lo];
  return { lo, hi };
}

function getEligibleComments(settings) {
  const { lo, hi } = normalizedRange(settings);
  return allComments.filter((c) => {
    if (!settings.tiers[c.tier]) return false;
    if (c.excluded || !c.comment.trim()) return false;
    if (settings.useRange && !(c.grade_max >= lo && c.grade_min <= hi)) return false;
    return true;
  });
}

function updateUI() {
  const settings = readSettingsFromUI();
  saveSettings(settings);
  updateTierCounts();
  updateCommentSummary();

  el('rangeMin').disabled = !settings.useRange;
  el('rangeMax').disabled = !settings.useRange;

  const eligible = getEligibleComments(settings);
  const custom = eligible.filter((c) => c.source === 'custom').length;
  const original = eligible.length - custom;

  const summary = el('summary');
  const startBtn = el('startBtn');

  if (settings.matchGrade) {
    // Per-row matching: each row only uses comments whose range includes its Gradebook Avg
    if (eligible.length === 0) {
      summary.className = 'warn';
      summary.textContent = 'No comments available. Check a grade tier or include some comments.';
      startBtn.disabled = true;
    } else {
      summary.className = '';
      summary.textContent =
        `${eligible.length} comments in the selected tiers (${custom} custom, ${original} original). ` +
        `Each row uses only those matching its Gradebook Avg.`;
      startBtn.disabled = false;
    }
  } else if (custom < MIN_CUSTOM || original < MIN_ORIGINAL) {
    summary.className = 'warn';
    summary.textContent =
      `Only ${custom} custom / ${original} original comments selected. ` +
      `Need at least ${MIN_CUSTOM} custom and ${MIN_ORIGINAL} original.`;
    startBtn.disabled = true;
  } else {
    summary.className = '';
    summary.textContent = `${eligible.length} comments eligible (${custom} custom, ${original} original).`;
    startBtn.disabled = false;
  }
}

async function init() {
  try {
    allComments = await loadAllComments();
  } catch (err) {
    console.error('Could not load comments.json:', err);
    el('summary').className = 'warn';
    el('summary').textContent = 'Could not load comments.json. Check that it is in the extension folder.';
    return;
  }

  overrides = loadOverrides();
  applyOverrides();

  const saved = loadSettings();
  buildTierList(saved);
  initCommentManager();

  el('matchGrade').checked = saved.matchGrade !== false; // on by default
  el('useRange').checked = !!saved.useRange;
  if (saved.rangeMin !== undefined) el('rangeMin').value = saved.rangeMin;
  if (saved.rangeMax !== undefined) el('rangeMax').value = saved.rangeMax;

  el('tierList').addEventListener('change', updateUI);
  el('matchGrade').addEventListener('change', updateUI);
  el('useRange').addEventListener('change', updateUI);
  el('rangeMin').addEventListener('input', updateUI);
  el('rangeMax').addEventListener('input', updateUI);

  el('tierAll').addEventListener('click', () => {
    document.querySelectorAll('#tierList input[data-tier]').forEach((b) => (b.checked = true));
    updateUI();
  });
  el('tierNone').addEventListener('click', () => {
    document.querySelectorAll('#tierList input[data-tier]').forEach((b) => (b.checked = false));
    updateUI();
  });

  updateUI();
}

init();

// Start processing handler (Add comments)
el('startBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const settings = readSettingsFromUI();
  const eligibleComments = getEligibleComments(settings).map((c) => ({
    code: c.code,
    category: c.category,
    source: c.source,
    tone: c.tone,
    grade_min: c.grade_min,
    grade_max: c.grade_max,
    comment: c.comment
  }));

  const customCount = eligibleComments.filter((c) => c.source === 'custom').length;
  const enough = settings.matchGrade
    ? eligibleComments.length > 0
    : customCount >= MIN_CUSTOM && eligibleComments.length - customCount >= MIN_ORIGINAL;
  if (!enough) {
    console.error('Not enough eligible comments for the current selection.');
    return;
  }

  // Same targeting as the last known-working version (top frame only)
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: runRowAutomator,
    args: [eligibleComments, { matchGrade: settings.matchGrade }]
  });
});

// Delete all comments handler
document.getElementById('deleteBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: runCommentDeleter
    });
  }
});


// --- 1. COMMENT ADDITION AUTOMATOR ---

async function runRowAutomator(eligibleComments, options) {
  if (window.__IS_AUTOMATOR_RUNNING) {
    console.warn('⚠️ Automator is already running. Skipping duplicate trigger.');
    return;
  }
  window.__IS_AUTOMATOR_RUNNING = true;

  const startRow = 0;
  const endRow = 19;
  const COMMENTS_PER_ROW = 3;
  const MATCH_GRADE = !!(options && options.matchGrade);

  // false = single click on the student header (proven to work on your page).
  // true  = double-click the student header instead.
  const USE_DOUBLE_CLICK = false;

  // The page ignores the first click on a row (it gets absorbed by a
  // blur/select handler), so send a priming click first, pause, then the
  // click that actually opens the row.
  const PRIME_CLICK = true;
  const PRIME_PAUSE_MS = 300;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Polls until an element is visible in the DOM
  async function waitForVisibleElement(container, selector, maxWaitMs = 3000, pollIntervalMs = 100) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const element = (container ? container.querySelector(selector) : null) || document.querySelector(selector);
      if (element && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.offsetParent !== null)) {
        return element;
      }
      await sleep(pollIntervalMs);
    }
    return null;
  }

  // Stricter check: also rejects elements inside a collapsed (zero-height, clipped) container
  function isReallyVisible(element, stopAt) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    let node = element.parentElement;
    while (node && node !== stopAt && node !== document.body) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.overflow !== 'visible' && node.getBoundingClientRect().height < 2) return false;
      node = node.parentElement;
    }
    return true;
  }

  function buildMouseInit(element, extra = {}) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y,
      button: 0,
      buttons: 1,
      ...extra
    };
  }

  function simulatePointerClick(element) {
    if (!element) return;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus();

    const commonInit = buildMouseInit(element);
    const pointerInit = {
      ...commonInit,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: 0
    };

    element.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
    element.dispatchEvent(new MouseEvent('mousedown', commonInit));
    element.dispatchEvent(new MouseEvent('mouseup', commonInit));
    element.dispatchEvent(new PointerEvent('click', pointerInit));
  }

  function simulateDoubleClick(element) {
    if (!element) return;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus();

    for (let clickCount = 1; clickCount <= 2; clickCount++) {
      const init = buildMouseInit(element, { detail: clickCount });
      const pointerInit = { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      element.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
      element.dispatchEvent(new MouseEvent('mousedown', init));
      element.dispatchEvent(new PointerEvent('pointerup', pointerInit));
      element.dispatchEvent(new MouseEvent('mouseup', init));
      element.dispatchEvent(new MouseEvent('click', init));
    }
    element.dispatchEvent(new MouseEvent('dblclick', buildMouseInit(element, { detail: 2 })));
  }

  function setNativeValue(element, value) {
    element.focus();
    element.value = value;

    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set
      || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;

    if (valueSetter) {
      valueSetter.call(element, value);
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // --- COMMENT SELECTION: exactly 1 custom + 2 original per row ---
  const shuffle = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  // Reads "Gradebook Avg: ##" from the element whose id contains "GradebookAverage"
  // inside the row. Returns a whole number 0-100, or null if it can't be read.
  function readGradebookAverage(rowContainer) {
    const gradeEl = rowContainer.querySelector('[id*="GradebookAverage"]');
    if (!gradeEl) return null;

    const text = (gradeEl.innerHTML || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ');
    const match = text.match(/Gradebook\s*Avg\s*:?\s*(\d{1,3}(?:\.\d+)?)/i)
      || text.match(/(\d{1,3}(?:\.\d+)?)/);
    if (!match) return null;

    const value = Math.round(parseFloat(match[1]));
    return Math.max(0, Math.min(100, value));
  }

  async function waitForGradebookAverage(rowContainer, maxWaitMs = 1500, pollIntervalMs = 100) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const grade = readGradebookAverage(rowContainer);
      if (grade !== null) return grade;
      await sleep(pollIntervalMs);
    }
    return null;
  }

  // Up to 1 custom + 2 original comments whose grade range includes the
  // student's average (when grade matching is on). Fewer are returned if
  // not enough comments match.
  function pickCommentsForRow(grade) {
    const pool = MATCH_GRADE && grade !== null
      ? eligibleComments.filter((c) => grade >= c.grade_min && grade <= c.grade_max)
      : eligibleComments;

    const customPool = shuffle(pool.filter((c) => c.source === 'custom'));
    const originalPool = shuffle(pool.filter((c) => c.source !== 'custom'));

    const picked = [];
    const usedCategories = new Set();

    if (customPool.length > 0) {
      picked.push(customPool[0]);
      usedCategories.add(customPool[0].category);
    }

    for (const c of originalPool) {
      if (picked.length >= COMMENTS_PER_ROW) break;
      if (!usedCategories.has(c.category)) {
        picked.push(c);
        usedCategories.add(c.category);
      }
    }
    for (const c of originalPool) {
      if (picked.length >= COMMENTS_PER_ROW) break;
      if (!picked.includes(c)) picked.push(c);
    }
    return shuffle(picked);
  }

  function expandRow(rowIndex, rowContainer, label = 'click') {
    const studentTarget = rowContainer.querySelector('[id^="h4_StudentName_"], h4.blue-light');
    if (!studentTarget) {
      console.warn(`[Row ${rowIndex}] Student target not found.`);
      return false;
    }
    if (USE_DOUBLE_CLICK) {
      simulateDoubleClick(studentTarget);
    } else {
      simulatePointerClick(studentTarget);
    }
    console.log(`[Row ${rowIndex}] ${USE_DOUBLE_CLICK ? 'Double-clicked' : 'Sent'} ${label} on student target.`);
    return true;
  }

  // Makes sure the row's text box is open without blindly toggling it.
  // Sequence: check if already open -> priming click -> pause -> (if still
  // closed) opening click -> (if still closed) one more click.
  async function ensureTextAreaOpen(rowIndex, rowContainer, textAreaSelector) {
    const findOpen = () => {
      const ta = rowContainer.querySelector(textAreaSelector);
      return ta && isReallyVisible(ta, rowContainer) ? ta : null;
    };

    const pollOpen = async (maxWaitMs) => {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        const ta = findOpen();
        if (ta) return ta;
        await sleep(100);
      }
      return null;
    };

    let ta = findOpen();
    if (ta) {
      console.log(`[Row ${rowIndex}] Row already open. Not clicking.`);
      return ta;
    }

    // Priming click: absorbed by the page's first-click handler
    if (PRIME_CLICK) {
      if (!expandRow(rowIndex, rowContainer, 'priming click')) return null;
      await sleep(PRIME_PAUSE_MS);

      // If the priming click happened to open the row, don't click again
      ta = findOpen();
      if (ta) {
        console.log(`[Row ${rowIndex}] Priming click opened the row.`);
        return ta;
      }
    }

    // Opening click, then one fallback click if needed
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (!expandRow(rowIndex, rowContainer, attempt === 1 ? 'opening click' : 'fallback click')) return null;
      ta = await pollOpen(2000);
      if (ta) return ta;
      console.warn(`[Row ${rowIndex}] Text box not open after ${attempt === 1 ? 'opening' : 'fallback'} click.`);
    }

    // Last resort: accept a text box that passes the basic visibility test
    return await waitForVisibleElement(rowContainer, textAreaSelector, 1000);
  }

  console.log('🚀 Starting dynamic row automation with DOM expansion polling...');

  try {
    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
      console.group(`Processing Row ${rowIndex}`);

      // STEP 1: Find Row Container
      const rowContainer = document.querySelector(`[data-row-index="${rowIndex}"]`);
      if (!rowContainer) {
        console.warn(`[Row ${rowIndex}] Row container not found.`);
        console.groupEnd();
        continue;
      }

      const textAreaSelector = `[data-row-index="${rowIndex}"] [id*="TextArea"], [data-row-index="${rowIndex}"] textarea[id*="TextArea"]`;
      const commentSelector = `[data-row-index="${rowIndex}"] #Div_Add_Comment, [data-row-index="${rowIndex}"] [id*="Div_Add_Comment"], #Div_Add_Comment`;

      // Read the student's Gradebook Avg (it may already be visible before the row is open)
      let grade = MATCH_GRADE ? readGradebookAverage(rowContainer) : null;
      let rowComments = null;

      const describePicks = (comments) =>
        comments.map((c) => `#${c.code} (${c.source}, ${c.grade_min}-${c.grade_max})`);

      if (!MATCH_GRADE || grade !== null) {
        rowComments = pickCommentsForRow(grade);
        if (MATCH_GRADE) console.log(`[Row ${rowIndex}] Gradebook Avg: ${grade}`);
        if (rowComments.length === 0) {
          console.warn(`[Row ${rowIndex}] No selected comments match Gradebook Avg ${grade}. Skipping row.`);
          console.groupEnd();
          await sleep(300);
          continue;
        }
        console.log(`[Row ${rowIndex}] Selected comments:`, describePicks(rowComments));
      }

      for (let i = 0; i < COMMENTS_PER_ROW; i++) {
        // STEP 2/3: Open the row (only if needed) and wait for the TextArea
        const textArea = await ensureTextAreaOpen(rowIndex, rowContainer, textAreaSelector);
        if (!textArea) {
          console.error(`❌ [Row ${rowIndex}] TextArea failed to render within 3000ms (comment ${i + 1}/${COMMENTS_PER_ROW}). Skipping rest of row.`);
          break;
        }

        // Gradebook Avg may only render once the row is open
        if (rowComments === null) {
          grade = await waitForGradebookAverage(rowContainer, 1500);
          if (grade === null) {
            console.warn(`[Row ${rowIndex}] Could not read Gradebook Avg. Skipping row so no mismatched comment is added.`);
            break;
          }
          console.log(`[Row ${rowIndex}] Gradebook Avg: ${grade}`);
          rowComments = pickCommentsForRow(grade);
          if (rowComments.length === 0) {
            console.warn(`[Row ${rowIndex}] No selected comments match Gradebook Avg ${grade}. Skipping row.`);
            break;
          }
          console.log(`[Row ${rowIndex}] Selected comments:`, describePicks(rowComments));
        }

        if (i >= rowComments.length) break; // fewer matching comments than slots

        const { comment, code, source } = rowComments[i];
        await sleep(200);

        // STEP 4: Input text
        simulatePointerClick(textArea);
        setNativeValue(textArea, comment);
        console.log(`[Row ${rowIndex}] Entered comment ${i + 1}/${rowComments.length} [#${code}, ${source}]: "${comment}"`);

        await sleep(200);

        // STEP 5: Click Div_Add_Comment
        const addCommentBtn = await waitForVisibleElement(rowContainer, commentSelector, 1500);
        if (!addCommentBtn) {
          console.warn(`[Row ${rowIndex}] Div_Add_Comment button not found. Skipping rest of row.`);
          break;
        }
        simulatePointerClick(addCommentBtn);
        console.log(`[Row ${rowIndex}] Clicked Div_Add_Comment.`);

        // Wait for the box to clear or close, then let the UI settle
        const startWait = Date.now();
        while (Date.now() - startWait < 3000) {
          const current = rowContainer.querySelector(textAreaSelector);
          if (!current || current.value === '' || !isReallyVisible(current, rowContainer)) break;
          await sleep(150);
        }
        await sleep(700);
      }

      console.groupEnd();

      // Cooling pause before moving to the next row
      await sleep(800);
    }

    console.log('✅ Finished processing all rows dynamically!');
  } catch (err) {
    console.error('💥 Execution error in runRowAutomator:', err);
  } finally {
    window.__IS_AUTOMATOR_RUNNING = false;
  }
}


// --- 2. COMMENT DELETION AUTOMATOR ---

async function runCommentDeleter() {
  if (window.__IS_AUTOMATOR_RUNNING) {
    console.warn('⚠️ Deleter is already running in this frame. Skipping duplicate trigger.');
    return;
  }

  if (!document.querySelector('[data-row-index]')) {
    return;
  }

  window.__IS_AUTOMATOR_RUNNING = true;

  const startRow = 0;
  const endRow = 19;
  const MAX_DELETES_PER_ROW = 15; // safety cap
  const PRIME_CLICK = true;
  const PRIME_PAUSE_MS = 300;

  // --- INLINED HELPERS FOR ISOLATED INJECTION ---
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForVisibleElement(selector, maxWaitMs = 3500, pollIntervalMs = 150) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const element = document.querySelector(selector);
      if (element && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.offsetParent !== null)) {
        return element;
      }
      await sleep(pollIntervalMs);
    }
    return null;
  }

  // Rejects elements inside a collapsed (zero-height, clipped) container
  function isReallyVisible(element, stopAt) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    let node = element.parentElement;
    while (node && node !== stopAt && node !== document.body) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.overflow !== 'visible' && node.getBoundingClientRect().height < 2) return false;
      node = node.parentElement;
    }
    return true;
  }

  function simulatePointerClick(element) {
    if (!element) return;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus();

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const commonInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y,
      button: 0,
      buttons: 1
    };

    const pointerInit = {
      ...commonInit,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: 0
    };

    element.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
    element.dispatchEvent(new MouseEvent('mousedown', commonInit));
    element.dispatchEvent(new MouseEvent('mouseup', commonInit));
    element.dispatchEvent(new PointerEvent('click', pointerInit));
  }

  // All delete icons currently visible inside a row
  const deleteSelector = '[id*="Span_Delete_Comment"]';
  const getVisibleDeleteButtons = (rowContainer) =>
    [...rowContainer.querySelectorAll(deleteSelector)].filter((el) => isReallyVisible(el, rowContainer));

  // Opens the row (priming click + opening click) until delete icons show up.
  // Returns true if at least one delete icon is visible afterwards.
  async function openRowForDeletion(rowIndex, rowContainer) {
    const studentTarget = rowContainer.querySelector('[id^="h4_StudentName_"], h4.blue-light, [id*="StudentName"]');
    if (!studentTarget) {
      console.warn(`[Row ${rowIndex}] Student target not found.`);
      return false;
    }

    const pollForButtons = async (maxWaitMs) => {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        if (getVisibleDeleteButtons(rowContainer).length > 0) return true;
        await sleep(100);
      }
      return false;
    };

    if (PRIME_CLICK) {
      simulatePointerClick(studentTarget);
      console.log(`[Row ${rowIndex}] Sent priming click on student header.`);
      await sleep(PRIME_PAUSE_MS);
      if (getVisibleDeleteButtons(rowContainer).length > 0) return true;
    }

    simulatePointerClick(studentTarget);
    console.log(`[Row ${rowIndex}] Sent opening click on student header.`);
    return await pollForButtons(2000);
  }

  // --- DELETION LOOP ---
  console.log(`🗑️ Starting comment deletion across rows ${startRow}–${endRow}...`);

  try {
    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
      console.group(`[Delete Comment] Row ${rowIndex}`);

      const rowSelector = `[data-row-index="${rowIndex}"]`;
      const rowContainer = await waitForVisibleElement(rowSelector, 3000);

      if (!rowContainer) {
        console.warn(`[Row ${rowIndex}] Row container not found. Skipping.`);
        console.groupEnd();
        continue;
      }

      let deletedCount = 0;
      let reopenAttempted = false;

      while (deletedCount < MAX_DELETES_PER_ROW) {
        let buttons = getVisibleDeleteButtons(rowContainer);

        // No visible delete icon: row may be collapsed (or has no comments left).
        // Try opening it once; if nothing shows up, the row is done.
        if (buttons.length === 0) {
          if (reopenAttempted) break;
          reopenAttempted = true;
          const opened = await openRowForDeletion(rowIndex, rowContainer);
          if (!opened) break;
          buttons = getVisibleDeleteButtons(rowContainer);
          if (buttons.length === 0) break;
        }

        const countBefore = buttons.length;
        simulatePointerClick(buttons[0]);
        console.log(`[Row ${rowIndex}] Clicked Span_Delete_Comment (${countBefore} visible before click).`);

        await sleep(300);
        const confirmBtn = document.querySelector('.modal-footer .btn-primary, button[id*="Confirm"], button[id*="DeleteOK"]');
        if (confirmBtn && confirmBtn.offsetParent !== null) {
          simulatePointerClick(confirmBtn);
          console.log(`[Row ${rowIndex}] Clicked confirmation modal.`);
        }

        // Wait until the number of delete icons drops (or the row collapses)
        const waitStart = Date.now();
        while (Date.now() - waitStart < 3000) {
          if (getVisibleDeleteButtons(rowContainer).length < countBefore) break;
          await sleep(150);
        }

        deletedCount++;
        reopenAttempted = false; // a successful delete resets the re-open allowance
        await sleep(400);
      }

      if (deletedCount === 0) {
        console.log(`[Row ${rowIndex}] No Span_Delete_Comment found (row had no comments).`);
      } else {
        console.log(`[Row ${rowIndex}] Deleted ${deletedCount} comment(s).`);
      }

      console.groupEnd();
      await sleep(1000);
    }

    console.log('✅ Comment deletion complete across all rows!');
  } catch (err) {
    console.error('💥 Execution error in runCommentDeleter:', err);
  } finally {
    window.__IS_AUTOMATOR_RUNNING = false;
  }
}