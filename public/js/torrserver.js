/**
 * torrserver.js
 * ---------------------------------------------------------------------------
 * Purpose
 *   Provide a small UI layer allowing users to configure a TorrServer endpoint
 *   (local or remote) and send magnet links directly from search results.
 *
 * Modes
 *   1. Proxy Mode (default): POST /api/torrserver/add → Cloudflare worker → user TorrServer
 *      - Benefits: avoids CORS issues for LAN/self‑signed hosts. Can leverage CF Access tokens.
 *      - Drawback: Worker cannot reach private RFC1918 addresses (unless special tunnel).
 *   2. Direct Mode: Browser issues POST directly to <tsUrl>/torrents
 *      - Requires the target to allow cross‑origin or same origin (opened tab) + credentials.
 *      - Better for private LAN servers unreachable from Worker.
 *
 * Persisted Config (localStorage key LS_KEY)
 *   { url, username, password, direct }
 *
 * Exposed Global API
 *   TorrServer.openSettings()   : open modal for updating configuration
 *   TorrServer.sendMagnet(magn) : programmatically add magnet respecting current mode
 *   TorrServer.getConf()        : return current config object
 *
 * Security Notes
 *   - Credentials stored in localStorage (user consent) for convenience. Consider
 *     clearing after session on shared machines.
 *   - Basic Auth header built only when username provided.
 */
