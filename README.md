# oicq-template-main

QQ / NapCat bot with word-hint and Rime query plugins. This repository contains source code and templates only; it deliberately excludes credentials, word tables, Rime schemes, dependencies, and native build output.

## Restore and build

1. Install Node.js and the system dependencies needed by Puppeteer and Librime.
2. Copy `.env.example` to `.env`, then fill in the MySQL and NapCat values. `.env` is the only in-repository location for production credentials and is never committed.
3. Restore the server-managed runtime data separately: `word_hint_module/word_hint/` and `rime_scheme/`.
4. Install dependencies and build the word-hint addon:

   ```sh
   npm ci
   npx node-gyp configure
   make -C build word_hint
   ```

The Rime plugin also requires Librime installed on the host. Build it from commit `d4c324ca988ed67f45e41524c2ab01d40cb55695`; its source is intentionally not vendored here.

## Process management

The checked-in PM2 definition reproduces the eight active plugin processes without embedding credentials:

```sh
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

Do not start the bot for a build-only verification: it connects to the live NapCat instance and MySQL.

## Data boundaries

Word tables (`.txt`, `.hint`, `.config`) and Rime schemes are operational data. Back them up and restore them through the server’s operations process; Git does not contain them. The minimal database DDL is in `db/schema.sql`, with no user records or registered scheme data.
