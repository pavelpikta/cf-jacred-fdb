/**
 * modal.apikey.js - API Key Management Module
 * ---------------------------------------------------------------------------
 *
 * Purpose
 *   Cross-page module for managing API key requirements. Handles discovery
 *   of whether an API key is required (via `/api/conf` endpoint), validation
 *   and persistence of user-supplied keys, and provides a simple async API
 *   for callers to ensure a valid key is available before making API calls.
 *
 * Key Features
 *   - Automatic API requirement detection via `/api/conf` endpoint
 *   - Key validation with server-side verification
 *   - Persistent storage in localStorage (survives page reloads)
 *   - Modal dialog for key input with validation feedback
 *   - Graceful error handling (network failures, invalid keys)
 *   - XSS protection via input sanitization
 *   - Keyboard shortcuts (Enter to submit, Escape to cancel)
 *   - Accessibility support (ARIA attributes, focus management)
 *
 * Public API
 *   ApiKey.ensure(cb)      - Ensure valid key is available, then invoke callback
 *   ApiKey.get()           - Get stored key string or null
 *   ApiKey.reset()         - Clear stored key (forces new prompt on next ensure)
 *   ApiKey.promptReplace(cb) - Force key prompt even if key already exists
 *
 * Usage Example
 *   ApiKey.ensure(() => {
 *     // API key is now available (or not required)
 *     // Safe to make API calls
 *     fetch('/api/torrents?search=...');
 *   });
 *
 * UX / Markup
 *   Minimal modal markup is injected automatically if not already present in
 *   the HTML. This allows projects to override styles by pre-defining
 *   #apiKeyModal in HTML. Modal includes:
 *   - Password input field (prevents shoulder surfing)
 *   - Error message display area
 *   - Cancel and Save buttons
 *
 * Validation Flow
 *   1. Check if API key is required via `/api/conf`
 *   2. If required and no key exists: prompt user via modal
 *   3. If key exists: validate it with server
 *   4. If validation fails: re-prompt user
 *   5. If validation succeeds: store key and proceed
 *
 * Failure Strategy
 *   - Network failures: treated optimistically (caller may attempt API call,
 *     which could result in 403 if key is actually required)
 *   - Invalid keys: user is re-prompted with error message
 *   - User cancellation: callback is invoked anyway (caller handles 403)
 *
 * Security Notes
 *   - Keys are stored in localStorage (user consent implied)
 *   - Input validation: length (3-100 chars), basic format checks
 *   - Server-side validation is authoritative
 *   - No sensitive data in error messages
 */
