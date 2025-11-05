/**
 * modal.apikey.js
 * ---------------------------------------------------------------------------
 * Purpose
 *   Cross‑page module for discovering whether an API key is required (via
 *   `/api/conf`), validating / persisting the user supplied key, and exposing
 *   a simple async ensure(onReady) contract to callers.
 *
 * Public API
 *   ApiKey.ensure(cb)  : Resolve requirement -> if needed validate/procure key -> invoke cb()
 *   ApiKey.get()       : Return stored key string or null
 *   ApiKey.reset()     : Forget stored key (forces new prompt next ensure)
 *   ApiKey.promptReplace(cb) : Force prompt even if a key is present
 *
 * UX / Markup
 *   Minimal modal markup injected automatically if not already present. Allows
 *   a project to override styles by pre‑defining #apiKeyModal in HTML.
 *
 * Failure Strategy
 *   Network failures during validation are treated optimistically (caller may
 *   still attempt API call which could 403). Invalid keys re‑prompt the user.
 */
(function (global) {
  const API_BASE = '/api';
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
  function lsRemove(k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {
      console.warn('localStorage remove failed:', e);
    }
  }

  function fetchConf(withKey) {
    const qp = withKey ? '?apikey=' + encodeURIComponent(withKey) : '';
    return $.ajax({ dataType: 'json', url: API_BASE + '/conf' + qp, cache: false });
  }
  function validateKey(key) {
    if (!key) return $.Deferred().reject('no-key').promise();
    return $.ajax({
      dataType: 'json',
      url: API_BASE + '/conf?apikey=' + encodeURIComponent(key),
      cache: false,
    });
  }

  let pendingResolve = null;
  /** Inject modal markup (idempotent) if integrator hasn't provided custom HTML. */
  function ensureMarkup() {
    if ($('#apiKeyModal').length) return;
    const html =
      '<div id="apiKeyModal" class="modal" style="display:none">\n  <div class="modal-dialog">\n    <div class="modal-header">Введите API ключ</div>\n    <div class="modal-body">\n      <input type="password" id="apiKeyInput" placeholder="API ключ" autocomplete="off" />\n      <div class="modal-error" id="apiKeyError" style="display:none"></div>\n    </div>\n    <div class="modal-footer">\n      <button type="button" id="apiKeyCancel" class="btn-secondary">Отмена</button>\n      <button type="button" id="apiKeySave" class="btn-primary">Сохранить</button>\n    </div>\n  </div>\n</div>';
    $('body').append(html);
  }
  function showModal() {
    ensureMarkup();
    const $m = $('#apiKeyModal');
    $('#apiKeyError').hide().text('');
    $('#apiKeyInput').val('');
    $m.show();
    $('#apiKeyInput').trigger('focus');
    return new Promise((res) => {
      pendingResolve = res;
    });
  }
  function closeModal(result) {
    $('#apiKeyModal').hide();
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r(result);
    }
  }
  function submitModal() {
    const key = $('#apiKeyInput').val().trim();
    if (!key) {
      $('#apiKeyError').text('Введите ключ').show();
      $('#apiKeyInput').attr('aria-invalid', 'true').focus();
      return;
    }
    // Validate key format (alphanumeric, reasonable length)
    if (key.length < 3 || key.length > 100) {
      $('#apiKeyError').text('Неверный формат ключа').show();
      $('#apiKeyInput').attr('aria-invalid', 'true').focus();
      return;
    }
    $('#apiKeyInput').attr('aria-invalid', 'false');
    closeModal(key);
  }
  $(document).on('click', '#apiKeyCancel', () => closeModal(null));
  $(document).on('click', '#apiKeySave', submitModal);
  $(document).on('keydown', (e) => {
    if ($('#apiKeyModal:visible').length) {
      if (e.key === 'Escape') closeModal(null);
      if (e.key === 'Enter') submitModal();
    }
  });

  /** Attempt to reuse existing key; if invalid or absent prompt user. */
  function obtainValidKey(requireEnforcement, cb) {
    const existing = lsGet('api_key');
    if (!requireEnforcement) {
      cb();
      return;
    }
    if (existing) {
      validateKey(existing)
        .done((j) => {
          if (j && j.apikey === true) {
            hideApiKeyHint();
            cb();
          } else {
            lsRemove('api_key');
            requestKey(cb);
          }
        })
        .fail(() => {
          // network issue: allow attempt, may 403 later
          cb();
        });
    } else {
      requestKey(cb);
    }
  }
  /** Display modal loop until user supplies a valid key or cancels (cancel => no key). */
  function requestKey(cb) {
    showModal().then((key) => {
      if (!key) {
        // user canceled
        $('#noresults,#error').first().text('API ключ не задан').show();
        return;
      }
      validateKey(key)
        .done((j) => {
          if (j && j.apikey === true) {
            lsSet('api_key', key);
            hideApiKeyHint();
            cb();
          } else {
            $('#apiKeyError').text('Ключ неверный').show();
            requestKey(cb);
          }
        })
        .fail((xhr) => {
          // Try structured error JSON
          let msg = 'Ошибка проверки';
          try {
            if (xhr && xhr.responseText && xhr.responseText.length < 1000) {
              const parsed = JSON.parse(xhr.responseText);
              if (parsed && parsed.error) {
                msg = parsed.error + (parsed.code ? ' [' + parsed.code + ']' : '');
              }
            }
          } catch (_) {}
          $('#apiKeyError').text(msg).show();
          requestKey(cb);
        });
    });
  }

  function showApiKeyHint() {
    const el = document.getElementById('apiKeyInfo');
    if (el) el.style.display = '';
  }
  function hideApiKeyHint() {
    const el = document.getElementById('apiKeyInfo');
    if (el) el.style.display = 'none';
  }

  const ApiKey = {
    ensure(onReady) {
      fetchConf(lsGet('api_key'))
        .done((json) => {
          if (json.requireApiKey) {
            // If key required, json.apikey true => valid; false or undefined => invalid/not supplied
            if (json.apikey === true) {
              hideApiKeyHint();
              onReady();
            } else {
              // Show inline hint first (non-blocking), then prompt shortly after to avoid abrupt modal flash.
              showApiKeyHint();
              setTimeout(() => obtainValidKey(true, onReady), 200);
            }
          } else {
            onReady();
          }
        })
        .fail(() => {
          // optimistic fallback
          onReady();
        });
    },
    get() {
      return lsGet('api_key');
    },
    reset() {
      lsRemove('api_key');
    },
    // expose for pages needing explicit re-prompt
    promptReplace(cb) {
      showApiKeyHint();
      requestKey(cb);
    },
  };

  global.ApiKey = ApiKey;
})(window);
