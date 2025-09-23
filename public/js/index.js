/**
 * index.js
 * ---------------------------------------------------------------------------
 * Purpose
 *   Search page client logic (originally inline in index.html) extracted for
 *   maintainability. Handles query persistence, API key integration, rendering
 *   of torrent search results, dynamic filter population, and client-side
 *   sorting + filtering.
 *
 * Key Features
 *   - Debounced search execution persisted via localStorage ("search", "sort", "exact")
 *   - Dynamic facet extraction (voices, trackers, years, seasons, categories, quality)
 *   - Accessible updates: aria-busy, minimal empty/loading/no-results states
 *   - API key resolution delegated to modal.apikey.js (graceful 403 handling)
 *   - Clickable tracker badge toggles filter + subtle visual feedback (pulse)
 *   - Defensive guards against absent optional arrays (media, voices, seasons)
 *
 * Data Contracts (selected fields expected on each result item)
 *   title, url, magnet, tracker, sizeName, createTime (epoch ms or ISO),
 *   sid (seeders), pir (leechers), videoInfo{ video,audio,subtitle,voice },
 *   media[] (optional), voices[], seasons[], types[], relased (year), quality
 *
 * Extensibility Notes
 *   - To add another filter dimension: add to filterCache, populate in
 *     initFilterLists(), include logic in applyFilters(), and extend UI markup.
 *   - Build item HTML is centralized in buildItem(); prefer enhancing markup
 *     there instead of ad‑hoc DOM mutations post render.
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

  // Tracker metadata for color coding & tooltip text
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

  let allResults = [];
  let filteredResults = [];

  const filterCache = { voice: [], tracker: [], year: [], season: [], category: [], quality: [] };

  /* ---------------------- Utilities ---------------------- */
  // (debounce utility removed; not currently needed on this page – retained in stats.js if needed later)
  function lsGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function lsSet(key, val) {
    try {
      window.localStorage.setItem(key, val);
    } catch (e) {}
  }
  function fmtDate(ts) {
    const d = new Date(ts);
    return (
      d.getFullYear() +
      '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) +
      '-' +
      ('0' + d.getDate()).slice(-2)
    );
  }

  function setBusy(b) {
    $results.attr('aria-busy', b ? 'true' : 'false');
  }
  function showOnly(el) {
    [$empty, $loading, $noresults].forEach((e) => e.hide());
    if (el) el.show();
  }
  function clearResults() {
    $results.empty();
    $resultsSummary.hide();
  }

  /* ---------------------- Rendering ---------------------- */
  /** Build HTML string for a single search result card. */
  function buildItem(r) {
    const trackerIco = './img/ico/' + r.tracker + '.ico';
    const seeders = r.sid || 0;
    const leechers = r.pir || 0;
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
    const meta = TRACKER_META[r.tracker] || {};
    const trackerColor = meta.color || '#262626';
    const trackerLabel = meta.label || r.tracker;
    const currentTrackerFilter = $('[name="tracker"]', $filterBox).val();
    const isActiveTracker =
      currentTrackerFilter &&
      currentTrackerFilter !== 'Любой' &&
      currentTrackerFilter === r.tracker;
    return `<div class="webResult item">\n  <p><a href="${r.url}" target="_blank" rel="noopener">${r.title}</a></p>\n  <div class="info">${infoBlocks.join('')}</div>\n  <div class="h2">\n    <div class="tracker-badges">\n      <span class="tracker-badge${isActiveTracker ? ' active' : ''}" data-tracker="${r.tracker}" style="--tracker-color:${trackerColor}" aria-label="${trackerLabel}" data-microtip-position="top" role="tooltip"><img class="trackerIco" src="${trackerIco}" alt="${r.tracker}"><span class="tracker-name">${r.tracker}</span></span>\n    </div>\n    <span class="webResultTitle">\n      <span class="stats-left">\n        ${filesIcon}\n        <span class="size">${r.sizeName}</span>\n        <span class="date">${r.dateHuman}</span>\n        <span class="seeders">⬆ ${seeders}</span>\n        <span class="leechers">⬇ ${leechers}</span>\n      </span>\n      <span class="actions-right">\n        <span class="magnet"><a class="magneto ut-download-url" href="${r.magnet}"></a></span>\n        <span class="torrserver-action"><a href="#" class="torrserver-send ts-inline-btn" title="Отправить в TorrServer" aria-label="Отправить в TorrServer"><img src="./img/torrserver.svg" alt="TorrServer" class="ts-inline-ico" /></a></span>\n      </span>\n    </span>\n  </div>\n</div>`;
  }

  /** Render current filteredResults collection into #resultsDiv with summary. */
  function render() {
    clearResults();
    const sortKey = lsGet('sort') || 'sid';
    filteredResults.sort((a, b) =>
      a[sortKey] < b[sortKey] ? 1 : a[sortKey] > b[sortKey] ? -1 : 0
    );
    if (!filteredResults.length) {
      showOnly($noresults);
      return;
    }
    const html = filteredResults.map(buildItem).join('\n');
    $results.html(html);
    $resultsSummary.text(`Найдено: ${filteredResults.length} / Всего: ${allResults.length}`).show();
  }

  /* ---------------------- Filters ---------------------- */
  /** Reset all filter UI controls to their default placeholder values. */
  function resetFilter() {
    $('[name="type"],[name="refine"],[name="exclude"]', $filterBox).val('');
    $(
      '[name="quality"],[name="year"],[name="tracker"],[name="voice"],[name="season"],[name="category"]',
      $filterBox
    ).each(function () {
      $(this).val($('option', this).eq(0).attr('value'));
    });
  }

  /** Populate a named <select> with ordered option list (first becomes default). */
  function populateSelect(name, values) {
    const $sel = $('[name="' + name + '"]', $filterBox).empty();
    values.forEach((v) => $sel.append(`<option value="${v}">${v}</option>`));
    $sel.val(values[0]);
  }

  /** Extract distinct facet values from full result set and seed filter selects. */
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

  /** Apply active filter criteria to allResults producing filteredResults. */
  function applyFilters() {
    filteredResults = allResults.filter((r) => {
      let pass = false,
        any = false,
        fail = false;
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

      if (any) {
        if (fail) return false;
        return pass;
      }
      return true;
    });
  }

  /* ---------------------- API Key Handling ---------------------- */
  // API key handling now centralized in modal.apikey.js (global ApiKey)
  /** Ensure any required API key is available before executing callback. */
  function obtainKey(cb) {
    if (window.ApiKey) {
      window.ApiKey.ensure(cb);
    } else {
      cb();
    }
  }

  /* ---------------------- Search ---------------------- */
  /** Read persisted query + execute search request (with key) then hydrate UI. */
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
      $.ajax({ dataType: 'json', url, cache: false })
        .done((json) => {
          if (Array.isArray(json) && json.length) {
            allResults = json.map((r) => {
              const d = new Date(r.createTime);
              r.date = d.getTime();
              r.dateHuman = fmtDate(d);
              return r;
            });
            initFilterLists();
            applyFilters();
            render();
            $filterBox.show();
            showOnly(null);
          } else {
            showOnly($noresults);
          }
        })
        .fail((xhr) => {
          if (xhr && xhr.status === 403) {
            $noresults.text('Доступ запрещён: неверный или отсутствующий API ключ').show();
          } else {
            showOnly($noresults);
          }
        })
        .always(() => {
          setBusy(false);
          $loading.hide();
        });
    });
  }

  /* ---------------------- Event Wiring ---------------------- */
  $form.on('submit', function (e) {
    e.preventDefault();
    lsSet('search', $input.val());
    performSearch();
  });
  if (lsGet('search')) $input.val(lsGet('search'));

  function applySort(value) {
    lsSet('sort', value);
    if (filteredResults.length) render();
    // Accessibility announcement
    try {
      const live = document.getElementById('liveAnnounce');
      if (live) {
        const labelMap = { sid: 'по количеству сидов', size: 'по размеру', date: 'по дате' };
        // Force text node replacement to trigger aria-live even if same string rapidly
        live.textContent = 'Сортировка: ' + (labelMap[value] || value);
      }
    } catch (e) {
      /* noop */
    }
  }
  $('input[type=radio][name=sort]').on('change', function () {
    applySort(this.value);
  });
  // Provide immediate visual + functional response on first touch (some mobile browsers delay click)
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
  // Extra iOS Edge / Safari safeguard: touch on label triggers immediate change.
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

  // Filter events
  $('select,input', $filterBox).on('change', function () {
    applyFilters();
    render();
  });
  let keyupTimer;
  $('input', $filterBox).on('keyup', function () {
    clearTimeout(keyupTimer);
    keyupTimer = setTimeout(() => {
      applyFilters();
      render();
    }, 200);
  });
  $('.filter-button', $filterBox).on('click', function () {
    resetFilter();
    applyFilters();
    render();
  });

  // Delegated event for file toggles
  $results.on('click', 'span.files[data-files]', function () {
    $(this).closest('.webResult').find('.info > .files').toggleClass('show');
  });

  // Click-to-filter by tracker badge
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
    const el = $(this);
    el.addClass('pulse');
    setTimeout(() => el.removeClass('pulse'), 400);
  });

  // Initial search
  performSearch();

  /* ---------------------- Back To Top ---------------------- */
  (function initBackToTop() {
    const $btn = $('#back-to-top');
    if (!$btn.length) return;
    const smallScreen =
      window.matchMedia('(max-height:700px)').matches ||
      window.matchMedia('(max-width:640px)').matches;
    const threshold = smallScreen ? 90 : 160;
    let visible = false;
    let rafId = null;

    function currentScrollTop() {
      return (
        window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0
      );
    }

    function evaluate() {
      rafId = null;
      const st = currentScrollTop();
      const shouldShow = st > threshold;
      if (shouldShow !== visible) {
        $btn.toggleClass('show', shouldShow);
        visible = shouldShow;
      }
    }

    function onScroll() {
      if (rafId) return;
      rafId = requestAnimationFrame(evaluate);
    }

    // For iOS reliability always use scroll listener; IntersectionObserver sometimes misses when the top is rubber-banded.
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

  /* ---------------------- Mobile Touch Enhancements ---------------------- */
  // Some mobile browsers occasionally miss the change event when quickly tapping labels;
  // delegate label taps to force a change + re-render.
  $('#searchInContainer').on('click', 'label[for^="sort"]', function () {
    const id = $(this).attr('for');
    const $radio = $('#' + id);
    if ($radio.prop('checked')) return; // already active
    $radio.prop('checked', true).trigger('change');
  });
})();
