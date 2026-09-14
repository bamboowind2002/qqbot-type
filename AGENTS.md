# Repository workflow

## Source of truth and deployment

- Develop in a local Git working tree. Commit tested changes to `main` and push to `origin` (`git@github.com:bamboowind2002/qqbot-type.git`).
- The production checkout is `/home/ubuntu/oicq-template-main/` on `ssh lbamboo`. Do not develop there. Deploy with `git pull --ff-only origin main` only after the local commit is pushed.
- An emergency production fix must be committed and pushed immediately, then pulled into the local working tree before further work.
- Do not commit `.env`, word tables, Rime schemes, `node_modules/`, `build/`, `librime/`, or other operational data. Do not copy production credentials or word tables into a local clone.

## Production deployment

- Production credentials live only in the ignored `.env`; `dist/config.js` validates them and `dist/bot.js` consumes that configuration. Never print or commit those values.
- If `package-lock.json` changed, run `npm ci --ignore-scripts` on production before reloading.
- If `binding.gyp`, `word_hint0206_4.cc`, or `word_hint0206/` changed, rebuild the addon with `npx node-gyp configure` and `make -C build word_hint` before reloading.
- A PM2 reload connects to real NapCat and MySQL. Run `pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save` only with explicit deployment authorization.

## Current implementation

- The active word-hint plugin is `dist/plugin-wordhint2.js`; it loads `build/Release/word_hint.node` with `createRequire`.
- The current Node-API source is `word_hint0206_4.cc` and `word_hint0206/solver4.hpp`. Do not substitute legacy `word_hint*.cc` files or `dist/bak/` implementations.
- Changes to query command semantics require checking both ordinary-message and reply-message listeners in `dist/plugin-wordhint2.js`.
- Query result fields span the native addon, JavaScript renderers, and HTML/CSS templates; keep all relevant layers consistent.
