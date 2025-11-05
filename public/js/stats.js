/**
 * stats.js - Tracker Statistics Dashboard Client Logic
 * ---------------------------------------------------------------------------
 *
 * Purpose
 *   Main client-side JavaScript for the tracker statistics page. Handles fetching
 *   and displaying per-tracker statistics with client-side filtering, sorting,
 *   layout preferences, theme switching, and aggregate totals. Optimizes
 *   perceived performance through localStorage caching and staggered animations.
 *
 * Key Features
 *   - API endpoint: GET /api/stats/torrents (with optional ?apikey= parameter)
 *   - Local cache with 5-minute TTL to reduce redundant network requests
 *   - Dynamic card rendering with stale data highlighting (visual indicators)
 *   - Aggregate summary card showing totals across all trackers
 *   - Proportional tracks distribution bar visualization
 *   - Responsive layout modes: wide mode, compact mode
 *   - Number formatting: full numbers vs. abbreviated (K/M/B)
 *   - Light/Dark theme toggle with system preference detection
 *   - Debounced filtering (200ms delay) for smooth UX
 *   - Auto-refresh every 10 minutes (only when tab is visible)
 *   - Staggered animations for card entrance
 *
 * Data Structure
 *   Each tracker statistics item contains:
 *   - trackerName: string - Tracker identifier
 *   - newtor: number - Count of new torrents
 *   - update: number - Count of updated torrents
 *   - check: number - Count of checked torrents
 *   - alltorrents: number - Total torrent count
 *   - lastnewtor: string - Date of last new torrent (format: 'dd.mm.yyyy')
 *   - tracks: object - Distribution tracking:
 *     - wait: number - Torrents waiting for confirmation
 *     - confirm: number - Confirmed torrents
 *     - skip: number - Skipped torrents
 *
 * Architecture
 *   - Dependency waiting pattern for jQuery and ApiKey module
 *   - localStorage-based caching and preferences
 *   - Event delegation for dynamically rendered elements
 *   - RequestAnimationFrame for scroll-based UI updates
 *
 * Performance Notes
 *   - Cache reduces API calls on page revisits
 *   - Debounced filtering prevents excessive re-renders
 *   - Staggered animations use CSS variables for efficiency
 *   - Visibility API prevents background refreshes
 */
