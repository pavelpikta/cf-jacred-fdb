/**
 * index.js - Torrent Search Page Client Logic
 * ---------------------------------------------------------------------------
 *
 * Purpose
 *   Main client-side JavaScript for the torrent search page. Handles search
 *   query persistence, API key integration, dynamic result rendering with
 *   staggered animations, comprehensive filtering system, and client-side
 *   sorting. Originally inline in index.html, extracted for better maintainability.
 *
 * Key Features
 *   - Search query persistence via localStorage (survives page reloads)
 *   - Dynamic filter population from search results (voice, tracker, year, etc.)
 *   - Client-side filtering and sorting (no additional API calls)
 *   - Staggered animations for result cards (smooth visual feedback)
 *   - API key integration via modal.apikey.js module
 *   - Clickable tracker badges for quick filter application
 *   - Accessibility support (ARIA labels, live regions, keyboard navigation)
 *   - XSS protection via HTML escaping
 *   - Responsive design with mobile touch optimizations
 *
 * Data Structure
 *   Each search result item contains:
 *   - title: string - Torrent title/name
 *   - url: string - Tracker page URL
 *   - magnet: string - Magnet link URI
 *   - tracker: string - Tracker identifier (rutor, rutracker, etc.)
 *   - sizeName: string - Human-readable file size
 *   - createTime: number|string - Creation timestamp (epoch ms or ISO)
 *   - sid: number - Seeders count
 *   - pir: number - Leechers count
 *   - videoInfo: object - { video, audio, subtitle, voice }
 *   - media: array - Optional file list [{ path: string }]
 *   - voices: array - Available voice-over options
 *   - seasons: array - Season numbers (for TV series)
 *   - types: array - Category types
 *   - relased: number - Release year
 *   - quality: number - Video quality (720p, 1080p, etc.)
 *
 * Architecture
 *   - IIFE pattern prevents global namespace pollution
 *   - jQuery-based DOM manipulation for compatibility
 *   - Event delegation for dynamically rendered elements
 *   - Modular filter system (easily extensible)
 *
 * Extensibility
 *   To add a new filter dimension:
 *   1. Add filter name to filterCache object
 *   2. Extract values in initFilterLists()
 *   3. Add filter logic in applyFilters()
 *   4. Add UI control in index.html filter section
 *
 * Performance Notes
 *   - Debounced input filtering (200ms delay)
 *   - Staggered animations use CSS variables for efficiency
 *   - Result caching prevents unnecessary re-renders
 *   - RequestAnimationFrame for scroll-based animations
 */
