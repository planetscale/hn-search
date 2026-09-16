# Hacker News Search

Full-text search over the entire Hacker News corpus (~49M stories, comments, jobs and polls), served live from [PlanetScale Postgres](https://planetscale.com) with BM25 ranking. Every keystroke is a query against Postgres, and the UI is styled to feel like a search box bolted onto news.ycombinator.com.

## Design notes

- **[Next.js 16](https://nextjs.org)**: App Router, React Server Components, streaming SSR. Every page ships its shell (masthead, search box) instantly and streams the data through a React `<Suspense>` boundary. The boundary carries no key, so a search navigating inside a transition keeps the results already on screen and swaps in the new ones once they arrive — the skeleton is only for the first load, when there is nothing to hold. The match count is a second, nested boundary that fills in after the results.
- **[PlanetScale Postgres](https://planetscale.com)** over a pooled `pg` connection. A single `Pool` (`max: 8`, see [`src/db/index.ts`](src/db/index.ts)) is created once and reused across requests, so every query reuses a warm connection instead of opening a new one per request.
- **Postgres is the search engine.** The `tin` extension indexes an expression over the raw columns, so the searchable text is never duplicated into a generated column. A match is `<expr> ==> 'query'` and ranking is `ORDER BY tin.score(ctid) DESC`.
- **Four partial `tin` indexes, one per tab, over the plain searchable text.** Every query repeats the same expression (`SEARCH_EXPR` in [`src/lib/queries.ts`](src/lib/queries.ts)):

  ```sql
  coalesce(title,'') || ' ' || coalesce("by",'') || ' ' || coalesce(regexp_replace(text,'<[^>]+>',' ','g'),'')
  ```

  `items_search_tin` covers `WHERE NOT deleted AND NOT dead` — the `all` tab and the long-tail poll/pollopt types. `items_story_tin`, `items_comment_tin`, and `items_job_tin` each add `type = '<t>'` to that predicate. Each index's predicate is exactly the `WHERE` clause the app writes for that tab, so TIN takes the predicate as given instead of re-checking it row by row: matching, BM25 ranking, and an exact `count(*)` all stay inside the index, and the planner picks the right index per tab with no index named in the query. Since the corpus is 85% comments, a per-type index keeps a tab's ranking and counting scoped to that type instead of drowning in comment matches. Sizes on the 49.7M-row corpus: all-types 13 GB, comment 12 GB, story 865 MB, job 15 MB.

- **Match counts are exact.** `count(*)` runs as TIN's index-only `Custom Scan (Tin Count)`, which reads the index and nothing else: counting the 29.4M comments containing "the" touches about a hundred pages and returns in under a millisecond. Two things are load-bearing for that. The aggregate is selected bare, because casting it — even to `int` — costs TIN the custom scan and falls back to a scan seventy times slower. And the table needs a current visibility map, or the count has to visit the heap to check each match; after a bulk load that means `VACUUM`, not just `ANALYZE`, which is why both the seed and the backfill finish with one. There's no count cap and no planner-estimate fallback. (The footer's corpus size is still an approximation, read from `pg_class.reltuples`.)
- **The search box maps onto TIN's query language** via `toTinQuery()` in [`src/lib/queries.ts`](src/lib/queries.ts): quoted runs stay phrases, `-word` and `-"a phrase"` exclude, `OR` joins, everything else is ANDed.
- **Matches are highlighted in place.** `tin.highlight()` marks the matched runs of each title and comment, taking the query explicitly — TIN infers it only when the `==>` is over the highlighted column, and this one matches a concatenation of three. It marks with two control characters instead of `<b>`, so the renderer splits on a delimiter that cannot occur in a Hacker News comment and builds real `<mark>` elements: user-written text never becomes markup. Highlighting returns the whole document and chooses no excerpt, so `excerpt()` in [`src/lib/highlight.ts`](src/lib/highlight.ts) trims each comment to a window around its first match — the part you searched for, rather than whatever opens the comment. Only a ranked scan bounds how many rows get highlighted, since the top-K projects a page's worth; ordering by date or points sorts every match instead, so those queries pick the page first and highlight only those thirty rows.
- **The last word is a prefix until you press Enter.** A word the user may still be adding to is matched as a prefix (`openbsd chro` searches `"openbsd" AND chro*`), which is what makes results useful mid-word. Enter settles the query and matches that word literally. A word of one to three characters is matched literally either way: expanding so short a prefix unions a large slice of the term dictionary — `th*` matches 20.9M rows where `"th"` matches 9k — for no useful narrowing. Prefix expansion is the expensive part of a live search box, and the cost does not track word length: most are quick (`data*` 233ms, `goog*` 241ms across 43M comments) while the worst run into seconds (`comp*` 3.5s). Constants: `DEBOUNCE_MS` in [`src/components/search-form.tsx`](src/components/search-form.tsx), `MIN_WILDCARD_LENGTH` in [`src/lib/queries.ts`](src/lib/queries.ts).
- **[Drizzle](https://orm.drizzle.team)** for the schema and migrations, **[Tailwind v4](https://tailwindcss.com)** for styling.

See [`src/lib/queries.ts`](src/lib/queries.ts) for the query builder and [`src/app/page.tsx`](src/app/page.tsx) for the streaming boundaries.

## Deployment

Deployed on Vercel in `iad1` (Washington, D.C.), the region backing AWS `us-east-1`, where the database lives. Functions run beside the database rather than a round trip away, which is most of what a query costs: the same search takes about 15ms of that round trip from a laptop and well under a millisecond from `iad1`. The dominant cost driver is the hourly cron function, not per-request query load.

Two connection strings, because the pages only ever read:

- `DATABASE_URL_UNPOOLED` is what a deployment runs as, and needs nothing beyond `SELECT` on `items`.
- `DATABASE_URL_SYNC` is what the hourly sync writes with. Leave it unset and `/api/cron/sync` answers `501` instead of failing every hour — the corpus stops updating, and nothing reachable from the internet holds a credential that can change the database.

`CRON_SECRET` authenticates the cron; Vercel sends it as `Authorization: Bearer …` on scheduled calls. Unset, the route refuses everything, so the sync only runs where a secret was set deliberately. Env vars are baked at build time, so redeploy after changing them.

A production deployment is public by default. To keep it to your team, set **Settings → Deployment Protection → Vercel Authentication** with the scope **All Deployments**; the default scope, Standard Protection, leaves production domains open.

## Local dev

1. **Install and configure.**

   ```bash
   npm install
   cp .env.example .env   # fill in DATABASE_URL_UNPOOLED
   ```

2. **Create the schema and load the corpus.** The seed streams the [ClickHouse Hacker News dataset](https://clickhouse.com/docs/get-started/sample-datasets/hacker-news) straight into Postgres with parallel `COPY`, then builds the indexes. `tin` indexes are built by default; skip them with `--skip-tin` because they are large:

   ```bash
   npm run db:migrate    # tin extension + tables + btree indexes
   npm run db:seed       # download, COPY, tin indexes (--skip-tin to skip them)
   ```

   Useful seed flags: `--streams=8`, `--batch=20000`, `--limit=100000` (small sample), `--skip-download`, `--skip-unzip`.

3. **(Optional) Warm the cache** so the first queries are fast after a restart:

   ```bash
   npm run db:prewarm
   ```

4. **Run it.**

   ```bash
   npm run dev
   ```

### Scripts

| Command                          | Purpose                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev` / `build`          | Next.js dev server / production build                                         |
| `npm run typecheck`              | `tsc --noEmit`                                                                |
| `npm run db:generate`            | Regenerate Drizzle migrations from `src/db/schema.ts`                         |
| `npm run db:migrate`             | Apply the `tin` extension + `items` and `sync_state` tables                   |
| `npm run db:seed`                | Bulk-load the HN dump and build the `tin` indexes (`--skip-tin` to skip them) |
| `npm run db:backfill`            | Two-phase (fetch to disk, then load) backfill of the 2021-to-now gap          |
| `npm run db:prewarm`             | `pg_prewarm` the table and every index                                        |
| `tsx scripts/inspect-indexes.ts` | Dump table columns, extensions, and index sizes                               |

## Staying live

The seed dump stops around late 2021 (item id ~28.7M) while Hacker News is past 49M. A Vercel cron ([`vercel.json`](vercel.json), hourly) pulls from the official [HN Firebase API](https://github.com/HackerNews/API) to keep the corpus current.

- **`GET /api/cron/sync`** ([`route`](src/app/api/cron/sync/route.ts), [`lib`](src/lib/hn-sync.ts)) fetches item ids concurrently, maps them to the `items` schema, and upserts them in parameterized multi-row batches. The `tin` indexes maintain themselves on write, so new rows are searchable the moment they land.
- **`mode=latest`** (the default) refreshes the newest window ending at the current max item id, so today's stories and comments appear right away and their scores and comment counts stay fresh.
- **`mode=backfill`** walks a separate forward cursor from where the seed ended, closing the 2021-to-now gap a batch at a time. Point a second cron or a manual request at `/api/cron/sync?mode=backfill` to fill history slowly while staying live.

Each run is bounded by a wall-clock budget and persists its cursor to the `sync_state` table, so it stops cleanly at the function's time limit and the next run resumes. Tune per request with `?batch=`, `?concurrency=`, `?from=`.

For the full ~21M-row gap, run [`scripts/backfill.ts`](scripts/backfill.ts) (`npm run db:backfill`) instead. It is split into two phases so a crash never discards downloaded data:

```bash
# 1. Download the whole range to local gzipped, COPY-ready shards (resumable).
npm run db:backfill -- --phase=fetch

# 2a. Load keeping search online (staging + ON CONFLICT, every index maintained).
npm run db:backfill -- --phase=load --mode=online

# 2b. Or load fast in a maintenance window: drop all 12 secondary indexes,
#     bulk-load with only the primary key, then rebuild the indexes once.
npm run db:backfill -- --phase=load --mode=rebuild --workers=6
```