function __initStats() {
  const API_BASE = '/api';
  const grid = $('#statsGrid');
  const loading = $('#loading');
  const errorBox = $('#error');
  const emptyState = $('#emptyState');
  const lastUpdate = $('#lastUpdate');
  const searchInput = $('#searchTracker');
  const sortSelect = $('#sortSelect');
  const counterEl = $('#cardsCounter');
  const aggregateHost = $('#aggregateHost');
  const toggleWidthBtn = $('#toggleWidth');
  const toggleCompactBtn = $('#toggleCompact');
  const toggleThemeBtn = $('#toggleTheme');
  const toggleNumbersBtn = $('#toggleNumbers');

  // State management
  let rawData = [];          // Raw data from API (all trackers)
  let viewData = [];         // Filtered and sorted data for display
  let autoRefreshTimer = null;  // Interval timer for auto-refresh

  // localStorage keys for caching and preferences
  const CACHE_KEY = 'statsCacheV1';        // Cache key for statistics data
  const CACHE_TTL_MS = 5 * 60 * 1000;     // Cache TTL: 5 minutes
  const THEME_KEY = 'statsTheme';          // Theme preference: 'dark' | 'light'
  const NUM_MODE_KEY = 'statsNumbersFull'; // Number format: '1' (full) | '0' (abbreviated)

  // Number formatting mode preference
  let numbersFull = localStorage.getItem(NUM_MODE_KEY) === '1';

  /**
   * Debounce function to limit rapid function calls
   *
   * Delays function execution until after wait period has passed since
   * last invocation. Useful for input filtering and resize handlers.
   *
   * @param {Function} fn - Function to debounce
   * @param {number} wait - Wait time in milliseconds (default: 180ms)
   * @returns {Function} - Debounced function
   */
  function debounce(fn, wait = 180) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /**
   * Format number in human-readable abbreviated form (K/M/B)
   *
   * Converts large numbers to abbreviated format:
   * - < 1000: unchanged (e.g., 999)
   * - < 1M: K suffix (e.g., 1.5K)
   * - < 1B: M suffix (e.g., 2.3M)
   * - >= 1B: B suffix (e.g., 1.2B)
   *
   * @param {number|null} num - Number to format
   * @returns {string} - Formatted string (e.g., "1.5K") or "—" if null
   */
  function human(num) {
    if (num == null) return '—';
    if (num < 1000) return num + '';
    if (num < 1e6) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    if (num < 1e9) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  }

  /**
   * Determine CSS class for stale data indicator based on date
   *
   * Calculates days since last new torrent and returns appropriate CSS class:
   * - > 90 days: 'very-stale' (red, urgent)
   * - > 7 days: 'stale' (orange, warning)
   * - <= 7 days: '' (normal, no indicator)
   *
   * @param {string} dateStr - Date string in format 'dd.mm.yyyy'
   * @returns {string} - CSS class name or empty string
   */
  function staleClass(dateStr) {
    if (!dateStr) return '';
    const [d, m, y] = dateStr.split('.').map(Number);
    const dt = new Date(y, m - 1, d);
    const diffDays = (Date.now() - dt.getTime()) / 86400000;
    if (diffDays > 90) return 'very-stale';
    if (diffDays > 7) return 'stale';
    return '';
  }

  /**
   * Load cached statistics from localStorage if still fresh
   *
   * Checks cache validity based on TTL. If cache exists and is valid:
   * - Loads data into rawData
   * - Updates lastUpdate display with "(кэш)" indicator
   * - Applies filters and sorting
   *
   * @returns {boolean} - True if cache was loaded and used, false otherwise
   */
  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed.ts || !Array.isArray(parsed.data)) return false;
      if (Date.now() - parsed.ts > CACHE_TTL_MS) return false;
      rawData = parsed.data;
      lastUpdate.text(new Date(parsed.ts).toLocaleString() + ' (кэш)');
      applyFilterSort();
      return true;
    } catch (e) {
      return false;
    }
  }
  /**
   * Save current rawData to localStorage cache
   *
   * Stores statistics data with current timestamp for TTL validation
   * on subsequent page loads. Silently handles storage errors.
   */
  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: rawData }));
    } catch (e) { }
  }

  /**
   * Format number according to current display mode
   *
   * If numbersFull is true: formats with thousands separators (ru-RU locale)
   * If numbersFull is false: uses abbreviated format (K/M/B)
   *
   * @param {number|null} num - Number to format
   * @returns {string} - Formatted number string or "—" if null
   */
  function formatNumber(num) {
    if (num == null) return '—';
    if (!numbersFull) return human(num);
    // full mode: thousands separated (ru-RU locale) without decimals for integers
    try {
      if (typeof num === 'number') return num.toLocaleString('ru-RU');
      const n = Number(num);
      if (!isNaN(n)) return n.toLocaleString('ru-RU');
      return num + '';
    } catch (e) {
      return num + '';
    }
  }

  /**
   * Build HTML string for a single tracker statistics card
   *
   * Creates a complete card with:
   * - Tracker icon and name
   * - Last new torrent date (with stale indicator if applicable)
   * - Statistics boxes (new, update, check, total, tracks)
   * - Proportional tracks distribution bar (wait/confirm/skip)
   * - Tracks legend with percentages
   *
   * @param {Object} item - Tracker statistics object
   * @returns {string} - HTML string for the tracker card
   */
  function buildCard(item) {
    const totalTracks =
      (item.tracks.wait || 0) + (item.tracks.confirm || 0) + (item.tracks.skip || 0);
    const pc = (v) => (totalTracks ? ((v / totalTracks) * 100).toFixed(1) : 0);
    const bars = [
      { cls: 'confirm', val: item.tracks.confirm || 0 },
      { cls: 'wait', val: item.tracks.wait || 0 },
      { cls: 'skip', val: item.tracks.skip || 0 },
    ];
    let left = 0;
    const barHtml = bars
      .map((b) => {
        const w = totalTracks ? (b.val / totalTracks) * 100 : 0;
        const span = `<span class="${b.cls}" style="left:${left}%;width:${w}%;"></span>`;
        left += w;
        return span;
      })
      .join('');
    const ico = `./img/ico/${item.trackerName}.ico`;
    const stale = staleClass(item.lastnewtor);
    const staleTitle = stale ? 'Данные устарели' : '';
    return `
      <div class="tracker-card" data-tracker="${item.trackerName}">
        <header>
          <img class="ico" src="${ico}" alt="${item.trackerName}" loading="lazy" onerror="this.src='./img/favicon.ico'" />
          <div class="tracker-head">
            <h3>${item.trackerName}</h3>
            <div class="tracker-meta ${stale}" title="${staleTitle}">посл. новый: ${item.lastnewtor}</div>
          </div>
          <div class="stat-box stat-inline">
            <div class="stat-label">Новые</div>
            <div class="stat-value">${formatNumber(item.newtor)}</div>
          </div>
        </header>
        <div class="tracker-stats">
          <div class="stat-box"><span class="stat-label">Изменения</span><span class="stat-value">${formatNumber(item.update)}</span></div>
          <div class="stat-box"><span class="stat-label">Проверок</span><span class="stat-value">${formatNumber(item.check)}</span></div>
          <div class="stat-box big"><span class="stat-label">Всего торрентов</span><span class="stat-value">${formatNumber(item.alltorrents)}</span></div>
          <div class="stat-box"><span class="stat-label">Wait</span><span class="stat-value">${formatNumber(item.tracks.wait)}</span></div>
          <div class="stat-box"><span class="stat-label">Confirm</span><span class="stat-value">${formatNumber(item.tracks.confirm)}</span></div>
          <div class="stat-box"><span class="stat-label">Skip</span><span class="stat-value">${formatNumber(item.tracks.skip)}</span></div>
          <div class="stat-box big">
            <span class="stat-label">Tracks распределение</span>
            <div class="tracks-bar">${barHtml}</div>
            <div class="tracks-legend">
              <span><span class="dot dot-confirm"></span>confirm ${pc(item.tracks.confirm)}%</span>
              <span><span class="dot dot-wait"></span>wait ${pc(item.tracks.wait)}%</span>
              <span><span class="dot dot-skip"></span>skip ${pc(item.tracks.skip)}%</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  /**
   * Render aggregate summary card showing totals across all trackers
   *
   * Calculates sums for all statistics fields and creates a summary card
   * with the same structure as individual tracker cards. Includes:
   * - Total counts across all trackers
   * - Proportional tracks distribution bar
   * - Visual distinction (aggregate-card class)
   *
   * Only renders if rawData contains items. Clears aggregateHost if empty.
   */
  function renderAggregate() {
    if (!rawData.length) {
      aggregateHost.empty();
      return;
    }
    const totals = rawData.reduce(
      (acc, r) => {
        acc.newtor += r.newtor || 0;
        acc.update += r.update || 0;
        acc.check += r.check || 0;
        acc.alltorrents += r.alltorrents || 0;
        acc.wait += r.tracks.wait || 0;
        acc.confirm += r.tracks.confirm || 0;
        acc.skip += r.tracks.skip || 0;
        return acc;
      },
      { newtor: 0, update: 0, check: 0, alltorrents: 0, wait: 0, confirm: 0, skip: 0 }
    );
    const totalTracks = totals.wait + totals.confirm + totals.skip;
    const pc = (v) => (totalTracks ? ((v / totalTracks) * 100).toFixed(1) : 0);
    const bars = [
      { cls: 'confirm', val: totals.confirm },
      { cls: 'wait', val: totals.wait },
      { cls: 'skip', val: totals.skip },
    ];
    let left = 0;
    const barHtml = bars
      .map((b) => {
        const w = totalTracks ? (b.val / totalTracks) * 100 : 0;
        const span = `<span class="${b.cls}" style="left:${left}%;width:${w}%;"></span>`;
        left += w;
        return span;
      })
      .join('');
    aggregateHost.html(`
      <div class="tracker-card aggregate-card">
        <header>
          <div class="tracker-head" style="flex:1;">
            <h3>Итого (${rawData.length})</h3>
            <div class="tracker-meta">Суммарные значения по всем трекерам</div>
          </div>
          <div class="stat-box stat-inline" aria-label="Всего новых">
            <div class="stat-label">Новые</div>
            <div class="stat-value">${formatNumber(totals.newtor)}</div>
          </div>
        </header>
        <div class="tracker-stats">
          <div class="stat-box"><span class="stat-label">Изменения</span><span class="stat-value">${formatNumber(totals.update)}</span></div>
          <div class="stat-box"><span class="stat-label">Проверок</span><span class="stat-value">${formatNumber(totals.check)}</span></div>
          <div class="stat-box big"><span class="stat-label">Всего торрентов</span><span class="stat-value">${formatNumber(totals.alltorrents)}</span></div>
          <div class="stat-box"><span class="stat-label">Wait</span><span class="stat-value">${formatNumber(totals.wait)}</span></div>
          <div class="stat-box"><span class="stat-label">Confirm</span><span class="stat-value">${formatNumber(totals.confirm)}</span></div>
          <div class="stat-box"><span class="stat-label">Skip</span><span class="stat-value">${formatNumber(totals.skip)}</span></div>
          <div class="stat-box big">
            <span class="stat-label">Tracks распределение</span>
            <div class="tracks-bar">${barHtml}</div>
            <div class="tracks-legend">
              <span><span class="dot dot-confirm"></span>confirm ${pc(totals.confirm)}%</span>
              <span><span class="dot dot-wait"></span>wait ${pc(totals.wait)}%</span>
              <span><span class="dot dot-skip"></span>skip ${pc(totals.skip)}%</span>
            </div>
          </div>
        </div>
      </div>`);
  }

  /**
   * Render current viewData cards into grid with staggered animations
   *
   * Builds HTML for all tracker cards with animation delays based on index.
   * Each card gets a CSS variable (--card-index) and animation-delay for
   * smooth sequential entrance effect. Updates counter and handles empty state.
   */
  function render() {
    if (!viewData.length) {
      grid.empty();
      emptyState.show();
      counterEl.text('0');
      return;
    }
    emptyState.hide();
    counterEl.text(viewData.length);
    const html = viewData
      .map((item, idx) => {
        const cardHtml = buildCard(item);
        // Add index for staggered animation
        return cardHtml.replace(
          '<div class="tracker-card',
          `<div class="tracker-card" style="--card-index: ${idx}; animation-delay: ${idx * 0.03}s"`
        );
      })
      .join('');
    grid.html(html);

    // Trigger reflow for animation
    void grid[0].offsetHeight;
  }

  /**
   * Apply text filter and sorting to rawData, producing viewData
   *
   * Filters trackers by name (case-insensitive substring match) and sorts
   * by selected criteria:
   * - 'name': Alphabetical by tracker name
   * - Other: Descending numeric sort by selected field
   *
   * Updates viewData and triggers render.
   */
  function applyFilterSort() {
    const q = searchInput.val().trim().toLowerCase();
    viewData = rawData.filter((r) => !q || r.trackerName.toLowerCase().includes(q));
    const sort = sortSelect.val();
    if (sort === 'name') viewData.sort((a, b) => a.trackerName.localeCompare(b.trackerName));
    else {
      viewData.sort((a, b) => {
        const map = (v) => {
          if (sort === 'confirm') return v.tracks.confirm || 0;
          if (sort === 'wait') return v.tracks.wait || 0;
          if (sort === 'skip') return v.tracks.skip || 0;
          return v[sort] || 0;
        };
        return map(b) - map(a);
      });
    }
    render();
  }

  /**
   * Build API key query parameter for stats fetch URL
   *
   * Attempts to get API key from:
   * 1. window.ApiKey module (if available)
   * 2. localStorage fallback
   *
   * Returns URL-encoded query parameter string or empty string if no key.
   *
   * @returns {string} - Query parameter string (e.g., "&apikey=...") or ""
   */
  function buildApiKeyParam() {
    try {
      if (window.ApiKey) {
        const k = window.ApiKey.get();
        if (k) return '&apikey=' + encodeURIComponent(k);
      }
      const ls = localStorage.getItem('api_key');
      if (ls) return '&apikey=' + encodeURIComponent(ls);
    } catch (e) { }
    return '';
  }

  /**
   * Fetch latest statistics from API and update UI
   *
   * Makes AJAX request to /api/stats/torrents endpoint. On success:
   * - Updates rawData with fresh data
   * - Saves to cache
   * - Renders aggregate card
   * - Applies filters and sorting
   * - Shows visual feedback if manual refresh
   *
   * On error: displays error message with details (HTTP status, structured
   * error JSON if available, or fallback message).
   *
   * @param {boolean} manual - True if triggered by user (shows flash animation)
   */
  function fetchStats(manual = false) {
    loading.show();
    errorBox.hide();
    grid.empty();
    emptyState.hide();
    $.ajax({
      dataType: 'json',
      url: API_BASE + '/stats/torrents?ts=' + Date.now() + buildApiKeyParam(),
      cache: false,
      success: (json) => {
        rawData = json;
        lastUpdate.text(new Date().toLocaleString());
        saveCache();
        renderAggregate();
        applyFilterSort();
        if (manual) {
          lastUpdate.addClass('flash');
          setTimeout(() => lastUpdate.removeClass('flash'), 700);
        }
      },
      error: (jqXHR, textStatus, errorThrown) => {
        let msg = 'Ошибка загрузки данных.';
        if (jqXHR && jqXHR.status) msg += ' HTTP ' + jqXHR.status;
        // Try parse structured worker error { error, code, locale }
        let structured = null;
        try {
          if (jqXHR && jqXHR.responseText && jqXHR.responseText.length < 2000) {
            structured = JSON.parse(jqXHR.responseText);
          }
        } catch (_) {
          /* ignore */
        }
        if (structured && structured.error) {
          msg += ' — ' + $('<div>').text(structured.error).html();
          if (structured.code) msg += ' [' + structured.code + ']';
        } else {
          try {
            if (jqXHR.responseText && jqXHR.responseText.length < 500) {
              msg += ' — ' + jqXHR.responseText.replace(/</g, '&lt;');
            }
          } catch (_) { }
        }
        errorBox.html(msg).show();
        console.error('Stats fetch failed:', {
          status: jqXHR.status,
          textStatus,
          errorThrown,
          response: jqXHR.responseText,
        });
      },
      complete: () => loading.hide(),
    });
  }

  /**
   * Apply wide mode layout state
   *
   * Reads preference from localStorage or auto-detects based on screen width.
   * Toggles 'stats-wide' class on body and updates button text.
   * Auto-detection: > 1100px enables wide mode by default.
   */
  function applyWideState() {
    let wideStored = localStorage.getItem('statsWide');
    if (wideStored === null) {
      wideStored = window.innerWidth > 1100 ? '1' : '0';
      localStorage.setItem('statsWide', wideStored);
    }
    const wide = wideStored === '1' && window.innerWidth > 760;
    $('body').toggleClass('stats-wide', wide);
    toggleWidthBtn.text(wide ? 'Обычный режим' : 'Широкий режим');
  }
  /**
   * Apply compact mode layout state
   *
   * Reads preference from localStorage and toggles 'stats-compact' class
   * on body. Updates button text to reflect current state.
   */
  function applyCompactState() {
    const compact = localStorage.getItem('statsCompact') === '1';
    $('body').toggleClass('stats-compact', compact);
    toggleCompactBtn.text(compact ? 'Обычный размер' : 'Compact');
  }

  /**
   * Initialize or reapply theme preference
   *
   * Reads theme from localStorage or detects system preference via
   * prefers-color-scheme media query. Sets 'data-theme' attribute on
   * documentElement and updates toggle button text.
   */
  function applyTheme() {
    let t = localStorage.getItem(THEME_KEY);
    if (!t) {
      // auto from media
      t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, t);
    }
    document.documentElement.setAttribute('data-theme', t);
    toggleThemeBtn.text(t === 'dark' ? 'Светлая' : 'Темная');
  }

  /**
   * Toggle between dark and light theme
   *
   * Switches theme preference and saves to localStorage, then reapplies.
   */
  function toggleTheme() {
    const current = localStorage.getItem(THEME_KEY) || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme();
  }

  /**
   * Update number format toggle button text
   *
   * Updates button text to reflect current formatting mode:
   * - Full mode: "Сокращённо"
   * - Abbreviated mode: "Полные числа"
   */
  function applyNumbersMode() {
    toggleNumbersBtn.text(numbersFull ? 'Сокращённо' : 'Полные числа');
  }

  // Event bindings
  $('#refreshBtn').on('click', () => fetchStats(true));
  searchInput.on(
    'input',
    debounce(() => applyFilterSort(), 200)
  );
  sortSelect.on('change', () => applyFilterSort());
  toggleWidthBtn.on('click', () => {
    const cur = localStorage.getItem('statsWide') === '1';
    localStorage.setItem('statsWide', cur ? '0' : '1');
    localStorage.setItem('statsWideManual', '1');
    applyWideState();
  });
  toggleCompactBtn.on('click', () => {
    const cur = localStorage.getItem('statsCompact') === '1';
    localStorage.setItem('statsCompact', cur ? '0' : '1');
    applyCompactState();
  });
  toggleThemeBtn.on('click', toggleTheme);
  toggleNumbersBtn.on('click', () => {
    numbersFull = !numbersFull;
    localStorage.setItem(NUM_MODE_KEY, numbersFull ? '1' : '0');
    applyNumbersMode();
    renderAggregate();
    render();
  });

  // Resize adaptive wide
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const manual = localStorage.getItem('statsWideManual');
      if (!manual) {
        if (window.innerWidth < 900) localStorage.setItem('statsWide', '0');
        else if (window.innerWidth > 1200) localStorage.setItem('statsWide', '1');
        applyWideState();
      }
    }, 200);
  });

  // Initial state
  applyWideState();
  applyCompactState();
  applyTheme();
  applyNumbersMode();
  if (window.innerWidth < 760 && localStorage.getItem('statsCompact') === null) {
    localStorage.setItem('statsCompact', '1');
    applyCompactState();
  }

  const hadCache = loadCache(); // may render some data
  // Initial network fetch теперь откладывается до валидации API ключа (см. ниже в блоке ожидания зависимостей)
  // Экспортируем refetch для внешнего вызова.
  window.__statsRefetch = fetchStats;
  if (!hadCache) renderAggregate();

  // Auto refresh every 10 minutes while visible
  function scheduleAutoRefresh() {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(
      () => {
        if (document.visibilityState === 'visible') fetchStats();
      },
      10 * 60 * 1000
    );
  }
  scheduleAutoRefresh();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadCache();
      fetchStats();
    }
  });
}

/* ========================================================================
 * DEPENDENCY WAITING & INITIALIZATION
 * ======================================================================== */

/**
 * Wait for jQuery and optionally ApiKey module before initializing
 *
 * Handles race conditions where scripts may load out of order or with
 * CDN latency. Retries up to 40 times (~2 seconds) before giving up.
 *
 * Once dependencies are loaded:
 * 1. Initializes stats module
 * 2. Waits for ApiKey module (if available)
 * 3. Executes initial fetch after API key validation
 */
(function waitForDeps(retries) {
  if (!window.jQuery || !window.$) {
    if (retries > 40) {
      console.error('stats.js: jQuery not loaded after waiting.');
      return;
    }
    return setTimeout(() => waitForDeps(retries + 1), 50);
  }
  __initStats();

  /**
   * Start initial statistics fetch after API key validation
   *
   * Called after ApiKey.ensure() completes. Executes fetch with
   * manual=true flag for visual feedback.
   */
  function startFetch() {
    if (typeof window.__statsRefetch === 'function') {
      window.__statsRefetch(true);
    }
  }

  // Try to use ApiKey module if available, otherwise wait briefly then fallback
  if (window.ApiKey && typeof window.ApiKey.ensure === 'function') {
    window.ApiKey.ensure(startFetch);
    return;
  }
  let attempts = 0;
  (function waitKey() {
    if (window.ApiKey && typeof window.ApiKey.ensure === 'function') {
      window.ApiKey.ensure(startFetch);
    } else if (attempts < 40) {
      // ~2s ожидания
      attempts++;
      setTimeout(waitKey, 50);
    } else {
      console.warn('stats.js: ApiKey module not found, proceeding without key.');
      startFetch();
    }
  })();

  /* ========================================================================
   * BACK TO TOP BUTTON
   * ======================================================================== */

  /**
   * Initialize scroll-to-top button
   *
   * Shows button when user scrolls past 120px threshold. Uses jQuery
   * scroll event handler for simplicity. Smooth scrolls to top on click.
   */
  (function initBackToTop() {
    const $btn = $('#back-to-top');
    if (!$btn.length) return;
    function toggle() {
      const st = window.pageYOffset || document.documentElement.scrollTop;
      if (st > 120) $btn.addClass('show');
      else $btn.removeClass('show');
    }
    toggle();
    $(window).on('scroll', toggle);
    $btn.on('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  })();
})(0);
