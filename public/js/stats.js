/**
 * stats.js
 * ---------------------------------------------------------------------------
 * Purpose
 *   Client logic for `stats.html`: fetch and display per‑tracker statistics with
 *   client-side filtering, sorting, layout & theme preferences, and aggregate
 *   totals. Optimizes perceived performance via localStorage caching.
 *
 * Key Features
 *   - Edge API endpoint: GET /api/stats/torrents (optionally with ?apikey=)
 *   - Local cache (5 min TTL) to reduce redundant network calls on tab revisit
 *   - Dynamic card rendering with stale data highlighting (age thresholds)
 *   - Aggregate summary card (sum across trackers) with proportional tracks bar
 *   - Responsive layout: wide mode, compact mode, number formatting modes
 *   - Light/Dark theme toggle (with system preference initialisation)
 *   - Debounced filtering + auto refresh every 10 minutes (visible tab only)
 *
 * Data Contract (item shape excerpt)
 *   {
 *     trackerName: string,
 *     newtor, update, check, alltorrents: number,
 *     lastnewtor: 'dd.mm.yyyy',
 *     tracks: { wait, confirm, skip }
 *   }
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

  let rawData = [];
  let viewData = [];
  let autoRefreshTimer = null;

  const CACHE_KEY = 'statsCacheV1';
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const THEME_KEY = 'statsTheme'; // 'dark' | 'light'
  const NUM_MODE_KEY = 'statsNumbersFull'; // '1' | '0'

  let numbersFull = localStorage.getItem(NUM_MODE_KEY) === '1';

  function debounce(fn, wait = 180) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // Short human number formatter (K/M/B) used in compact number mode.
  function human(num) {
    if (num == null) return '—';
    if (num < 1000) return num + '';
    if (num < 1e6) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    if (num < 1e9) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  }

  // Map last new torrent date -> CSS class indicating staleness thresholds.
  function staleClass(dateStr) {
    if (!dateStr) return '';
    const [d, m, y] = dateStr.split('.').map(Number);
    const dt = new Date(y, m - 1, d);
    const diffDays = (Date.now() - dt.getTime()) / 86400000;
    if (diffDays > 90) return 'very-stale';
    if (diffDays > 7) return 'stale';
    return '';
  }

  /** Load cached stats if still fresh; returns true when used. */
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
  /** Persist current rawData to localStorage for subsequent page visits. */
  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: rawData }));
    } catch (e) {}
  }

  /** Render number in current presentation mode (full vs compact abbreviations). */
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

  /** Build HTML for a single tracker card including proportional tracks bar. */
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

  /** Render or update aggregate summary card (sum of all trackers). */
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

  /** Insert current viewData cards into grid or show empty state. */
  function render() {
    if (!viewData.length) {
      grid.empty();
      emptyState.show();
      counterEl.text('0');
      return;
    }
    emptyState.hide();
    counterEl.text(viewData.length);
    const html = viewData.map(buildCard).join('');
    grid.html(html);
  }

  /** Apply text filter + selected sort mode to rawData producing viewData. */
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

  /** Helper to append current API key (if present) to stats fetch URL. */
  function buildApiKeyParam() {
    try {
      if (window.ApiKey) {
        const k = window.ApiKey.get();
        if (k) return '&apikey=' + encodeURIComponent(k);
      }
      const ls = localStorage.getItem('api_key');
      if (ls) return '&apikey=' + encodeURIComponent(ls);
    } catch (e) {}
    return '';
  }

  /** Fetch latest stats JSON; on success update UI + cache. */
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
          } catch (_) {}
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
  function applyCompactState() {
    const compact = localStorage.getItem('statsCompact') === '1';
    $('body').toggleClass('stats-compact', compact);
    toggleCompactBtn.text(compact ? 'Обычный размер' : 'Compact');
  }

  /** Initialize or reapply theme (persisted or system preference fallback). */
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

  function toggleTheme() {
    const current = localStorage.getItem(THEME_KEY) || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme();
  }

  /** Update toggle text to reflect current number formatting mode. */
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

// Ensure jQuery present before executing (handles race if script order altered or CDN latency)
// Ожидаем jQuery и (по возможности) модуль ApiKey, затем инициализируем и только после ensure() выполняем первый fetch.
(function waitForDeps(retries) {
  if (!window.jQuery || !window.$) {
    if (retries > 40) {
      console.error('stats.js: jQuery not loaded after waiting.');
      return;
    }
    return setTimeout(() => waitForDeps(retries + 1), 50);
  }
  __initStats();

  function startFetch() {
    if (typeof window.__statsRefetch === 'function') {
      window.__statsRefetch(true);
    }
  }

  // Если модуль ApiKey уже загружен – используем его, иначе ждём немного, затем fallback без ключа.
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

  /* ---------------------- Back To Top ---------------------- */
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
