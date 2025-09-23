# cf-jacred-fbd (Русская документация)

> Языки: 🇷🇺 Русский | [English](./README.md)

<!-- markdownlint-disable MD033 -->

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-orange?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/pages/)
[![Runtime](https://img.shields.io/badge/Runtime-Workers-black?logo=cloudflare)](https://developers.cloudflare.com/workers/)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![esbuild](https://img.shields.io/badge/Bundler-esbuild-ffcf00)
![ESLint](https://img.shields.io/badge/Lint-ESLint-4B32C3?logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Format-Prettier-f7b93e?logo=prettier&logoColor=black)
![Status](https://img.shields.io/badge/Статус-Alpha-blue)
![License](https://img.shields.io/badge/Лицензия-TBD-lightgrey)
[![Architecture](https://img.shields.io/badge/Архитектура-EN-blueviolet)](./ARCHITECTURE.md)
[![Architecture RU](https://img.shields.io/badge/Архитектура-RU-blueviolet)](./ARCHITECTURE.ru.md)
[![English](https://img.shields.io/badge/Docs-English-lightgreen)](./README.md)

> ⚠️ Ранняя альфа: **публичное API и HTML структура могут измениться**. Зафиксируйте коммит, если зависите от интерфейса.

Edge‑ускоренный UI для метапоиска торрент раздач + дашборд статистики трекеров на базе Cloudflare Pages и кастомного `_worker.js` (API gateway, заголовки безопасности, кеширование, помощники TorrServer) поверх HTTP апстрима.

---

## 📚 Оглавление

1. [Обзор](#обзор)
2. [Ключевые возможности](#ключевые-возможности)
3. [Публичные HTTP эндпоинты](#публичные-http-эндпоинты)
4. [Переменные окружения](#переменные-окружения)
5. [Стратегия кеширования](#стратегия-кеширования)
6. [Сборка и инструменты](#сборка-и-инструменты)
7. [Быстрый старт локально](#быстрый-старт-локально)
8. [Заголовки безопасности](#заголовки-безопасности)
9. [Поток работы с API ключом](#поток-работы-с-api-ключом)
10. [Интеграция с TorrServer](#интеграция-с-torrserver)
11. [Архитектура (кратко)](#архитектура-кратко)
12. [Примеры JSON ошибок](#примеры-json-ошибок)
13. [Отладка и диагностика](#отладка-и-диагностика)
14. [Идеи расширений](#идеи-расширений)
15. [Вклад / Contributing](#вклад--contributing)
16. [FAQ](#faq)
17. [Лицензия](#лицензия)
18. [Поддержка / Issues](#поддержка--issues)

---

## Обзор

Проект обслуживает две основные страницы:

1. Поиск (`index.html`) – метапоиск с фильтрами, сортировкой, поддержкой API ключа и отправкой magnet прямо в TorrServer.
2. Статистика (`stats.html`) – дашборд статистики трекеров: автообновление, итоги, темы, компактный/широкий режимы, форматирование чисел, оффлайн кеш локально.

Worker решает:

- Аутентификация (опциональный API ключ; удаление из апстрима)
- Преобразование путей `/api/...`
- Прямой passthrough для некоторых путей (`/stats`, `/sync` префиксы)
- Умное edge + browser кеширование (ETag + 304)
- Заголовки безопасности и очистка hop‑by‑hop
- POST помощники TorrServer с таймаутами и поддержкой Cloudflare Access
- Манифест для хешированных ассетов

## Ключевые возможности

- Мультифильтрация: качество, озвучка, год, сезон, трекер, категория, включающие/исключающие подстроки
- Сортировка: сиды, размер, дата (persist в `localStorage`)
- Дашборд статистики: автообновление (10м при активной вкладке), разные режимы сортировки, светлая/тёмная темы, компактный/широкий режим, переключатель формата чисел, агрегированные итоги, подсветка устаревших данных
- Работа с API ключом: модальное окно, проверка через `/api/conf`
- TorrServer: добавление magnet, проверка версии
- Edge кеширование + ETag
- Хешированные ассеты с долгим сроком
- Заголовки безопасности по умолчанию

## Публичные HTTP эндпоинты

| Путь                       | Метод | Тип                | Описание                                 |
| -------------------------- | ----- | ------------------ | ---------------------------------------- |
| `/`                        | GET   | Статика            | UI поиска                                |
| `/stats` / `/stats.html`   | GET   | Статика            | Дашборд статистики                       |
| `/api/conf`                | GET   | API (прокс)        | Дескриптор возможностей + проверка ключа |
| `/api/torrents?search=...` | GET   | API (прокс)        | Поиск                                    |
| `/api/stats/torrents`      | GET   | API (прокс)        | Статистика трекеров                      |
| `/api/torrserver/add`      | POST  | Worker             | Добавление magnet в TorrServer           |
| `/api/torrserver/test`     | POST  | Worker             | Проверка версии / доступности            |
| `/api/*` (прочее)          | \*    | API (прокс)        | Общий апстрим                            |
| `/sync*`                   | \*    | Прямой passthrough | Минует логику `/api`                     |

Неподдерживаемые методы → 405 JSON.

## Переменные окружения

| Переменная                                        | Обязательна | Назначение                               |
| ------------------------------------------------- | ----------- | ---------------------------------------- |
| `UPSTREAM_ORIGIN`                                 | Да          | Базовый апстрим (без `/`)                |
| `API_KEY`                                         | Нет         | Включает проверку ключа                  |
| `UPSTREAM_TIMEOUT_MS`                             | Нет         | Таймаут апстрима (по умолч. 30000)       |
| `TORRSERVER_TIMEOUT_MS`                           | Нет         | Таймаут TorrServer (по умолч. 15000)     |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Нет         | Сервис‑токены для защищённого TorrServer |

## Стратегия кеширования

| Объект     | Cache-Control                         | Примечание                      |
| ---------- | ------------------------------------- | ------------------------------- |
| HTML       | `no-cache, must-revalidate`           | Проверка при каждом запросе     |
| Хеш ассеты | `public, max-age=31536000, immutable` | Долгий срок, контент адресуемый |
| GET API    | `public, max-age=60, s-maxage=300`    | Edge кеш в `caches.default`     |
| 304        | —                                     | Нормализованный `Vary`          |

Ключ кеша очищает параметры: `apikey`, `api_key`, `_`.

## Сборка и инструменты

| Задача     | Команда              |
| ---------- | -------------------- |
| Dev        | `npm run dev`        |
| Typecheck  | `npm run typecheck`  |
| Lint       | `npm run lint`       |
| Format     | `npm run format`     |
| Prod build | `npm run build:prod` |

## Быстрый старт локально

```bash
npm install
npm run dev
```

## Заголовки безопасности

| Заголовок                    | Значение                                                    |
| ---------------------------- | ----------------------------------------------------------- |
| X-Content-Type-Options       | nosniff                                                     |
| Referrer-Policy              | no-referrer                                                 |
| X-Frame-Options              | DENY                                                        |
| Cross-Origin-Opener-Policy   | same-origin                                                 |
| Cross-Origin-Resource-Policy | same-origin                                                 |
| Permissions-Policy           | geolocation=(), microphone=(), camera=(), fullscreen=(self) |

Планы: CSP, SRI, rate limiting / Turnstile.

## Поток работы с API ключом

1. Страница запрашивает `/api/conf` (с сохранённым ключом если есть)
2. Ответ: `{ requireApiKey, apikey }`
3. Если требуется и невалидно → модалка ввода
4. Проверка ключа повторным вызовом `/api/conf?apikey=...`
5. Сохранение в `localStorage` и добавление к будущим запросам (а затем удаление перед апстримом)

## Интеграция с TorrServer

| Путь                   | Назначение                    |
| ---------------------- | ----------------------------- |
| `/api/torrserver/add`  | Отправка magnet в `/torrents` |
| `/api/torrserver/test` | Проверка `/echo` + версия     |

Особенности: таймауты, Basic Auth, опционально Cloudflare Access токены, режим debug.

## Архитектура (кратко)

Полная архитектура с диаграммами: [`ARCHITECTURE.ru.md`](./ARCHITECTURE.ru.md) (или англ. версия `ARCHITECTURE.md`).

```text
statsAsset → staticAsset → methodAndCors → torrserver → confEndpoint → upstream
```

## Примеры JSON ошибок

| Сценарий           | Пример                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Неверный метод     | `{ "error": "Метод не поддерживается", "code": "method_not_allowed" }`                             |
| Таймаут апстрима   | `{ "error": "Превышено время ожидания апстрима", "code": "upstream_timeout", "timeoutMs": 30000 }` |
| Таймаут TorrServer | `{ "error": "Превышено время ожидания TorrServer", "code": "torrserver_timeout" }`                 |

## Отладка и диагностика

| Нужно                     | Как                             |
| ------------------------- | ------------------------------- |
| Показать апстрим URL      | Заголовок `x-debug-upstream: 1` |
| Время обработки           | `Server-Timing`                 |
| Форсировать свежий fetch  | `Cache-Control: no-cache`       |
| Подробный TorrServer JSON | `{"debug": true}` в теле add    |

## Идеи расширений

- CSP + SRI
- Service Worker (офлайн история)
- Пагинация / виртуализация
- i18n (JSON словари)
- Rate limiting/Turnstile
- Метрики / логгинг

## Вклад / Contributing

1. Форк / ветка
2. `npm run typecheck` + `npm run build`
3. Для прод проверки: `npm run build:prod`
4. Обновляйте документацию при изменениях маршрутов / заголовков / env
5. Пишите поясняющие комментарии

## FAQ

**Почему ключ в query, а не заголовке?** Проще и можно сохранять/делиться URL.

**Почему HTTP апстрим?** TLS завершается на edge Cloudflare.

**Есть ли rate limiting?** Пока нет.

**Можно отключить ключ в preview?** Да — очистите `API_KEY`.

## Лицензия

Пока не выбрана (рекомендуется MIT или Apache 2.0).

## Поддержка / Issues

Создайте issue с:

- Шагами воспроизведения
- Ожидаемым/фактическим поведением
- URL и методами
- Важными заголовками / JSON (без чувствительных данных)
- (Опционально) скриншоты / HAR

---

Удачной разработки! 🚀

---

🔁 Переключить язык: [English version](./README.md)
