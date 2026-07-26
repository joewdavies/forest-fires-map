# Agent Rules

See `CLAUDE.md` at the repo root first — it has the full architecture,
data-flow, and gotcha writeups this file only summarizes. Read it before
touching `src/effis.ts`, `src/map.ts`, or anything EFFIS/WMTS-related.

## Workflow

- Always push changes (e.g., `git push`) when completing a task.
- There is no test suite or linter configured. The only automated check is
  the TypeScript compiler: run `npx tsc -b` (or `npm run build`, which does
  the same type-check before bundling) before considering a change done.
  `tsconfig.json` has `strict`, `noUnusedLocals`, and `noUnusedParameters`
  on — delete unused code rather than prefixing it with `_`.
- If you bump `maplibre-gl`, rerun `npm run copy-maplibre-worker` (or just
  `npm run dev` / `npm run build`, which run it automatically via
  `predev`/`prebuild`). The copied worker files in `public/` aren't tracked
  by npm's dependency resolution and won't update on their own.
- If you change how EFFIS is called, or add/rename a layer, update
  `CLAUDE.md` to match — it documents *why* the current WFS/WMTS setup
  looks the way it does, and stale docs there will send the next agent
  chasing a dead end (e.g. re-trying WMS, which is confirmed not to work).

## Commits

- Short, imperative subject line (e.g. "Fix 3D style tile URL"), no body,
  matching existing history (`git log --oneline`).
- Do not add a "Co-Authored-By: Claude …" trailer or any AI co-author
  attribution.

## Repo-specific traps (see `CLAUDE.md` for the full story on each)

- EFFIS has three protocols (WFS/WMS/WMTS) and only WMTS reliably works,
  and only at the `/effist/wmts` mount (not `/effis/wmts`). Don't
  reintroduce WFS or WMS for anything current-fires-related without
  re-reading the "EFFIS WFS vs WMS vs WMTS" section first.
- A raster tile request returning HTTP 200 does not mean it returned
  useful image data — some EFFIS layers 200 with a fully blank/transparent
  tile. If a layer looks broken, decode and look at an actual tile before
  concluding the request shape is wrong.
- `api/effis.ts`, `api/wmts.ts`, and the two proxy entries in
  `vite.config.ts` must stay behaviorally in sync — they're deliberately
  separate (not one generic proxy) to avoid Vite's prefix-matching
  swallowing one route with the other.
- maplibre-gl v6 has no default export; use named imports
  (`import { Map, ... } from "maplibre-gl"`).
- No Prettier/ESLint config is checked in, but match the existing style
  seen in the file you're editing (double quotes, one CSS property per
  line for multi-value `transition`s, etc.) rather than introducing a new
  convention.
