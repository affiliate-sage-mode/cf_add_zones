# Cloudflare Bulk Zones

A simple local tool for adding domains to Cloudflare in bulk.

It can:

- create Cloudflare zones or reuse existing ones;
- print Cloudflare nameservers for each domain;
- optionally create or update A records for `domain.com` and `*.domain.com`;
- set SSL mode to `Full (strict)`;
- save assigned nameservers to `nameservers.csv`.

There is no sandbox mode, Namecheap integration, database, or external npm dependency. You only need Node.js 18 or newer.

## 1. Setup

Copy the example env file:

```bash
cp .env.example .env
```

On Windows, you can simply create a `.env` file next to the script and add:

```env
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
A_RECORD_IP=203.0.113.10
```

`A_RECORD_IP` is optional. If you do not set it, the script will only add domains to Cloudflare and print their nameservers.

## 2. Cloudflare API Token

Create a token in Cloudflare:

1. Open Cloudflare Dashboard.
2. Go to `My Profile` -> `API Tokens`.
3. Click `Create Token`.
4. Give the token permissions to manage zones and DNS in the needed account.

Minimum permissions:

- `Zone:Zone:Edit`
- `Zone:DNS:Edit`
- `Zone:Zone Settings:Edit`

After creating the token, add it to `.env` as `CLOUDFLARE_API_TOKEN`.

You can find `CLOUDFLARE_ACCOUNT_ID` in Cloudflare Dashboard, usually in the right sidebar of a site page or in the account/API section.

## 3. Domain List

Create `domains.txt`:

```txt
example.com
example.org

# optional: set a different IP for a specific domain
example.net 203.0.113.20
```

Empty lines and lines starting with `#` are ignored.

## 4. Run With Local UI

```bash
npm start
```

Open:

```txt
http://127.0.0.1:5173
```

You can paste the token, Account ID, IP address, and domain list into the form. The token is not saved in the browser.

## 5. Run With CLI

Basic run:

```bash
node cf_add_zones.js --domains-file domains.txt
```

Run with A records:

```bash
node cf_add_zones.js --domains-file domains.txt --ip 203.0.113.10
```

Preview actions without changing Cloudflare:

```bash
node cf_add_zones.js --domains-file domains.txt --ip 203.0.113.10 --dry-run
```

Disable Cloudflare proxy for A records:

```bash
node cf_add_zones.js --domains-file domains.txt --ip 203.0.113.10 --no-proxy
```

## 6. Result

After the run, the script prints the result in the console and creates:

```txt
nameservers.csv
```

The file contains domains and assigned Cloudflare nameservers. Add those nameservers at your domain registrar.

## Important

- Do not publish `.env` or share your API Token.
- If a domain already exists in Cloudflare, the script does not create a duplicate. It reuses the existing zone and updates the selected settings.
- If an IP is provided, the script creates two A records: the root domain and wildcard `*.domain.com`.
- DNS changes are not always instant. They usually take from a few minutes to a few hours.

---

# Cloudflare Bulk Zones українською

Простий локальний інструмент для масового додавання доменів у Cloudflare.

Що він робить:

- створює зони в Cloudflare або використовує вже наявні;
- показує Cloudflare nameservers для кожного домену;
- за бажанням створює або оновлює A-записи для `domain.com` і `*.domain.com`;
- ставить SSL режим `Full (strict)`;
- зберігає NS у файл `nameservers.csv`.

У проєкті немає sandbox, Namecheap-інтеграцій, баз даних і зовнішніх npm-залежностей. Потрібен тільки Node.js 18 або новіший.

## 1. Підготовка

Скопіюйте приклад env-файлу:

```bash
cp .env.example .env
```

На Windows можна просто створити файл `.env` поруч зі скриптом і вставити туди:

```env
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
A_RECORD_IP=203.0.113.10
```

`A_RECORD_IP` необов'язковий. Якщо його не вказати, скрипт тільки додасть домени в Cloudflare і покаже NS.

## 2. Cloudflare API Token

Створіть токен у Cloudflare:

1. Відкрийте Cloudflare Dashboard.
2. Перейдіть у `My Profile` -> `API Tokens`.
3. Натисніть `Create Token`.
4. Дайте токену права для керування зонами й DNS у потрібному акаунті.

Мінімально потрібні права:

- `Zone:Zone:Edit`
- `Zone:DNS:Edit`
- `Zone:Zone Settings:Edit`

Після створення вставте токен у `.env` як `CLOUDFLARE_API_TOKEN`.

`CLOUDFLARE_ACCOUNT_ID` можна знайти в Cloudflare Dashboard у правій колонці на сторінці будь-якого сайту або в API-секції акаунта.

## 3. Список доменів

Створіть файл `domains.txt`:

```txt
example.com
example.org

# можна задати окремий IP для конкретного домену
example.net 203.0.113.20
```

Порожні рядки й рядки з `#` ігноруються.

## 4. Запуск через локальну сторінку

```bash
npm start
```

Відкрийте:

```txt
http://127.0.0.1:5173
```

У формі можна вставити токен, Account ID, IP і список доменів. Токен не зберігається в браузері.

## 5. Запуск через CLI

Найпростіший запуск:

```bash
node cf_add_zones.js --domains-file domains.txt
```

З IP для A-записів:

```bash
node cf_add_zones.js --domains-file domains.txt --ip 203.0.113.10
```

Перевірити план без змін у Cloudflare:

```bash
node cf_add_zones.js --domains-file domains.txt --ip 203.0.113.10 --dry-run
```

Вимкнути Cloudflare proxy для A-записів:

```bash
node cf_add_zones.js --domains-file domains.txt --ip 203.0.113.10 --no-proxy
```

## 6. Результат

Після запуску скрипт виведе результат у консоль і створить файл:

```txt
nameservers.csv
```

У ньому будуть домени та призначені Cloudflare NS. Їх потрібно прописати у реєстратора домену.

## Важливо

- Не публікуйте `.env` і не відправляйте нікому API Token.
- Якщо домен уже є в Cloudflare, скрипт не створює дубль, а використовує наявну зону й оновлює вибрані налаштування.
- Якщо IP заданий, скрипт створює два A-записи: кореневий домен і wildcard `*.domain.com`.
- DNS-зміни можуть застосовуватись не миттєво. Зазвичай це займає від кількох хвилин до кількох годин.