(function () {
  const API_BASE = '/api';
  const $results = $('#resultsDiv');
  const $resultsSummary = $('#resultsSummary');
  const $empty = $('#empty');
  const $loading = $('#loading');
  const $noresults = $('#noresults');
  const $input = $('#s');
  const $filterBox = $('#filter');
  const $form = $('#search');

  /**
   * Tracker Metadata Configuration
   * Maps tracker identifiers to their display colors and labels for badges.
   * Used for visual distinction and accessibility tooltips.
   */
  const TRACKER_META = {
    rutor: { color: '#9c2d2d', label: 'Rutor: общетематический трекер' },
    selezen: { color: '#10162d', label: 'Selezen: релизы сериалов/фильмов' },
    bitru: { color: '#d32020', label: 'Bitru' },
    rutracker: { color: '#3465a4', label: 'RuTracker: крупнейший русскоязычный трекер' },
    lostfilm: { color: '#4b2f6b', label: 'LostFilm: переводы сериалов' },
    kinozal: { color: '#2d5f8b', label: 'Kinozal' },
    nnmclub: { color: '#1d5c34', label: 'NNM Club' },
    torrentby: { color: '#005f9e', label: 'Torrent.by' },
    anilibria: { color: '#6a2da8', label: 'AniLibria: аниме' },
    anidub: { color: '#a8432f', label: 'AniDub: аниме' },
    megapeer: { color: '#4d4d4d', label: 'MegaPeer' },
    underverse: { color: '#222222', label: 'Underverse' },
    toloka: { color: '#b57600', label: 'Toloka' },
    baibako: { color: '#266d9f', label: 'Baibako' },
    hdrezka: { color: '#3c7e2a', label: 'HDRezka' },
  };

  // State management
  let allResults = [];        // All results from API (unfiltered)
  let filteredResults = [];  // Filtered results based on active filters

  /**
   * Filter Cache
   * Stores unique values extracted from allResults for each filter dimension.
   * Populated once per search to enable filter dropdown population.
   */
  const filterCache = {
    voice: [],      // Voice-over options
    tracker: [],    // Tracker identifiers
    year: [],       // Release years
    season: [],    // Season numbers
    category: [],  // Category types
    quality: []    // Video quality levels
  };

  /* ========================================================================
   * UTILITIES
   * ======================================================================== */

  /**
   * Safe localStorage getter with error handling
   * @param {string} key - localStorage key
   * @returns {string|null} - Stored value or null if unavailable/error
   */
  function lsGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      console.warn('localStorage access denied:', e);
      return null;
    }
  }
  /**
   * Safe localStorage setter with error handling
   * @param {string} key - localStorage key
   * @param {string} val - Value to store
   */
  function lsSet(key, val) {
    try {
      window.localStorage.setItem(key, val);
    } catch (e) {
      console.warn('localStorage write failed:', e);
    }
  }

  /**
   * Format timestamp to YYYY-MM-DD date string
   * @param {number|string} ts - Timestamp (epoch ms or ISO string)
   * @returns {string} - Formatted date string or error message
   */
  function fmtDate(ts) {
    try {
      const d = new Date(ts);
      // Validate date
      if (isNaN(d.getTime())) {
        return 'Invalid date';
      }
      return (
        d.getFullYear() +
        '-' +
        ('0' + (d.getMonth() + 1)).slice(-2) +
        '-' +
        ('0' + d.getDate()).slice(-2)
      );
    } catch (e) {
      console.error('Date formatting error:', e);
      return 'Error';
    }
  }

  /**
   * Update ARIA busy state for results container
   * @param {boolean} b - True if busy (loading), false otherwise
   */
  function setBusy(b) {
    $results.attr('aria-busy', b ? 'true' : 'false');
  }

  /**
   * Show only one message element (empty/loading/noresults)
   * @param {jQuery|null} el - Element to show, or null to hide all
   */
  function showOnly(el) {
    [$empty, $loading, $noresults].forEach((e) => e.hide());
    if (el) el.show();
  }

  /**
   * Clear results container and hide summary
   */
  function clearResults() {
    $results.empty();
    $resultsSummary.hide();
  }

  /* ========================================================================
   * RENDERING
   * ======================================================================== */

  /**
   * Build HTML string for a single search result card
   *
   * Creates a complete result card with:
   * - Title with link to tracker page
   * - Video/audio/subtitle/voice information
   * - File list (if available)
   * - Tracker badge with color coding
   * - Metadata (size, date, seeders, leechers)
   * - Action buttons (magnet link, TorrServer send)
   *
   * @param {Object} r - Result item object
   * @returns {string} - HTML string for the result card
   */
  function buildItem(r) {
    // Sanitize tracker name to prevent XSS (only allow alphanumeric, underscore, hyphen)
    const trackerName = (r.tracker || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
    const trackerIco = `./img/ico/${trackerName}.ico`;
    const seeders = r.sid || 0;
    const leechers = r.pir || 0;

    // Build info blocks for video/audio/subtitle/voice details
    const infoBlocks = [];
    if (r.videoInfo) {
      infoBlocks.push(
        `<div>\n  <div><span>Video</span><div>${r.videoInfo.video || '---'}</div></div>\n  <div><span>Audio</span><div>${r.videoInfo.audio || '---'}</div></div>\n  <div><span>Subtitle</span><div>${r.videoInfo.subtitle || '---'}</div></div>\n  <div><span>Voice</span><div>${r.videoInfo.voice || '---'}</div></div>\n</div>`
      );
    }
    let filesIcon = '';
    if (Array.isArray(r.media) && r.media.length) {
      const list = r.media.map((f) => `<div>${f.path}</div>`).join('');
      infoBlocks.push(
        `<div class="files"><div class="files-title">Файлы</div><div class="files-list">${list}</div></div>`
      );
      filesIcon = `<span class="files" data-files="1">≣ (${r.media.length})</span>`;
    }
    // Get tracker metadata for badge styling and tooltip
    const meta = TRACKER_META[trackerName] || {};
    const trackerColor = meta.color || '#262626';
    const trackerLabel = meta.label || trackerName;

    // Check if this tracker is currently active in filter (for visual highlight)
    const currentTrackerFilter = $('[name="tracker"]', $filterBox).val();
    const isActiveTracker =
      currentTrackerFilter &&
      currentTrackerFilter !== 'Любой' &&
      currentTrackerFilter === trackerName;

    /**
     * Escape HTML to prevent XSS attacks
     * @param {string} str - String to escape
     * @returns {string} - Escaped HTML string
     */
    const escapeHtml = (str) => {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    };
    const safeTitle = escapeHtml(r.title || 'Untitled');
    const safeUrl = (r.url || '#').replace(/^javascript:/i, '');
    return `<div class="webResult item">\n  <p><a href="${safeUrl}" target="_blank" rel="noopener">${safeTitle}</a></p>\n  <div class="info">${infoBlocks.join('')}</div>\n  <div class="h2">\n    <div class="tracker-badges">\n      <span class="tracker-badge${isActiveTracker ? ' active' : ''}" data-tracker="${trackerName}" style="--tracker-color:${trackerColor}" aria-label="${trackerLabel}" data-microtip-position="top" role="tooltip"><img class="trackerIco" src="${trackerIco}" alt="${trackerName}" loading="lazy" onerror="this.style.display='none'"></span>\n    </div>\n    <span class="webResultTitle">\n      <span class="stats-left">\n        ${filesIcon}\n        <span class="size">${r.sizeName}</span>\n        <span class="date">${r.dateHuman}</span>\n        <span class="seeders">⬆ ${seeders}</span>\n        <span class="leechers">⬇ ${leechers}</span>\n      </span>\n      <span class="actions-right">\n        <span class="magnet"><a class="magneto ut-download-url" href="${r.magnet}"></a></span>\n        <span class="torrserver-action"><a href="#" class="torrserver-send ts-inline-btn" title="Отправить в TorrServer" aria-label="Отправить в TorrServer"><img src="./img/torrserver.svg" alt="TorrServer" class="ts-inline-ico" /></a></span>\n      </span>\n    </span>\n  </div>\n</div>`;
  }

  /**
   * Render current filteredResults collection into #resultsDiv with summary
   *
   * Sorts results by selected criteria, builds HTML with staggered animation
   * delays, and displays results summary. Handles empty state gracefully.
   */
  function render() {
    clearResults();

    // Get sort preference from localStorage (default: by seeders)
    const sortKey = lsGet('sort') || 'sid';

    // Sort filtered results in descending order (highest values first)
    filteredResults.sort((a, b) =>
      a[sortKey] < b[sortKey] ? 1 : a[sortKey] > b[sortKey] ? -1 : 0
    );

    // Show "no results" message if nothing to display
    if (!filteredResults.length) {
      showOnly($noresults);
      return;
    }

    // Build HTML with staggered animation delays for smooth visual effect
    // Each card gets a CSS variable and animation delay based on its index
    const html = filteredResults
      .map((r, idx) => {
        const itemHtml = buildItem(r);
        // Inject CSS variables for staggered animation (30ms delay per card)
        return itemHtml.replace(
          '<div class="webResult',
          `<div class="webResult" style="--result-index: ${idx}; animation-delay: ${idx * 0.03}s"`
        );
      })
      .join('\n');

    $results.html(html);
    $resultsSummary
      .text(`Найдено: ${filteredResults.length} / Всего: ${allResults.length}`)
      .show();

    // Force reflow to trigger CSS animations (read offsetHeight to flush layout)
    void $results[0].offsetHeight;
  }

  /* ========================================================================
   * FILTERS
   * ======================================================================== */

  /**
   * Reset all filter UI controls to their default values
   *
   * Clears text inputs and resets select dropdowns to first option ("Любой"/"Любая")
   */
  function resetFilter() {
    $('[name="type"],[name="refine"],[name="exclude"]', $filterBox).val('');
    $(
      '[name="quality"],[name="year"],[name="tracker"],[name="voice"],[name="season"],[name="category"]',
      $filterBox
    ).each(function () {
      $(this).val($('option', this).eq(0).attr('value'));
    });
  }

  /**
   * Populate a named <select> dropdown with option values
   *
   * Empties the select, adds all values as options, and selects the first one.
   *
   * @param {string} name - Filter name (matches name attribute in HTML)
   * @param {Array<string>} values - Array of option values to populate
   */
  function populateSelect(name, values) {
    const $sel = $('[name="' + name + '"]', $filterBox).empty();
    values.forEach((v) => $sel.append(`<option value="${v}">${v}</option>`));
    $sel.val(values[0]);
  }

  /**
   * Extract distinct facet values from allResults and populate filter dropdowns
   *
   * Scans all search results to collect unique values for each filter dimension:
   * - Voices (voice-over options)
   * - Trackers (tracker identifiers)
   * - Years (release years)
   * - Seasons (season numbers for TV series)
   * - Categories (content types)
   * - Quality (video quality levels)
   *
   * Values are sorted and prepended with "Любой"/"Любая" option, then used
   * to populate corresponding <select> dropdowns in the filter UI.
   */
  function initFilterLists() {
    filterCache.voice = ['Любая'];
    filterCache.tracker = ['Любой'];
    const years = [];
    const seasons = [];
    const types = [];
    const quality = [];

    allResults.forEach((r) => {
      (r.voices || []).forEach((v) => {
        if (!filterCache.voice.includes(v)) filterCache.voice.push(v);
      });
      if (!filterCache.tracker.includes(r.tracker)) filterCache.tracker.push(r.tracker);
      if (r.relased && !years.includes(r.relased)) years.push(r.relased);
      if (r.quality && !quality.includes(r.quality)) quality.push(r.quality);
      (r.seasons || []).forEach((s) => {
        if (s && !seasons.includes(s)) seasons.push(s);
      });
      (r.types || []).forEach((t) => {
        if (t && !types.includes(t)) types.push(t);
      });
    });

    years.sort().reverse();
    seasons.sort().reverse();
    types.sort().reverse();
    quality.sort();
    filterCache.year = ['Любой', ...years];
    filterCache.season = ['Любой', ...seasons];
    filterCache.category = ['Любая', ...types];
    filterCache.quality = ['Любое', ...quality];

    populateSelect('voice', filterCache.voice);
    populateSelect('tracker', filterCache.tracker);
    populateSelect('year', filterCache.year);
    populateSelect('season', filterCache.season);
    populateSelect('category', filterCache.category);
    populateSelect('quality', filterCache.quality);
  }

  /**
   * Apply active filter criteria to allResults, producing filteredResults
   *
   * Implements a multi-dimensional filter system where:
   * - All active filters must pass (AND logic)
   * - If no filters are active, all results pass
   * - Filter criteria include: quality, type, tracker, voice, category, season, year
   * - Text filters: refine (must contain) and exclude (must not contain)
   *
   * Filter logic:
   * 1. If any filter is active (any = true):
   *    - Result must pass all active filters (pass = true)
   *    - If any filter fails, result is excluded (fail = true)
   * 2. If no filters active: all results pass
   *
   * @returns {void} - Updates filteredResults array
   */
  function applyFilters() {
    filteredResults = allResults.filter((r) => {
      // Track filter evaluation state
      let pass = false;  // Result passed at least one filter
      let any = false;   // Any filter is active
      let fail = false;  // Result failed at least one filter
      const quality = $('[name="quality"]', $filterBox).val();
      const type = $('[name="type"]', $filterBox).val();
      const year = $('[name="year"]', $filterBox).val();
      const tracker = $('[name="tracker"]', $filterBox).val();
      const voice = $('[name="voice"]', $filterBox).val();
      const season = $('[name="season"]', $filterBox).val();
      const category = $('[name="category"]', $filterBox).val();
      const refine = $('[name="refine"]', $filterBox).val();
      const exclude = $('[name="exclude"]', $filterBox).val();

      if (
        type ||
        refine ||
        exclude ||
        quality !== 'Любое' ||
        year !== 'Любой' ||
        tracker !== 'Любой' ||
        voice !== 'Любая' ||
        season !== 'Любой' ||
        category !== 'Любая'
      )
        any = true;

      if (quality !== 'Любое') {
        if (r.quality == parseInt(quality)) pass = true;
        else fail = true;
      }
      if (type) {
        if (r.videotype == type) pass = true;
        else fail = true;
      }
      if (tracker !== 'Любой') {
        if (r.tracker == tracker) pass = true;
        else fail = true;
      }
      if (voice !== 'Любая') {
        if ((r.voices || []).includes(voice)) pass = true;
        else fail = true;
      }
      if (category !== 'Любая') {
        if ((r.types || []).includes(category)) pass = true;
        else fail = true;
      }
      if (season !== 'Любой') {
        if ((r.seasons || []).includes(parseInt(season))) pass = true;
        else fail = true;
      }
      if (year !== 'Любой') {
        if (r.relased == parseInt(year)) pass = true;
        else fail = true;
      }
      if (refine) {
        if (r.title.toLowerCase().includes(refine.toLowerCase())) pass = true;
        else fail = true;
      }
      if (exclude) {
        if (!r.title.toLowerCase().includes(exclude.toLowerCase())) pass = true;
        else fail = true;
      }

      // Final decision: if any filters active, result must pass all (AND logic)
      if (any) {
        if (fail) return false;  // Exclude if any filter failed
        return pass;             // Include only if all filters passed
      }
      // No filters active: include all results
      return true;
    });
  }

  /* ========================================================================
   * API KEY HANDLING
   * ======================================================================== */

  /**
   * Ensure API key is available before executing callback
   *
   * Delegates to modal.apikey.js module which handles:
   * - Checking if API key is required
   * - Validating existing key
   * - Prompting user for key if needed
   *
   * @param {Function} cb - Callback to execute after key validation
   */
  function obtainKey(cb) {
    if (window.ApiKey) {
      window.ApiKey.ensure(cb);
    } else {
      cb();
    }
  }

  /* ========================================================================
   * SEARCH
   * ======================================================================== */

  /**
   * Read persisted query and execute search request, then hydrate UI
   *
   * Main search orchestration function that:
   * 1. Reads search query from localStorage
   * 2. Clears previous results and resets filters
   * 3. Ensures API key is available (if required)
   * 4. Makes API request to /api/torrents
   * 5. Processes results and populates filters
   * 6. Renders results with staggered animations
   *
   * Error handling:
   * - 403: API key issue (handled by modal.apikey.js)
   * - Timeout: Network timeout message
   * - Other: Generic network error message
   */
  function performSearch() {
    const query = lsGet('search');
    clearResults();
    showOnly(null);
    $filterBox.hide();
    allResults = [];
    filteredResults = [];
    resetFilter();
    $(
      '[name="year"],[name="tracker"],[name="voice"],[name="season"],[name="category"],[name="quality"]',
      $filterBox
    ).empty();

    if (!query) {
      showOnly($empty);
      return;
    }

    showOnly($loading);
    setBusy(true);
    obtainKey(() => {
      const effectiveKey = (window.ApiKey && window.ApiKey.get()) || lsGet('api_key') || '';
      const keyParam = effectiveKey ? '&apikey=' + encodeURIComponent(effectiveKey) : '';
      const url =
        API_BASE +
        '/torrents?search=' +
        encodeURIComponent(query) +
        keyParam +
        (lsGet('exact') == '1' ? '&exact=true' : '');
      $.ajax({
        dataType: 'json',
        url,
        cache: false,
        timeout: 30000, // 30 second timeout
      })
        .done((json) => {
          if (Array.isArray(json) && json.length) {
            // Process results: add date formatting and timestamps
            allResults = json.map((r) => {
              const d = new Date(r.createTime);
              r.date = d.getTime();           // Epoch timestamp for sorting
              r.dateHuman = fmtDate(d);       // Human-readable date string
              return r;
            });

            // Initialize filter dropdowns with unique values from results
            initFilterLists();

            // Apply current filters (if any) to get filteredResults
            applyFilters();

            // Render filtered results with staggered animations
            render();

            // Show filter panel now that we have results
            $filterBox.show();
            showOnly(null);  // Hide all message states
          } else {
            // No results found
            showOnly($noresults);
          }
        })
        .fail((xhr, textStatus, errorThrown) => {
          console.error('Search failed:', { status: xhr?.status, textStatus, errorThrown });
          if (xhr && xhr.status === 403) {
            $noresults.text('Доступ запрещён: неверный или отсутствующий API ключ').show();
          } else if (textStatus === 'timeout') {
            $noresults.text('Превышено время ожидания. Попробуйте снова.').show();
          } else {
            $noresults.text('Ошибка поиска. Проверьте подключение к интернету.').show();
          }
        })
        .always(() => {
          setBusy(false);
          $loading.hide();
        });
    });
  }

  /* ========================================================================
   * EVENT WIRING
   * ======================================================================== */

  // Search form submission
  $form.on('submit', function (e) {
    e.preventDefault();
    lsSet('search', $input.val());
    performSearch();
  });
  if (lsGet('search')) $input.val(lsGet('search'));

  /**
   * Apply sorting and update UI
   *
   * Saves sort preference to localStorage and re-renders results.
   * Also announces sort change for screen readers via aria-live region.
   *
   * @param {string} value - Sort key ('sid', 'size', or 'date')
   */
  function applySort(value) {
    lsSet('sort', value);
    if (filteredResults.length) render();

    // Accessibility: Announce sort change to screen readers
    try {
      const live = document.getElementById('liveAnnounce');
      if (live) {
        const labelMap = { sid: 'по количеству сидов', size: 'по размеру', date: 'по дате' };
        // Force text node replacement to trigger aria-live even if same string rapidly
        const message = 'Сортировка: ' + (labelMap[value] || value);
        live.textContent = message;
        // Also update page title for screen readers
        document.title = `${message} - Поиск торрентов`;
      }
    } catch (e) {
      console.warn('Accessibility announcement failed:', e);
    }
  }
  // Sort radio button change handler
  $('input[type=radio][name=sort]').on('change', function () {
    applySort(this.value);
  });

  // Mobile optimization: Provide immediate response on touchstart/pointerdown
  // Some mobile browsers delay click events by 300ms, causing perceived lag
  $('#searchInContainer').on(
    'touchstart pointerdown',
    'input[type=radio][name=sort]',
    function (e) {
      const already = this.checked;
      if (!already) {
        this.checked = true; // ensure state before potential click delay
        $(this).trigger('change');
      }
    }
  );

  // iOS-specific optimization: Handle label taps directly
  // iOS Safari sometimes misses change events when labels are tapped quickly
  const isIOS = /iP(ad|hone|od)/.test(navigator.userAgent);
  if (isIOS) {
    $('#searchInContainer').on('touchstart', 'label[for^="sort"]', function (e) {
      e.preventDefault(); // prevent 300ms delay / double triggering
      const id = $(this).attr('for');
      const $radio = $('#' + id);
      if (!$radio.prop('checked')) {
        $radio.prop('checked', true);
        $radio.trigger('change');
      }
    });
  }
  /**
   * Update visual active state for sort radio buttons
   *
   * Adds 'active' class to the wrapper of the currently checked sort option
   * for visual feedback (highlighted border/background).
   */
  function updateSortActive() {
    const val = $('input[type=radio][name=sort]:checked').val();
    $('#searchInContainer .icheck-material-cyan').removeClass('active');
    $('#searchInContainer input[type=radio][name=sort][value=' + val + ']').each(function () {
      $(this).closest('.icheck-material-cyan').addClass('active');
    });
  }
  $('input[type=radio][name=sort]').on('change', updateSortActive);
  updateSortActive();
  if (lsGet('sort')) $('input[type=radio][value=' + lsGet('sort') + ']').prop('checked', true);
  if (lsGet('exact') === '1') $('#exactSearch').prop('checked', true);

  $('#exactSearch').on('change', function () {
    lsSet('exact', this.checked ? '1' : '0');
    performSearch();
  });

  // Filter change events: immediately apply filters and re-render
  $('select,input', $filterBox).on('change', function () {
    applyFilters();
    render();
  });

  // Debounced input filtering: wait 200ms after user stops typing
  // Prevents excessive filtering while user is still typing
  let keyupTimer;
  $('input', $filterBox).on('keyup', function () {
    clearTimeout(keyupTimer);
    keyupTimer = setTimeout(() => {
      applyFilters();
      render();
    }, 200);  // 200ms debounce delay
  });
  $('.filter-button', $filterBox).on('click', function () {
    resetFilter();
    applyFilters();
    render();
  });

  // Event delegation: File list toggle (works for dynamically rendered results)
  $results.on('click', 'span.files[data-files]', function () {
    $(this).closest('.webResult').find('.info > .files').toggleClass('show');
  });

  /**
   * Click-to-filter by tracker badge
   *
   * When user clicks a tracker badge:
   * - If tracker is already filtered: clear tracker filter
   * - Otherwise: apply tracker filter and show visual feedback (pulse animation)
   *
   * Uses event delegation for dynamically rendered results.
   */
  $results.on('click', '.tracker-badge', function (e) {
    e.preventDefault();
    const tr = $(this).data('tracker');
    const $sel = $('[name="tracker"]', $filterBox);
    const cur = $sel.val();
    if (cur === tr) {
      $sel.val('Любой');
    } else {
      if (!$('option[value="' + tr + '"]', $sel).length) {
        $sel.append('<option value="' + tr + '">' + tr + '</option>');
      }
      $sel.val(tr);
    }
    applyFilters();
    render();

    // Visual feedback: pulse animation on clicked badge
    const el = $(this);
    el.addClass('pulse');
    setTimeout(() => el.removeClass('pulse'), 400);
  });

  // Initialize: Perform search on page load if query exists in localStorage
  performSearch();

  /* ========================================================================
   * LAST UPDATE (DATABASE)
   * ======================================================================== */

  /**
   * Initialize last database update display
   *
   * Fetches and displays when the database was last updated.
   * Updates every 5 minutes to catch server-side updates.
   * Uses AbortSignal for timeout handling (10s).
   */
  (function initLastUpdate() {
    const el = document.getElementById('lastUpdateDb');
    if (!el) return;
    function apply(text) {
      if (!text) return;
      // Basic sanity: expect something like DD.MM.YYYY HH:MM
      const trimmed = text.trim();
      if (/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(trimmed)) {
        el.textContent = 'Последнее обновление базы: ' + trimmed;
        el.setAttribute('aria-label', `База данных обновлена ${trimmed}`);
      } else {
        el.textContent = 'Последнее обновление базы: ' + trimmed;
      }
    }
    function load() {
      fetch('/lastupdatedb', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000), // 10 second timeout
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then(apply)
        .catch((err) => {
          console.warn('Failed to fetch last update:', err);
        });
    }
    load();
    // Auto-refresh every 5 minutes (server may update database periodically)
    setInterval(load, 5 * 60 * 1000);
  })();

  /* ========================================================================
   * BACK TO TOP BUTTON
   * ======================================================================== */

  /**
   * Initialize scroll-to-top button
   *
   * Shows button when user scrolls past threshold (90px on small screens,
   * 160px on larger screens). Uses requestAnimationFrame for smooth scroll
   * detection. Handles iOS rubber-banding edge cases.
   */
  (function initBackToTop() {
    const $btn = $('#back-to-top');
    if (!$btn.length) return;
    const smallScreen =
      window.matchMedia('(max-height:700px)').matches ||
      window.matchMedia('(max-width:640px)').matches;
    // Adaptive threshold: lower on small screens for better UX
    const threshold = smallScreen ? 90 : 160;
    let visible = false;  // Current visibility state
    let rafId = null;     // RequestAnimationFrame ID for throttling

    /**
     * Get current scroll position (cross-browser compatible)
     * @returns {number} - Scroll position in pixels
     */
    function currentScrollTop() {
      return (
        window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0
      );
    }

    /**
     * Evaluate scroll position and update button visibility
     * Called via requestAnimationFrame for smooth performance
     */
    function evaluate() {
      rafId = null;
      const st = currentScrollTop();
      const shouldShow = st > threshold;

      // Only update DOM if state changed (prevents unnecessary reflows)
      if (shouldShow !== visible) {
        $btn.toggleClass('show', shouldShow);
        visible = shouldShow;
      }
    }

    /**
     * Scroll event handler (throttled via requestAnimationFrame)
     * Prevents multiple concurrent evaluations
     */
    function onScroll() {
      if (rafId) return;  // Already scheduled
      rafId = requestAnimationFrame(evaluate);
    }

    // iOS reliability: Always use scroll listener for rubber-banding edge cases
    // IntersectionObserver can miss updates when Safari rubber-bands at page top
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchmove', onScroll, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(evaluate, 150));
    evaluate();

    $btn.on('click', function (e) {
      e.preventDefault();
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (_) {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    });
  })();

  /* ========================================================================
   * MOBILE TOUCH ENHANCEMENTS
   * ======================================================================== */

  /**
   * Mobile touch optimization: Handle label taps directly
   *
   * Some mobile browsers occasionally miss change events when labels are
   * tapped quickly. This ensures the radio button state updates immediately
   * and triggers change event.
   */
  $('#searchInContainer').on('click', 'label[for^="sort"]', function () {
    const id = $(this).attr('for');
    const $radio = $('#' + id);
    if ($radio.prop('checked')) return; // already active
    $radio.prop('checked', true).trigger('change');
  });
})();
