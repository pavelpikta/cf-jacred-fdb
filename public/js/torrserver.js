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
 * Secure Storage Strategy
 *   - URL and username: Stored in localStorage (non-sensitive data)
 *   - Password: Stored with encryption using Web Crypto API
 *     - OPTIONAL Master Password: When set, provides real security by deriving encryption
 *       key from user-provided master password (not predictable). Master password is
 *       stored only as a hash (PBKDF2 with 100,000 iterations) and never stored in plain text.
 *     - Fallback Obfuscation: When no master password is set, passwords are obfuscated
 *       with AES-GCM using a predictable origin-derived key. WARNING: This provides NO
 *       real security - the key is predictable and can be easily reconstructed by any
 *       code running on the same origin. This is obfuscation, not encryption.
 *     - Falls back to session memory if Web Crypto API is unavailable
 *     - Storage location depends on persistPassword preference:
 *       - If persistPassword=false (default): sessionStorage (cleared when tab closes)
 *       - If persistPassword=true: localStorage (persists across sessions)
 *     - Both storage methods use the same encryption/obfuscation (AES-GCM with PBKDF2)
 *   - Configuration key: LS_KEY = 'torrserver_conf_v1'
 *
 * Exposed Global API
 *   TorrServer.openSettings()   : open modal for updating configuration
 *   TorrServer.sendMagnet(magn) : programmatically add magnet respecting current mode
 *   TorrServer.getConf()        : return current config object (without password)
 *   TorrServer.getConfWithPassword() : return config with password from obfuscated storage
 *   TorrServer.clearPassword(url, username)  : clear password from obfuscated storage
 *
 * Security Implementation
 *   - OPTIONAL Master Password: Users can set a master password for real encryption security.
 *     When set, the encryption key is derived from the master password (not predictable),
 *     providing real security. Master password is verified using PBKDF2 with 100,000 iterations
 *     and constant-time comparison to prevent timing attacks. Master password is stored only
 *     as a hash and never in plain text.
 *   - Fallback Obfuscation: When no master password is set, passwords are obfuscated using
 *     Web Crypto API (AES-GCM with PBKDF2 key derivation) with a predictable origin-derived
 *     key. WARNING: This provides NO real security - any code running on the same origin can
 *     reconstruct the key and decrypt passwords. This is obfuscation to prevent casual
 *     inspection, NOT protection against determined attackers.
 *   - Storage location: sessionStorage (default, cleared when tab closes) or localStorage
 *     (if persistPassword=true)
 *   - If Web Crypto API is unavailable, passwords fall back to plain session memory
 *   - Session memory passwords are cleared on page reload
 *   - Master password is stored in session memory only (never persisted) after verification
 *   - Basic Auth header is built only when both username and password are provided
 *   - All URL inputs are validated to ensure proper format (http:// or https://)
 *   - Each password is stored with a unique key based on URL + username combination
 */
(function (global) {
  const LS_KEY = 'torrserver_conf_v1';
  const PWD_STORAGE_PREFIX = 'torrserver_pwd_';
  const MASTER_PWD_HASH_KEY = 'torrserver_master_pwd_hash_v1';
  const MASTER_PWD_SALT_KEY = 'torrserver_master_pwd_salt_v1';
  const REQUEST_TIMEOUT_MS = 15000;
  const TOAST_DISPLAY_MS = 4000;
  const IV_LENGTH = 12; // 96-bit IV for AES-GCM
  const PBKDF2_ITERATIONS = 100000;
  const MASTER_PWD_PBKDF2_ITERATIONS = 100000; // Iterations for master password hashing

  // Default configuration object
  const DEFAULT_CONFIG = {
    url: '',
    username: '',
    password: '',
    direct: false,
    persistPassword: false,
  };

  // Session-only password cache keyed by storage key (not persisted)
  // Maps storageKey (from getPasswordStorageKey) to decrypted password
  const sessionPasswordCache = new Map();

  // Session-only master password cache (not persisted)
  // Stores the master password in memory only for the current session
  let sessionMasterPassword = null;

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

  /**
   * Get the appropriate storage (localStorage or sessionStorage) based on persistPassword preference.
   *
   * @param {boolean} persistPassword - If true, return localStorage; if false, return sessionStorage
   * @returns {Storage} The appropriate storage object
   */
  function getStorage(persistPassword) {
    return persistPassword ? localStorage : sessionStorage;
  }

  /**
   * Generate a unique storage key for encrypted password based on URL and username.
   * This ensures credentials are stored per TorrServer instance.
   * Normalizes URL by lowercasing protocol and host to prevent duplicate storage keys.
   *
   * @param {string} url - TorrServer URL
   * @param {string} username - Username (optional)
   * @returns {string} Unique storage key for the encrypted password
   */
  function getPasswordStorageKey(url, username) {
    let normalizedUrl = (url || '').trim();
    if (normalizedUrl) {
      try {
        const urlObj = new URL(normalizedUrl);
        // Normalize protocol and host to lowercase
        normalizedUrl = `${urlObj.protocol.toLowerCase()}//${urlObj.host.toLowerCase()}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
        // Remove trailing slash
        normalizedUrl = normalizedUrl.replace(/\/$/, '');
      } catch (e) {
        // If URL parsing fails, fall back to simple normalization
        normalizedUrl = normalizedUrl.replace(/\/$/, '');
      }
    }
    const normalizedUser = (username || '').trim().toLowerCase();
    return `${PWD_STORAGE_PREFIX}${normalizedUrl}_${normalizedUser}`;
  }

  /**
   * Check if Web Crypto API is available for encryption.
   *
   * @returns {boolean} True if Web Crypto API is supported
   */
  function isWebCryptoAvailable() {
    return (
      typeof crypto !== 'undefined' &&
      crypto.subtle &&
      typeof crypto.subtle.encrypt === 'function' &&
      typeof crypto.subtle.decrypt === 'function'
    );
  }

  /**
   * Check if a master password is set (by checking for stored hash).
   *
   * @returns {boolean} True if master password is configured
   */
  function hasMasterPassword() {
    return !!lsGet(MASTER_PWD_HASH_KEY);
  }

  /**
   * Hash a master password using PBKDF2 for verification purposes.
   *
   * @param {string} masterPassword - Master password to hash
   * @param {Uint8Array} salt - Salt for hashing
   * @returns {Promise<ArrayBuffer>} Hashed password
   */
  async function hashMasterPassword(masterPassword, salt) {
    if (!isWebCryptoAvailable()) {
      throw new Error('Web Crypto API not available');
    }

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(masterPassword),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    return crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: MASTER_PWD_PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      256 // 256 bits = 32 bytes
    );
  }

  /**
   * Verify a master password against the stored hash.
   *
   * @param {string} masterPassword - Master password to verify
   * @returns {Promise<boolean>} True if password matches
   */
  async function verifyMasterPassword(masterPassword) {
    if (!masterPassword) return false;

    const storedHashB64 = lsGet(MASTER_PWD_HASH_KEY);
    const storedSaltB64 = lsGet(MASTER_PWD_SALT_KEY);

    if (!storedHashB64 || !storedSaltB64) return false;

    try {
      const storedHash = Uint8Array.from(atob(storedHashB64), (c) => c.charCodeAt(0));
      const salt = Uint8Array.from(atob(storedSaltB64), (c) => c.charCodeAt(0));

      const computedHash = await hashMasterPassword(masterPassword, salt);
      const computedHashArray = new Uint8Array(computedHash);

      // Constant-time comparison to prevent timing attacks
      if (storedHash.length !== computedHashArray.length) return false;
      let result = 0;
      for (let i = 0; i < storedHash.length; i++) {
        result |= storedHash[i] ^ computedHashArray[i];
      }
      return result === 0;
    } catch (e) {
      console.warn('Master password verification failed:', e);
      return false;
    }
  }

  /**
   * Set or update the master password.
   * Stores only the hash and salt, never the password itself.
   *
   * @param {string} masterPassword - Master password to set (empty string to clear)
   * @returns {Promise<boolean>} True if successful
   */
  async function setMasterPassword(masterPassword) {
    if (!masterPassword) {
      // Clear master password
      lsRemove(MASTER_PWD_HASH_KEY);
      lsRemove(MASTER_PWD_SALT_KEY);
      sessionMasterPassword = null;
      return true;
    }

    if (!isWebCryptoAvailable()) {
      throw new Error('Web Crypto API not available');
    }

    try {
      // Generate a random salt for this master password
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await hashMasterPassword(masterPassword, salt);

      // Store hash and salt (never the password itself)
      lsSet(MASTER_PWD_HASH_KEY, btoa(String.fromCharCode(...new Uint8Array(hash))));
      lsSet(MASTER_PWD_SALT_KEY, btoa(String.fromCharCode(...salt)));

      // Store in session memory for faster access
      sessionMasterPassword = masterPassword;

      return true;
    } catch (e) {
      console.warn('Failed to set master password:', e);
      return false;
    }
  }

  /**
   * Derive an encryption key from master password (if set) or origin (fallback obfuscation).
   * When a master password is set, the key is derived from the master password, providing
   * real security. When no master password is set, falls back to origin-based obfuscation.
   *
   * WARNING: Origin-based obfuscation provides NO real security - the key is predictable
   * and can be easily reconstructed by any code running on the same origin.
   *
   * @returns {Promise<CryptoKey>} Encryption key for AES-GCM
   */
  async function deriveEncryptionKey() {
    if (!isWebCryptoAvailable()) {
      throw new Error('Web Crypto API not available');
    }

    // If master password is set and available in session, use it for real encryption
    if (sessionMasterPassword) {
      // Use a constant salt based on origin + master password for key derivation
      // The master password provides the security, the origin salt ensures uniqueness per origin
      const salt = new TextEncoder().encode(window.location.origin + 'torrserver_master_salt_v1');
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(sessionMasterPassword),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
      );

      return crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: PBKDF2_ITERATIONS,
          hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }

    // Fallback: Use origin-based obfuscation (NO real security)
    // This is only for backward compatibility and when no master password is set
    return deriveOriginBasedKey();
  }

  /**
   * Encrypt password using Web Crypto API.
   *
   * @param {string} password - Password to encrypt
   * @returns {Promise<string|null>} Base64-encoded encrypted password with IV, or null if encryption failed/unavailable
   */
  async function encryptPassword(password) {
    if (!password) return null;
    if (!isWebCryptoAvailable()) {
      // Web Crypto API not available - return null to indicate encryption not possible
      return null;
    }

    try {
      const key = await deriveEncryptionKey();
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
      const encodedPassword = new TextEncoder().encode(password);

      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        key,
        encodedPassword
      );

      // Combine IV and encrypted data, then encode as base64
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encrypted), iv.length);

      return btoa(String.fromCharCode(...combined));
    } catch (e) {
      console.warn('Password encryption failed:', e);
      return null; // Return null to indicate encryption failed
    }
  }

  /**
   * Derive encryption key using origin-based obfuscation (fallback method).
   * This is used for backward compatibility with passwords encrypted before
   * master password was introduced.
   *
   * @returns {Promise<CryptoKey>} Encryption key for AES-GCM
   */
  async function deriveOriginBasedKey() {
    if (!isWebCryptoAvailable()) {
      throw new Error('Web Crypto API not available');
    }

    const salt = new TextEncoder().encode(window.location.origin + 'torrserver_salt_v1');
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(window.location.origin),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Decrypt password using Web Crypto API.
   * Tries master password first (if set), then falls back to origin-based obfuscation
   * for backward compatibility with passwords encrypted before master password was introduced.
   *
   * @param {string} encryptedPassword - Base64-encoded encrypted password with IV
   * @returns {Promise<string>} Decrypted password
   */
  async function decryptPassword(encryptedPassword) {
    if (!encryptedPassword) return '';
    if (!isWebCryptoAvailable()) {
      // Fallback: return as-is (plain text from session memory)
      return encryptedPassword;
    }

    const combined = Uint8Array.from(atob(encryptedPassword), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, IV_LENGTH);
    const encrypted = combined.slice(IV_LENGTH);

    // Try master password first (if set)
    if (sessionMasterPassword) {
      try {
        const key = await deriveEncryptionKey();
        const decrypted = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: iv,
          },
          key,
          encrypted
        );
        return new TextDecoder().decode(decrypted);
      } catch (e) {
        // Master password decryption failed, try origin-based obfuscation
        // This handles backward compatibility with old passwords
      }
    }

    // Try origin-based obfuscation (for backward compatibility)
    try {
      const key = await deriveOriginBasedKey();
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        key,
        encrypted
      );
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.warn('Password decryption failed:', e);
      return ''; // Return empty on failure
    }
  }

  /**
   * Load non-sensitive configuration from localStorage.
   * Password is NOT loaded from storage - use getPassword() to retrieve it from obfuscated storage.
   *
   * @returns {Object} Configuration object with url, username, direct, persistPassword (password always empty)
   */
  function loadConf() {
    const raw = lsGet(LS_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    try {
      const j = JSON.parse(raw);
      // Only load non-sensitive data - password is never stored in localStorage (unless encrypted with persistPassword)
      return {
        url: j.url || '',
        username: j.username || '',
        password: '', // Always empty - password must be retrieved separately via getPassword()
        direct: !!j.direct,
        persistPassword: !!j.persistPassword, // Default to false for backward compatibility
      };
    } catch (e) {
      console.warn('Failed to parse configuration:', e);
      return { ...DEFAULT_CONFIG };
    }
  }

  /**
   * Save only non-sensitive configuration to localStorage.
   * Password is NOT saved here - use setPassword() to store in obfuscated storage.
   *
   * @param {Object} c - Configuration object with url, username, direct, persistPassword
   */
  function saveConf(c) {
    // Only save non-sensitive data to localStorage
    const confToSave = {
      url: (c.url || '').trim(),
      username: (c.username || '').trim(),
      // password is explicitly NOT saved to localStorage (unless encrypted with persistPassword)
      direct: !!c.direct,
      persistPassword: !!c.persistPassword,
    };
    lsSet(LS_KEY, JSON.stringify(confToSave));
  }

  /**
   * Get encrypted password from storage (sessionStorage or localStorage based on preference).
   * Checks both storages to support migration and backward compatibility.
   *
   * @param {string} key - Storage key for the encrypted password
   * @param {boolean} persistPassword - If true, use localStorage; if false, use sessionStorage
   * @returns {string|null} Encrypted password string or null if not found
   */
  function getEncryptedPasswordFromStorage(key, persistPassword) {
    try {
      // Check the preferred storage first
      const preferredStorage = getStorage(persistPassword);
      const value = preferredStorage.getItem(key);
      if (value) return value;

      // If not found in preferred storage, check the other one (for migration)
      const fallbackStorage = getStorage(!persistPassword);
      const fallbackValue = fallbackStorage.getItem(key);
      if (fallbackValue) {
        // Migrate to preferred storage
        preferredStorage.setItem(key, fallbackValue);
        fallbackStorage.removeItem(key);
        return fallbackValue;
      }

      return null;
    } catch (e) {
      console.warn('Password storage read failed:', e);
      return null;
    }
  }

  /**
   * Store encrypted password in storage (sessionStorage or localStorage based on preference).
   * Also clears from the other storage to avoid duplicates.
   *
   * @param {string} key - Storage key for the encrypted password
   * @param {string} encryptedPassword - Encrypted password string
   * @param {boolean} persistPassword - If true, use localStorage; if false, use sessionStorage
   */
  function setEncryptedPasswordInStorage(key, encryptedPassword, persistPassword) {
    try {
      const preferredStorage = getStorage(persistPassword);
      const otherStorage = getStorage(!persistPassword);

      if (encryptedPassword) {
        preferredStorage.setItem(key, encryptedPassword);
        // Remove from other storage to avoid duplicates
        otherStorage.removeItem(key);
      } else {
        // Clear from both storages
        preferredStorage.removeItem(key);
        otherStorage.removeItem(key);
      }
    } catch (e) {
      console.warn('Password storage write failed:', e);
    }
  }

  /**
   * Prompt user for master password if needed.
   * Returns true if master password is verified, false if cancelled.
   *
   * @returns {Promise<boolean>} True if master password is verified or not needed
   */
  async function promptMasterPasswordIfNeeded() {
    // If no master password is set, no prompt needed
    if (!hasMasterPassword()) {
      return true;
    }

    // If master password is already in session, no prompt needed
    if (sessionMasterPassword) {
      return true;
    }

    // Prompt for master password
    return new Promise((resolve) => {
      const promptHtml =
        '<div id="torrServerMasterPwdModal" class="modal" style="display:flex;z-index:1200">\n  <div class="modal-dialog">\n    <div class="modal-header">Мастер-пароль</div>\n    <div class="modal-body">\n      <p>Введите мастер-пароль для расшифровки сохраненных паролей.</p>\n      <input type="password" id="tsMasterPwdPrompt" placeholder="Мастер-пароль" class="mb10" autofocus />\n      <div class="modal-error" id="tsMasterPwdErr" style="display:none"></div>\n    </div>\n    <div class="modal-footer">\n      <button type="button" id="tsMasterPwdCancel" class="btn-secondary">Отмена</button>\n      <button type="button" id="tsMasterPwdOk" class="btn-primary">OK</button>\n    </div>\n  </div>\n</div>';
      $('body').append(promptHtml);
      $('#tsMasterPwdPrompt').focus();

      const cleanup = () => {
        // Detach all namespaced event handlers to avoid memory leaks
        $('#tsMasterPwdOk').off('.tsMasterPwd');
        $('#tsMasterPwdCancel').off('.tsMasterPwd');
        $('#tsMasterPwdPrompt').off('.tsMasterPwd');
        $('#torrServerMasterPwdModal').remove();
      };

      let isVerifying = false;
      const verify = async () => {
        // Guard against concurrent verification attempts
        if (isVerifying) {
          return;
        }

        const pwd = $('#tsMasterPwdPrompt').val();
        if (!pwd) {
          $('#tsMasterPwdErr').text('Введите мастер-пароль').show();
          return;
        }

        isVerifying = true;
        $('#tsMasterPwdOk').prop('disabled', true);
        $('#tsMasterPwdErr').hide();

        try {
          const isValid = await verifyMasterPassword(pwd);
          if (isValid) {
            sessionMasterPassword = pwd;
            cleanup();
            resolve(true);
          } else {
            $('#tsMasterPwdErr').text('Неверный мастер-пароль').show();
            $('#tsMasterPwdPrompt').val('').focus();
          }
        } finally {
          isVerifying = false;
          $('#tsMasterPwdOk').prop('disabled', false);
        }
      };

      // Use persistent event handlers with namespacing for proper cleanup
      $('#tsMasterPwdOk').on('click.tsMasterPwd', verify);
      $('#tsMasterPwdCancel').on('click.tsMasterPwd', () => {
        cleanup();
        resolve(false);
      });
      $('#tsMasterPwdPrompt').on('keydown.tsMasterPwd', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          verify();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          resolve(false);
        }
      });
    });
  }

  /**
   * Retrieve password from obfuscated storage or session memory.
   * Uses Web Crypto API to decrypt obfuscated passwords when available.
   * If a master password is set, it will be used for real encryption.
   * Otherwise, falls back to origin-based obfuscation (NO real security).
   *
   * @param {string} url - TorrServer URL
   * @param {string} username - Username (optional)
   * @param {boolean} persistPassword - If true, check localStorage; if false, check sessionStorage
   * @returns {Promise<string>} Password string (empty if not found)
   */
  async function getPassword(url, username, persistPassword) {
    // If no URL or username, return empty
    if (!url || !username) {
      return '';
    }

    // Generate storage key for this credential set
    const storageKey = getPasswordStorageKey(url, username);

    // First check session memory cache (fastest, no decryption needed)
    if (sessionPasswordCache.has(storageKey)) {
      return sessionPasswordCache.get(storageKey);
    }

    // Try to retrieve encrypted password from storage
    const encryptedPassword = getEncryptedPasswordFromStorage(storageKey, persistPassword);

    if (encryptedPassword) {
      try {
        // Decrypt the password
        // If master password is set, it will be used automatically by deriveEncryptionKey()
        const decryptedPassword = await decryptPassword(encryptedPassword);
        if (decryptedPassword) {
          // Cache in session memory for faster access, keyed by storage key
          sessionPasswordCache.set(storageKey, decryptedPassword);
          return decryptedPassword;
        }
      } catch (e) {
        console.warn('Failed to decrypt password from storage:', e);
        // Remove corrupted encrypted password
        setEncryptedPasswordInStorage(storageKey, '', persistPassword);
        // Clear from cache if present
        sessionPasswordCache.delete(storageKey);
      }
    }

    return '';
  }

  /**
   * Store password using encrypted storage (sessionStorage or localStorage) or session memory.
   * Uses Web Crypto API to encrypt passwords before storing when available.
   * If a master password is set, it will be used for real encryption. Otherwise, falls back
   * to origin-based obfuscation (NO real security). Falls back to session memory if encryption
   * is unavailable.
   *
   * @param {string} url - TorrServer URL
   * @param {string} username - Username (optional)
   * @param {string} password - Password to store
   * @param {boolean} persistPassword - If true, use localStorage; if false, use sessionStorage
   * @returns {Promise<void>}
   */
  async function setPassword(url, username, password, persistPassword) {
    // If no URL or username, we can't create a storage key
    if (!url || !username) {
      return;
    }

    const storageKey = getPasswordStorageKey(url, username);

    // If no password, clear storage and cache
    if (!password) {
      setEncryptedPasswordInStorage(storageKey, '', persistPassword);
      sessionPasswordCache.delete(storageKey);
      return;
    }

    // Always store in session memory cache for fast access, keyed by storage key
    sessionPasswordCache.set(storageKey, password);

    // Try to encrypt and store
    try {
      const encryptedPassword = await encryptPassword(password);
      setEncryptedPasswordInStorage(storageKey, encryptedPassword || '', persistPassword);
    } catch (e) {
      console.warn('Failed to encrypt and store password:', e);
      // Password remains in session memory cache only
      setEncryptedPasswordInStorage(storageKey, '', persistPassword);
    }
  }

  /**
   * Migrate old configuration: remove any password data from localStorage.
   * This ensures old encrypted/hashed passwords are cleaned up from localStorage.
   * Encrypted passwords in sessionStorage are automatically cleared when the tab closes.
   */
  function migrateOldConfig() {
    const raw = lsGet(LS_KEY);
    if (!raw) return;
    try {
      const j = JSON.parse(raw);
      let needsUpdate = false;
      const cleanConfig = {
        url: j.url || '',
        username: j.username || '',
        direct: !!j.direct,
        persistPassword: !!j.persistPassword, // Add persistPassword if missing
      };
      // If password field exists, remove it and save clean config
      if ('password' in j) {
        needsUpdate = true;
      }
      // If persistPassword is missing, add it with default false
      if (!('persistPassword' in j)) {
        needsUpdate = true;
      }
      if (needsUpdate) {
        lsSet(LS_KEY, JSON.stringify(cleanConfig));
      }
    } catch (e) {
      // If migration fails, remove the entire config to start fresh
      console.warn('Configuration migration failed:', e);
      lsRemove(LS_KEY);
    }
  }

  // Run migration on load to clean up any old password data from localStorage
  migrateOldConfig();

  /**
   * Clear all torrserver passwords from a storage object.
   *
   * @param {Storage} storage - Storage object to clear from
   */
  function clearAllPasswordsFromStorage(storage) {
    try {
      const keys = Object.keys(storage);
      keys.forEach((key) => {
        if (key.startsWith(PWD_STORAGE_PREFIX)) {
          storage.removeItem(key);
        }
      });
    } catch (e) {
      console.warn('Failed to clear passwords from storage:', e);
    }
  }

  /**
   * Clear password from both session memory and obfuscated storage (sessionStorage and localStorage).
   * This ensures passwords are completely removed from all storage locations.
   *
   * @param {string} url - TorrServer URL (optional, if provided clears specific credential)
   * @param {string} username - Username (optional, if provided clears specific credential)
   */
  function clearPassword(url, username) {
    // Clear obfuscated password from both storages if URL and username provided
    if (url && username) {
      const storageKey = getPasswordStorageKey(url, username);
      // Clear from session memory cache
      sessionPasswordCache.delete(storageKey);
      // Clear from both storages regardless of preference
      try {
        sessionStorage.removeItem(storageKey);
        localStorage.removeItem(storageKey);
      } catch (e) {
        console.warn('Failed to clear password from storage:', e);
      }
    } else {
      // Clear all torrserver passwords from both storages and cache
      sessionPasswordCache.clear();
      clearAllPasswordsFromStorage(sessionStorage);
      clearAllPasswordsFromStorage(localStorage);
    }
  }

  let pendingPromiseResolve = null;

  /**
   * Inject modal markup if not already present (allows custom styling override).
   * Creates the settings modal UI for configuring TorrServer connection.
   */
  function ensureMarkup() {
    if ($('#torrServerModal').length) return;
    const html =
      '<div id="torrServerModal" class="modal" style="display:none">\n  <div class="modal-dialog">\n    <div class="modal-header">Настройки TorrServer</div>\n    <div class="modal-body">\n      <input type="text" id="tsUrl" placeholder="URL (например http://127.0.0.1:8090)" class="mb10" />\n      <input type="text" id="tsUser" placeholder="Имя пользователя (опционально)" class="mb10" />\n      <input type="password" id="tsPass" placeholder="Пароль (опционально)" class="mb10" />\n      <label class="ts-checkbox"><input type="checkbox" id="tsDirect" /> <span>Прямой режим (из браузера)</span></label>\n      <label class="ts-checkbox"><input type="checkbox" id="tsPersistPassword" /> <span>Сохранить пароль (зашифрован в localStorage)</span></label>\n      <hr />\n      <div class="ts-master-pwd-section">\n        <div><strong>Мастер-пароль для шифрования (опционально)</strong></div>\n        <div>Мастер-пароль обеспечивает реальную защиту паролей. Без него используется только обфускация (небезопасно).</div>\n        <input type="password" id="tsMasterPwd" placeholder="Мастер-пароль (оставьте пустым, чтобы не изменять)" class="mb10" />\n        <input type="password" id="tsMasterPwdConfirm" placeholder="Подтверждение мастер-пароля" class="mb10" />\n        <label class="ts-checkbox"><input type="checkbox" id="tsClearMasterPwd" /> <span>Очистить мастер-пароль</span></label>\n        <div id="tsMasterPwdStatus"></div>\n      </div>\n      <div class="ts-actions-row">\n        <button type="button" id="tsTest" class="btn-tertiary ts-test-btn">Тест соединения</button>\n      </div>\n      <div class="ts-hint">Добавление торрентов всегда через /torrents. Прямой режим требует CORS допуска или авторизованной вкладки.</div>\n      <div class="modal-error" id="tsErr" style="display:none"></div>\n    </div>\n    <div class="modal-footer">\n      <button type="button" id="tsCancel" class="btn-secondary">Отмена</button>\n      <button type="button" id="tsSave" class="btn-primary">Сохранить</button>\n    </div>\n  </div>\n</div>';
    $('body').append(html);
  }

  /**
   * Show the settings modal and populate it with current configuration.
   * Retrieves password from obfuscated storage or session memory.
   * Prompts for master password if needed.
   *
   * @returns {Promise<boolean>} Promise that resolves to true if settings were saved, false if cancelled
   */
  async function showModal() {
    // Prompt for master password if needed
    const masterPwdOk = await promptMasterPasswordIfNeeded();
    if (!masterPwdOk) {
      // User cancelled master password prompt
      return false;
    }

    ensureMarkup();
    const c = loadConf();
    $('#tsUrl').val(c.url);
    $('#tsUser').val(c.username);
    // Retrieve password from obfuscated storage or session memory
    const pwd = await getPassword(c.url, c.username, c.persistPassword);
    $('#tsPass').val(pwd);
    $('#tsDirect').prop('checked', !!c.direct);
    $('#tsPersistPassword').prop('checked', !!c.persistPassword);

    // Master password fields
    $('#tsMasterPwd').val('');
    $('#tsMasterPwdConfirm').val('');
    $('#tsClearMasterPwd').prop('checked', false);
    const hasMasterPwd = hasMasterPassword();
    if (hasMasterPwd) {
      $('#tsMasterPwdStatus').text('✓ Мастер-пароль установлен').css('color', '#2d7d46');
    } else {
      $('#tsMasterPwdStatus')
        .text('⚠ Мастер-пароль не установлен (используется обфускация)')
        .css('color', '#c0392b');
    }

    $('#tsErr').hide().text('');
    $('#torrServerModal').show();
    return new Promise((res) => {
      pendingPromiseResolve = res;
    });
  }

  /**
   * Close the settings modal and resolve the pending promise.
   *
   * @param {boolean} res - Result to pass to the promise (true if saved, false if cancelled)
   */
  function closeModal(res) {
    $('#torrServerModal').hide();
    if (pendingPromiseResolve) {
      const r = pendingPromiseResolve;
      pendingPromiseResolve = null;
      r(res);
    }
  }

  /**
   * Validate URL format - only allow http:// or https://
   *
   * @param {string} url - URL to validate
   * @returns {string|null} Error message if invalid, null if valid
   */
  function validateUrl(url) {
    if (!url) {
      return 'Укажите URL';
    }
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return 'Используйте http:// или https://';
      }
      return null;
    } catch (e) {
      return 'Неверный формат URL';
    }
  }

  /**
   * Submit the settings modal form.
   * Validates URL format, saves non-sensitive data to localStorage,
   * and stores password using obfuscated storage.
   * Also handles master password setup/update/removal.
   */
  async function submitModal() {
    const url = $('#tsUrl').val().trim();
    const username = $('#tsUser').val().trim();
    const password = $('#tsPass').val();
    const direct = $('#tsDirect').is(':checked');
    const persistPassword = $('#tsPersistPassword').is(':checked');
    const masterPwd = $('#tsMasterPwd').val();
    const masterPwdConfirm = $('#tsMasterPwdConfirm').val();
    const clearMasterPwd = $('#tsClearMasterPwd').is(':checked');

    const urlError = validateUrl(url);
    if (urlError) {
      $('#tsErr').text(urlError).show();
      $('#tsUrl').attr('aria-invalid', 'true').focus();
      return;
    }

    // Handle master password
    if (clearMasterPwd) {
      // Clear master password
      await setMasterPassword('');
      $('#tsMasterPwdStatus').text('Мастер-пароль очищен').css('color', '#666');
    } else if (masterPwd) {
      // Set or update master password
      if (masterPwd !== masterPwdConfirm) {
        $('#tsErr').text('Мастер-пароли не совпадают').show();
        $('#tsMasterPwdConfirm').focus();
        return;
      }
      if (masterPwd.length < 8) {
        $('#tsErr').text('Мастер-пароль должен содержать минимум 8 символов').show();
        $('#tsMasterPwd').focus();
        return;
      }
      const success = await setMasterPassword(masterPwd);
      if (success) {
        $('#tsMasterPwdStatus').text('✓ Мастер-пароль установлен').css('color', '#2d7d46');
        // WARNING: When master password is changed, passwords encrypted with the old master
        // password cannot be decrypted with the new one. Users will need to re-enter their
        // passwords. The old encrypted passwords will remain in storage but will be inaccessible.
      } else {
        $('#tsErr').text('Не удалось установить мастер-пароль').show();
        return;
      }
    }

    $('#tsUrl').attr('aria-invalid', 'false');
    // Save only non-sensitive data (url, username, direct, persistPassword) to localStorage
    saveConf({ url, username, direct, persistPassword });
    // Store password using obfuscated storage (localStorage or sessionStorage based on preference)
    // If master password is set, it will be used for encryption automatically
    await setPassword(url, username, password, persistPassword);
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

  /**
   * Ensure toast notification container exists in the DOM.
   * Creates a fixed-position container for displaying toast messages.
   */
  function ensureToast() {
    if ($('#toastBox').length) return;
    $('body').append(
      '<div id="toastBox" style="position:fixed;bottom:20px;right:20px;z-index:1100;display:flex;flex-direction:column;gap:8px;"></div>'
    );
  }

  /**
   * Display a toast notification message.
   *
   * @param {string} msg - Message to display
   * @param {string} type - Type of toast ('err' for error, 'ok' for success)
   */
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
    }, TOAST_DISPLAY_MS);
  }

  /**
   * Send magnet link directly to user-specified TorrServer (browser -> server).
   * Uses direct mode, bypassing the Cloudflare worker proxy.
   * Retrieves password from obfuscated storage or session memory.
   *
   * @param {string} magnet - Magnet link to send
   * @param {Object} conf - Configuration object with url, username
   */
  async function directSend(magnet, conf) {
    const debug = !!localStorage.getItem('torrserver_debug');
    const base = conf.url.replace(/\/$/, '');
    const addUrl = base + '/torrents';
    // Retrieve password from obfuscated storage or session memory
    const password = await getPassword(conf.url, conf.username, conf.persistPassword);
    const auth =
      conf.username && password
        ? 'Basic ' + btoa(unescape(encodeURIComponent(conf.username + ':' + password)))
        : null;
    const bodyStr = JSON.stringify({ action: 'add', link: magnet, save_to_db: true });
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (auth) headers['Authorization'] = auth;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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

  /**
   * Entry point for UI buttons: sends magnet link to TorrServer.
   * Chooses between proxy mode (default) and direct mode based on configuration.
   * Retrieves password from obfuscated storage or session memory.
   * Prompts for master password if needed.
   *
   * @param {string} magnet - Magnet link to send
   */
  async function sendMagnet(magnet) {
    const conf = loadConf();
    if (!conf.url) {
      openSettings();
      return;
    }
    // Prompt for master password if needed
    const masterPwdOk = await promptMasterPasswordIfNeeded();
    if (!masterPwdOk) {
      // User cancelled master password prompt
      toast('Требуется мастер-пароль для расшифровки пароля', 'err');
      return;
    }
    // Retrieve password from obfuscated storage or session memory
    const password = await getPassword(conf.url, conf.username, conf.persistPassword);
    if (conf.direct) {
      await directSend(magnet, { ...conf, password });
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
        password: password,
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

  /**
   * Open the settings modal for configuring TorrServer connection.
   * Shows a toast notification when settings are successfully saved.
   */
  function openSettings() {
    showModal().then((changed) => {
      if (changed) {
        toast('Настройки сохранены', 'ok');
      }
    });
  }

  /**
   * Test connection to TorrServer endpoint.
   * Validates the connection by sending a test request through the proxy.
   * Uses password from the form input (not from obfuscated storage) for testing.
   */
  $(document).on('click', '#tsTest', async function () {
    const url = $('#tsUrl').val().trim();
    const urlError = validateUrl(url);
    if (urlError) {
      $('#tsErr').text(urlError).show();
      return;
    }
    $('#tsErr').hide().text('');
    const username = $('#tsUser').val().trim();
    const password = $('#tsPass').val(); // Use password from form input for testing
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

  /**
   * Get full configuration including password from obfuscated storage.
   * This is a convenience method that combines loadConf() with getPassword().
   * Retrieves password from obfuscated storage or session memory.
   * WARNING: The encryption is predictable (origin-derived) and provides obfuscation only.
   * Prompts for master password if needed before decrypting.
   *
   * @returns {Promise<Object>} Configuration object with url, username, password, direct
   *                           If master password is required but unlock fails, returns conf without password
   */
  async function getConfWithPassword() {
    const conf = loadConf();
    if (conf.username && conf.url) {
      // Check if master password is configured and if session is unlocked
      // If master password is set but session is locked, attempt to unlock
      if (hasMasterPassword() && !sessionMasterPassword) {
        // Attempt to unlock via prompt flow
        const masterPwdOk = await promptMasterPasswordIfNeeded();
        if (!masterPwdOk) {
          // User cancelled master password prompt - bail out cleanly
          // Return conf without password to preserve the stored encrypted password
          return { ...conf, password: '' };
        }
      }
      // Now safe to call getPassword() - either no master password is set,
      // or master password is set and session is unlocked
      const password = await getPassword(conf.url, conf.username, conf.persistPassword);
      return { ...conf, password };
    }
    return conf;
  }

  const TorrServer = {
    openSettings,
    sendMagnet,
    getConf: loadConf,
    getConfWithPassword,
    clearPassword,
  };
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