(function (global) {
  const LS_KEY = 'torrserver_conf_v1';
  // Use CDN-loaded CryptoJS or require if available.
  // If using modules: import CryptoJS from 'crypto-js';
  const CryptoJS = window.CryptoJS || (typeof require === 'function' ? require('crypto-js') : null);
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      console.warn('localStorage read failed:', e);
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      console.warn('localStorage write failed:', e);
    }
  }
  function loadConf() {
    const raw = lsGet(LS_KEY);
    if (!raw) return { url: '', username: '', password: '', direct: false };
    try {
      const j = JSON.parse(raw);
      let decryptedPwd = '';
      if (j.password && j.username && CryptoJS) {
        try {
          const bytes = CryptoJS.AES.decrypt(j.password, j.username);
          decryptedPwd = bytes.toString(CryptoJS.enc.Utf8);
        } catch (e) {
          decryptedPwd = '';
        }
      } else {
        decryptedPwd = j.password || '';
      }
      return {
        url: j.url || '',
        username: j.username || '',
        password: decryptedPwd,
        direct: !!j.direct,
      };
    } catch (e) {
      return { url: '', username: '', password: '', direct: false };
    }
  }
  function saveConf(c) {
    const confToSave = Object.assign({}, c);
    if (confToSave.password && confToSave.username && CryptoJS) {
      // Secure password hashing using PBKDF2
      const iterations = 100000; // Increase iterations for security
      const keySize = 64/4; // 64 bytes, in words: 16 words (1 word = 4 bytes)
      // If possible, use a per-user salt; here we use username
      const salt = confToSave.username || 'torrserver_default_salt';
      confToSave.password = CryptoJS.PBKDF2(confToSave.password, salt, { keySize, iterations }).toString();
    }
    lsSet(LS_KEY, JSON.stringify(confToSave));
  }

  let pendingPromiseResolve = null;
  /** Inject modal markup if not already present (allows custom styling override). */
  function ensureMarkup() {
    if ($('#torrServerModal').length) return;
    const html =
      '<div id="torrServerModal" class="modal" style="display:none">\n  <div class="modal-dialog">\n    <div class="modal-header">Настройки TorrServer</div>\n    <div class="modal-body">\n      <input type="text" id="tsUrl" placeholder="URL (например http://127.0.0.1:8090)" class="mb10" />\n      <input type="text" id="tsUser" placeholder="Имя пользователя (опционально)" class="mb10" />\n      <input type="password" id="tsPass" placeholder="Пароль (опционально)" class="mb10" />\n      <label class="ts-checkbox"><input type="checkbox" id="tsDirect" /> <span>Прямой режим (из браузера)</span></label>\n      <div class="ts-actions-row">\n        <button type="button" id="tsTest" class="btn-tertiary ts-test-btn">Тест соединения</button>\n      </div>\n      <div class="ts-hint">Добавление торрентов всегда через /torrents. Прямой режим требует CORS допуска или авторизованной вкладки.</div>\n      <div class="modal-error" id="tsErr" style="display:none"></div>\n    </div>\n    <div class="modal-footer">\n      <button type="button" id="tsCancel" class="btn-secondary">Отмена</button>\n      <button type="button" id="tsSave" class="btn-primary">Сохранить</button>\n    </div>\n  </div>\n</div>';
    $('body').append(html);
  }
  function showModal() {
    ensureMarkup();
    const c = loadConf();
    $('#tsUrl').val(c.url);
    $('#tsUser').val(c.username);
    $('#tsPass').val(c.password);
    $('#tsDirect').prop('checked', !!c.direct);
    $('#tsErr').hide().text('');
    $('#torrServerModal').show();
    return new Promise((res) => {
      pendingPromiseResolve = res;
    });
  }
  function closeModal(res) {
    $('#torrServerModal').hide();
    if (pendingPromiseResolve) {
      const r = pendingPromiseResolve;
      pendingPromiseResolve = null;
      r(res);
    }
  }
  function submitModal() {
    const url = $('#tsUrl').val().trim();
    const username = $('#tsUser').val().trim();
    const password = $('#tsPass').val();
    const direct = $('#tsDirect').is(':checked');
    if (!url) {
      $('#tsErr').text('Укажите URL').show();
      $('#tsUrl').attr('aria-invalid', 'true').focus();
      return;
    }
    // Validate URL format
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        $('#tsErr').text('Используйте http:// или https://').show();
        $('#tsUrl').attr('aria-invalid', 'true').focus();
        return;
      }
    } catch (e) {
      $('#tsErr').text('Неверный формат URL').show();
      $('#tsUrl').attr('aria-invalid', 'true').focus();
      return;
    }
    $('#tsUrl').attr('aria-invalid', 'false');
    saveConf({ url, username, password, direct });
    closeModal(true);
  }
  $(document).on('click', '#tsCancel', () => closeModal(false));
  $(document).on('click', '#tsSave', submitModal);
  $(document).on('keydown', (e) => {
    if ($('#torrServerModal:visible').length) {
      if (e.key === 'Escape') closeModal(false);
      if (e.key === 'Enter') submitModal();
    }
  });

  // Toast
  function ensureToast() {
    if ($('#toastBox').length) return;
    $('body').append(
      '<div id="toastBox" style="position:fixed;bottom:20px;right:20px;z-index:1100;display:flex;flex-direction:column;gap:8px;"></div>'
    );
  }
  function toast(msg, type) {
    ensureToast();
    const id = 't' + Date.now();
    const bg = type === 'err' ? '#c0392b' : '#2d7d46';
    const el = $('<div></div>')
      .attr('id', id)
      .css({
        background: bg,
        color: '#fff',
        padding: '10px 14px',
        borderRadius: '6px',
        fontSize: '.85rem',
        boxShadow: '0 4px 12px rgba(0,0,0,.4)',
        maxWidth: '320px',
      })
      .text(msg);
    $('#toastBox').append(el);
    setTimeout(() => {
      el.fadeOut(400, () => el.remove());
    }, 4000);
  }

  /** Send magnet directly to user-specified TorrServer (browser -> server). */
  function directSend(magnet, conf) {
    const debug = !!localStorage.getItem('torrserver_debug');
    const base = conf.url.replace(/\/$/, '');
    const addUrl = base + '/torrents';
    const auth = conf.username
      ? 'Basic ' + btoa(unescape(encodeURIComponent(conf.username + ':' + conf.password)))
      : null;
    const bodyStr = JSON.stringify({ action: 'add', link: magnet });
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (auth) headers['Authorization'] = auth;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    fetch(addUrl, {
      method: 'POST',
      headers,
      body: bodyStr,
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((r) => {
        clearTimeout(timeoutId);
        return r.text().then((t) => ({ r, t }));
      })
      .then(({ r, t }) => {
        if (r.ok) {
          toast('Отправлено (прямой режим)', 'ok');
        } else {
          let msg = 'Прямой (' + r.status + ')';
          if (r.status === 403)
            msg +=
              ' — возможно Cloudflare / Access cookie отсутствует. Откройте ' +
              base +
              ' во вкладке и авторизуйтесь';
          if (r.status === 401) msg += ' — проверьте логин/пароль';
          if (!t) msg += ' — пустой ответ';
          toast(msg, 'err');
          if (debug) {
            console.warn('Direct TorrServer debug', { status: r.status, body: t?.slice(0, 400) });
          }
        }
      })
      .catch((e) => {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
          toast('Превышено время ожидания', 'err');
        } else {
          toast('Прямой режим: сеть/корс ошибка', 'err');
        }
        if (debug) {
          console.warn('Direct TorrServer network error', e);
        }
      });
  }

  /** Entry point for UI buttons: chooses proxy vs direct mode. */
  function sendMagnet(magnet) {
    const conf = loadConf();
    if (!conf.url) {
      openSettings();
      return;
    }
    if (conf.direct) {
      directSend(magnet, conf);
      return;
    }
    const debug = !!localStorage.getItem('torrserver_debug');
    const showCodes = debug; // expose error code only when debug flag set
    fetch('/api/torrserver/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        magnet,
        url: conf.url,
        username: conf.username,
        password: conf.password,
        debug,
      }),
    })
      .then((r) => r.json().catch(() => ({ ok: false, error: 'bad-json-response' })))
      .then((j) => {
        if (j.ok) {
          toast('Отправлено в TorrServer', 'ok');
        } else {
          let msg = 'Ошибка (' + (j.status || '?') + ')';
          if (j.error) msg += ': ' + j.error;
          if (showCodes && j.code) msg += ' [' + j.code + ']';
          if (j.authHint) msg += ' | ' + j.authHint;
          if (j.cloudflareAccess)
            msg +=
              ' | Cloudflare Access/Firewall блокирует запрос – нужен публичный доступ или прямой режим';
          toast(msg, 'err');
          if (j.attempts) {
            console.warn('TorrServer attempts debug', j.attempts);
          }
        }
      })
      .catch(() => toast('Ошибка сети', 'err'));
  }

  function openSettings() {
    showModal().then((changed) => {
      if (changed) {
        toast('Настройки сохранены', 'ok');
      }
    });
  }

  // Тест соединения
  $(document).on('click', '#tsTest', function () {
    const url = $('#tsUrl').val().trim();
    if (!url) {
      $('#tsErr').text('Укажите URL').show();
      return;
    }
    $('#tsErr').hide().text('');
    const username = $('#tsUser').val().trim();
    const password = $('#tsPass').val();
    const debug = !!localStorage.getItem('torrserver_debug');
    const btn = $('#tsTest');
    btn.prop('disabled', true).text('Тест...');
    fetch('/api/torrserver/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, username, password, debug }),
    })
      .then((r) => r.json().catch(() => ({ ok: false, error: 'bad-json-response' })))
      .then((j) => {
        btn.prop('disabled', false).text('Тест соединения');
        if (j.ok) {
          const ver = j.version ? ' v' + j.version : '';
          toast('Тест OK (' + j.status + ver + ')', 'ok');
        } else {
          let msg = 'Не удалось (' + (j.status || '?') + ')';
          if (j.authHint) msg += ' | ' + j.authHint;
          if (j.cloudflareAccess) msg += ' | Cloudflare Access блокирует';
          if (j.error) msg += ' | ' + j.error;
          if (debug && j.code) msg += ' [' + j.code + ']';
          $('#tsErr').text(msg).show();
        }
      })
      .catch((e) => {
        btn.prop('disabled', false).text('Тест соединения');
        $('#tsErr')
          .text('Сеть: ' + e.message)
          .show();
      });
  });

  const TorrServer = { openSettings, sendMagnet, getConf: loadConf };
  global.TorrServer = TorrServer;

  // Hook buttons after dynamic results rendering: delegated event
  $(document).on('click', 'a.torrserver-send', function (e) {
    e.preventDefault();
    const magnet = $(this).closest('.webResult').find('a.magneto').attr('href');
    if (magnet) sendMagnet(magnet);
  });
  $(document).on('click', '#torrServerSettingsBtn', function (e) {
    e.preventDefault();
    openSettings();
  });
})(window);
