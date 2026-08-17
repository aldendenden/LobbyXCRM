# План: puppeteer-extra-plugin-stealth для обходу reCAPTCHA

## Проблема

Google reCAPTCHA v2 визначає що браузер автоматизований (Puppeteer) і блокує
аудіо-виклики. Замість аудіо-виклику показує сторінку:
"Your computer or network may be sending automated queries."

У поточній реалізації:
- Браузер запускається з `--disable-blink-features=AutomationControlled`
- Ручне встановлення User-Agent через `page.setUserAgent()`
- Google все одно детектує автоматизацію → `audioSrc = NULL` на кожній спробі

## Рішення

Використати `puppeteer-extra` + `puppeteer-extra-plugin-stealth` — плагін який
патчить fingerprint браузера (navigator.webdriver, plugins, UA, Media codecs,
iframe contentWindow тощо) перед тим як сторінка зможе його перевірити.

Проходить ~95% публічних тестів детекції ботів (sannysoft, bot detection).
Для reCAPTCHA v2 (не Cloudflare Turnstile) працює значно краще.

## Що змінюється

### 1. Залежності (package.json)

Додати:
- `puppeteer-extra` — обгортка над puppeteer з підтримкою плагінів
- `puppeteer-extra-plugin-stealth` — плагін обходу детекції

Існуючий `puppeteer` залишається (stealth використовує його як базу).

### 2. autofill.js

- Замінити `require('puppeteer')` → `require('puppeteer-extra')`
- Додати імпорт та реєстрацію StealthPlugin:
  ```js
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
  ```
- Прибрати `--disable-blink-features=AutomationControlled` з args
  (stealth робить це краще через ES6 Proxy для navigator.webdriver)
- Прибрати ручний `page.setUserAgent(USER_AGENT)`
  (stealth автоматично керує UA, мовами, platform)

### 3. СТАРТ.bat

Без змін — Chrome для Puppeteer вже завантажується на кроці 2.

### 4. solver.js

Без змін — логіка solver правильна (frame detection, audio download, Vosk
транскрипція, wordsToDigits). Проблема була в тому що Google не завантажував
аудіо-виклик. Stealth plugin має вирішити це.

## Порядок дій

1. Встановити залежності:
   ```
   npm install puppeteer-extra puppeteer-extra-plugin-stealth
   ```

2. Змінити autofill.js (див. вище)

3. Перезапустити сервер

4. Увімкнути captcha solver в налаштуваннях

5. Запустити автозаявку

6. Перевірити debug.log:
   - `audioSrc = ...` (а НЕ `NULL`) — аудіо завантажується
   - `raw text = "..."` — Vosk розпізнав
   - `digits = "..."` — конвертація в цифри
   - `reCAPTCHA: РОЗВ'ЯЗАНО!` — успіх

## Ризики

- Stealth plugin не гарантує 100% результат — Google оновлює детекцію
- Для reCAPTCHA v2 працює краще ніж для Cloudflare Turnstile
- Якщо не допоможе — варіанти:
  a) Ручне проходження captcha (поточний fallback)
  b) Third-party сервіс (2captcha, anticaptcha) — платний API
  c) browserless через Docker (чистий Chrome без automation flags)
