export type Locale = 'en' | 'ru';

// Message keys
export type MsgKey =
  | 'not_found'
  | 'bad_request'
  | 'method_not_allowed'
  | 'forbidden'
  | 'upstream_timeout'
  | 'upstream_fetch_failed'
  | 'torrserver_timeout'
  | 'torrserver_network'
  | 'torrserver_all_attempts_failed'
  | 'missing_url'
  | 'invalid_url'
  | 'expect_json_body'
  | 'invalid_magnet'
  | 'auth_credentials_mismatch'
  | 'auth_error_hint'
  | 'auth_error_hint_tokens'
  | 'path_decode_error'
  | 'path_map_error';

interface LocalePack {
  locale: Locale;
  messages: Record<MsgKey, string>;
}

const RU: LocalePack = {
  locale: 'ru',
  messages: {
    not_found: 'Не найдено',
    bad_request: 'Некорректный запрос',
    method_not_allowed: 'Метод не поддерживается',
    forbidden: 'Доступ запрещен',
    upstream_timeout: 'Превышено время ожидания апстрима',
    upstream_fetch_failed: 'Ошибка запроса к апстриму',
    torrserver_timeout: 'Превышено время ожидания TorrServer',
    torrserver_network: 'Сетевая ошибка',
    torrserver_all_attempts_failed: 'Все попытки не удались',
    missing_url: 'Отсутствует URL',
    invalid_url: 'Некорректный URL',
    expect_json_body: 'Ожидается JSON тело',
    invalid_magnet: 'Некорректный magnet',
    auth_credentials_mismatch: 'Укажите одновременно логин и пароль или оставьте оба пустыми',
    auth_error_hint: 'Ошибка авторизации: проверьте логин/пароль',
    auth_error_hint_tokens: 'Ошибка авторизации: проверьте логин/пароль или токены',
    path_decode_error: 'Некорректное кодирование пути',
    path_map_error: 'Ошибка сопоставления пути',
  },
};

const EN: LocalePack = {
  locale: 'en',
  messages: {
    not_found: 'Not found',
    bad_request: 'Bad request',
    method_not_allowed: 'Method not allowed',
    forbidden: 'Forbidden',
    upstream_timeout: 'Upstream timeout exceeded',
    upstream_fetch_failed: 'Upstream fetch failed',
    torrserver_timeout: 'TorrServer timeout exceeded',
    torrserver_network: 'Network error',
    torrserver_all_attempts_failed: 'All attempts failed',
    missing_url: 'Missing URL',
    invalid_url: 'Invalid URL',
    expect_json_body: 'Expected JSON body',
    invalid_magnet: 'Invalid magnet',
    auth_credentials_mismatch: 'Provide both username and password or leave both empty',
    auth_error_hint: 'Auth error: check username/password',
    auth_error_hint_tokens: 'Auth error: check username/password or tokens',
    path_decode_error: 'Invalid path encoding',
    path_map_error: 'Path mapping error',
  },
};

const PACKS: Record<Locale, LocalePack> = { en: EN, ru: RU };

export function resolveLocale(raw: unknown): Locale {
  const v = (typeof raw === 'string' ? raw.trim().toLowerCase() : '') as Locale;
  return v === 'en' ? 'en' : 'ru';
}

export function getMessages(locale: Locale) {
  return PACKS[locale].messages;
}

export function msg(locale: Locale, key: MsgKey): string {
  const pack = PACKS[locale];
  return pack.messages[key] || key;
}