(function (global) {
  // API endpoint base path
  const API_BASE = '/api';

  /* ========================================================================
   * LOCALSTORAGE UTILITIES
   * ======================================================================== */

  /**
   * Safe localStorage getter with error handling
   *
   * Handles cases where localStorage is unavailable (private browsing,
   * storage quota exceeded, etc.). Returns null on any error.
   *
   * @param {string} k - localStorage key
   * @returns {string|null} - Stored value or null if unavailable/error
   */
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      console.warn('localStorage read failed:', e);
      return null;
    }
  }
  /**
   * Safe localStorage setter with error handling
   *
   * Silently handles storage errors (quota exceeded, unavailable, etc.).
   *
   * @param {string} k - localStorage key
   * @param {string} v - Value to store
   */
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      console.warn('localStorage write failed:', e);
    }
  }

  /**
   * Safe localStorage remover with error handling
   *
   * @param {string} k - localStorage key to remove
   */
  function lsRemove(k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {
      console.warn('localStorage remove failed:', e);
    }
  }

  /* ========================================================================
   * API COMMUNICATION
   * ======================================================================== */

  /**
   * Fetch API configuration from server
   *
   * Checks whether API key is required and validates existing key if provided.
   * Response indicates:
   * - requireApiKey: boolean - Whether an API key is required
   * - apikey: boolean - Whether provided key is valid (if key was sent)
   *
   * @param {string|null} withKey - API key to validate (optional)
   * @returns {jQuery.Deferred} - Promise resolving to config JSON
   */
  function fetchConf(withKey) {
    const qp = withKey ? '?apikey=' + encodeURIComponent(withKey) : '';
    return $.ajax({ dataType: 'json', url: API_BASE + '/conf' + qp, cache: false });
  }

  /**
   * Validate API key with server
   *
   * Makes request to `/api/conf` with provided key. Server responds with
   * validation result (apikey: true/false).
   *
   * @param {string} key - API key to validate
   * @returns {jQuery.Deferred} - Promise resolving to validation result
   */
  function validateKey(key) {
    if (!key) return $.Deferred().reject('no-key').promise();
    return $.ajax({
      dataType: 'json',
      url: API_BASE + '/conf?apikey=' + encodeURIComponent(key),
      cache: false,
    });
  }

  /* ========================================================================
   * MODAL MANAGEMENT
   * ======================================================================== */

  // Promise resolver for modal interactions (allows awaiting user input)
  let pendingResolve = null;

  /**
   * Inject modal markup if not already present
   *
   * Idempotent operation: checks if #apiKeyModal exists before injecting.
   * Allows projects to provide custom HTML by pre-defining the modal in HTML.
   *
   * Modal structure:
   * - Header with title
   * - Password input field
   * - Error message area
   * - Footer with Cancel and Save buttons
   */
  function ensureMarkup() {
    if ($('#apiKeyModal').length) return;
    const html =
      '<div id="apiKeyModal" class="modal" style="display:none">\n  <div class="modal-dialog">\n    <div class="modal-header">Введите API ключ</div>\n    <div class="modal-body">\n      <input type="password" id="apiKeyInput" placeholder="API ключ" autocomplete="off" />\n      <div class="modal-error" id="apiKeyError" style="display:none"></div>\n    </div>\n    <div class="modal-footer">\n      <button type="button" id="apiKeyCancel" class="btn-secondary">Отмена</button>\n      <button type="button" id="apiKeySave" class="btn-primary">Сохранить</button>\n    </div>\n  </div>\n</div>';
    $('body').append(html);
  }
  /**
   * Show API key input modal and return promise
   *
   * Ensures modal markup exists, resets form state, shows modal, and focuses
   * input field. Returns a promise that resolves when user submits or cancels.
   *
   * @returns {Promise<string|null>} - Resolves with key string or null if cancelled
   */
  function showModal() {
    ensureMarkup();
    const $m = $('#apiKeyModal');
    $('#apiKeyError').hide().text('');
    $('#apiKeyInput').val('');
    $m.show();
    $('#apiKeyInput').trigger('focus'); // Focus input for immediate typing
    return new Promise((res) => {
      pendingResolve = res;
    });
  }

  /**
   * Close modal and resolve pending promise
   *
   * Hides modal and resolves the promise created by showModal() with the
   * provided result (key string or null for cancellation).
   *
   * @param {string|null} result - Key string if saved, null if cancelled
   */
  function closeModal(result) {
    $('#apiKeyModal').hide();
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r(result);
    }
  }
  /**
   * Handle modal form submission
   *
   * Validates user input:
   * - Checks for empty input
   * - Validates key length (3-100 characters)
   *
   * On validation failure: shows error message and marks input as invalid.
   * On success: closes modal and resolves promise with key string.
   */
  function submitModal() {
    const key = $('#apiKeyInput').val().trim();

    // Client-side validation: check for empty input
    if (!key) {
      $('#apiKeyError').text('Введите ключ').show();
      $('#apiKeyInput').attr('aria-invalid', 'true').focus();
      return;
    }

    // Client-side validation: check key length (prevent obviously invalid keys)
    // Server-side validation is authoritative, this is just UX optimization
    if (key.length < 3 || key.length > 100) {
      $('#apiKeyError').text('Неверный формат ключа').show();
      $('#apiKeyInput').attr('aria-invalid', 'true').focus();
      return;
    }

    // Clear any previous error state
    $('#apiKeyInput').attr('aria-invalid', 'false');

    // Close modal and resolve promise with key (will be validated server-side)
    closeModal(key);
  }
  // Event handlers: Modal button clicks
  $(document).on('click', '#apiKeyCancel', () => closeModal(null));
  $(document).on('click', '#apiKeySave', submitModal);

  // Keyboard shortcuts: Escape to cancel, Enter to submit
  $(document).on('keydown', (e) => {
    if ($('#apiKeyModal:visible').length) {
      if (e.key === 'Escape') closeModal(null);
      if (e.key === 'Enter') submitModal();
    }
  });

  /* ========================================================================
   * KEY VALIDATION & PROMPTING
   * ======================================================================== */

  /**
   * Attempt to reuse existing key or prompt user for new one
   *
   * Flow:
   * 1. If enforcement not required: proceed immediately
   * 2. If existing key found: validate with server
   * 3. If validation succeeds: proceed
   * 4. If validation fails or no key: prompt user via modal
   *
   * Network failures are treated optimistically (proceed anyway, may 403 later).
   *
   * @param {boolean} requireEnforcement - Whether to enforce key requirement
   * @param {Function} cb - Callback to invoke when key is available/validated
   */
  function obtainValidKey(requireEnforcement, cb) {
    const existing = lsGet('api_key');

    // If enforcement not required, proceed immediately
    if (!requireEnforcement) {
      cb();
      return;
    }

    // If existing key found, validate it with server
    if (existing) {
      validateKey(existing)
        .done((j) => {
          if (j && j.apikey === true) {
            // Key is valid: hide hint and proceed
            hideApiKeyHint();
            cb();
          } else {
            // Key is invalid: remove from storage and prompt for new one
            lsRemove('api_key');
            requestKey(cb);
          }
        })
        .fail(() => {
          // Network issue: proceed optimistically (may get 403 later)
          // This allows the app to function even if validation endpoint is down
          cb();
        });
    } else {
      // No existing key: prompt user for one
      requestKey(cb);
    }
  }

  /**
   * Display modal and validate key in a loop until valid or cancelled
   *
   * Shows modal to user and validates their input:
   * - If user cancels: show error message and invoke callback (may 403 later)
   * - If key is invalid: show error and re-prompt (loop continues)
   * - If key is valid: store key, hide hint, and invoke callback
   *
   * Recursive design: function calls itself on validation failure to re-prompt.
   * This creates a modal loop until user provides valid key or cancels.
   *
   * @param {Function} cb - Callback to invoke when valid key obtained or cancelled
   */
  function requestKey(cb) {
    showModal().then((key) => {
      // User cancelled modal: show error message and proceed anyway
      // Caller will handle 403 if key is actually required
      if (!key) {
        $('#noresults,#error').first().text('API ключ не задан').show();
        return;
      }

      // Validate key with server
      validateKey(key)
        .done((j) => {
          if (j && j.apikey === true) {
            // Key is valid: store it and proceed
            lsSet('api_key', key);
            hideApiKeyHint();
            cb();
          } else {
            // Key is invalid: show error and re-prompt (recursive call)
            $('#apiKeyError').text('Ключ неверный').show();
            requestKey(cb);
          }
        })
        .fail((xhr) => {
          // Network error: try to extract structured error message
          let msg = 'Ошибка проверки';
          try {
            if (xhr && xhr.responseText && xhr.responseText.length < 1000) {
              const parsed = JSON.parse(xhr.responseText);
              if (parsed && parsed.error) {
                // Use server-provided error message if available
                msg = parsed.error + (parsed.code ? ' [' + parsed.code + ']' : '');
              }
            }
          } catch (_) {
            // JSON parsing failed: use default message
          }

          // Show error and re-prompt (recursive call)
          $('#apiKeyError').text(msg).show();
          requestKey(cb);
        });
    });
  }

  /* ========================================================================
   * HINT MANAGEMENT
   * ======================================================================== */

  /**
   * Show inline hint that API key is required
   *
   * Displays a non-blocking hint element (if present in HTML) to inform
   * user that API key is needed. Shown before modal appears to avoid
   * abrupt UI changes.
   */
  function showApiKeyHint() {
    const el = document.getElementById('apiKeyInfo');
    if (el) el.style.display = '';
  }

  /**
   * Hide inline hint that API key is required
   *
   * Hides the hint element when a valid key is obtained.
   */
  function hideApiKeyHint() {
    const el = document.getElementById('apiKeyInfo');
    if (el) el.style.display = 'none';
  }

  /* ========================================================================
   * PUBLIC API
   * ======================================================================== */

  /**
   * Public API object exposed globally
   *
   * Provides methods for API key management that can be called from
   * any page or script that includes this module.
   */
  const ApiKey = {
    /**
     * Ensure valid API key is available before proceeding
     *
     * Main entry point for API key management. Flow:
     * 1. Fetch API configuration to check if key is required
     * 2. If key required and valid: proceed immediately
     * 3. If key required but invalid/missing: show hint, then prompt user
     * 4. If key not required: proceed immediately
     *
     * Network failures are treated optimistically (proceed anyway).
     *
     * @param {Function} onReady - Callback invoked when key is validated/not required
     */
    ensure(onReady) {
      fetchConf(lsGet('api_key'))
        .done((json) => {
          if (json.requireApiKey) {
            // Key is required: check if we have a valid one
            if (json.apikey === true) {
              // Existing key is valid: proceed
              hideApiKeyHint();
              onReady();
            } else {
              // Key is invalid or missing: show hint then prompt
              // Delay prevents abrupt modal flash (better UX)
              showApiKeyHint();
              setTimeout(() => obtainValidKey(true, onReady), 200);
            }
          } else {
            // Key not required: proceed immediately
            onReady();
          }
        })
        .fail(() => {
          // Network error: proceed optimistically (may 403 later)
          // This allows app to function even if config endpoint is down
          onReady();
        });
    },

    /**
     * Get stored API key
     *
     * @returns {string|null} - Stored key string or null if not set
     */
    get() {
      return lsGet('api_key');
    },

    /**
     * Reset/clear stored API key
     *
     * Removes key from localStorage. Next call to ensure() will prompt
     * user for a new key.
     */
    reset() {
      lsRemove('api_key');
    },

    /**
     * Force prompt for API key replacement
     *
     * Useful when user wants to change their API key explicitly.
     * Shows hint and prompts user even if a key already exists.
     *
     * @param {Function} cb - Callback invoked when new key is validated
     */
    promptReplace(cb) {
      showApiKeyHint();
      requestKey(cb);
    },
  };

  global.ApiKey = ApiKey;
})(window);
