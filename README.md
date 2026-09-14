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

### Development and deployment workflow

Develop and test in a local Git checkout. When a change is ready, commit it and push it to `main`:

```sh
git add <changed-files>
git commit -m "Describe the change"
git push origin main
```

On the production server, update only from that branch, then reload only when deployment is intended:

```sh
cd ~/oicq-template-main
git pull --ff-only origin main
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

If `package-lock.json` changed, run `npm ci --ignore-scripts` before the reload. If the word-hint native sources or `binding.gyp` changed, rebuild `word_hint.node` using the build commands above first.

For host reboots, run `pm2 startup` once, execute the command PM2 prints with `sudo`, then run `pm2 save`. Thereafter PM2 restores the saved process list automatically; use `pm2 resurrect` only if automatic restoration did not occur.

## Data boundaries

Word tables (`.txt`, `.hint`, `.config`) and Rime schemes are operational data. Back them up and restore them through the server’s operations process; Git does not contain them. The minimal database DDL is in `db/schema.sql`, with no user records or registered scheme data.
