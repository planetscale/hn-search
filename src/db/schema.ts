import { sql } from 'drizzle-orm'
import { bigint, boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Searchable text, indexed as an expression so the corpus is stored once. Every
 * query repeats it verbatim; see SEARCH_EXPR in src/lib/queries.ts.
 */
const searchText = sql`(coalesce(title, '') || ' ' || coalesce("by", '') || ' ' || coalesce(regexp_replace(text, '<[^>]+>', ' ', 'g'), ''))`

export const ITEM_TYPES = ['story', 'comment', 'poll', 'pollopt', 'job'] as const
export type ItemType = (typeof ITEM_TYPES)[number]

export const items = pgTable(
  'items',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    deleted: boolean('deleted').notNull().default(false),
    type: text('type').notNull().$type<ItemType>(),
    by: text('by'),
    time: timestamp('time', { withTimezone: true, mode: 'date' }),
    text: text('text'),
    dead: boolean('dead').notNull().default(false),
    parent: bigint('parent', { mode: 'number' }),
    poll: bigint('poll', { mode: 'number' }),
    kids: bigint('kids', { mode: 'number' })
      .array()
      .notNull()
      .default(sql`'{}'::bigint[]`),
    url: text('url'),
    score: integer('score'),
    title: text('title'),
    parts: bigint('parts', { mode: 'number' })
      .array()
      .notNull()
      .default(sql`'{}'::bigint[]`),
    descendants: integer('descendants'),
  },
  (table) => [
    index('items_type_time_idx').on(table.type, table.time),
    index('items_type_score_idx').on(table.type, table.score),
    index('items_parent_idx').on(table.parent),
    index('items_by_time_idx').on(table.by, table.time),
    index('items_story_new_idx')
      .on(table.time)
      .where(sql`${table.type} = 'story' AND NOT ${table.deleted} AND NOT ${table.dead} AND ${table.title} IS NOT NULL AND ${table.title} <> ''`),
    index('items_titled_time_idx')
      .on(table.time)
      .where(sql`NOT ${table.deleted} AND NOT ${table.dead} AND ${table.title} IS NOT NULL AND ${table.title} <> ''`),
    // One `tin` index per tab, each answering both the match (`==>`) and the
    // BM25 ranking (`tin.score(ctid)`). Its scan is a true top-K, so there is no
    // candidate cap to tune. Each predicate is exactly the WHERE clause the app
    // writes for that tab: TIN takes a matching predicate as given rather than
    // re-checking it per row, so matching, ranking and an exact `count(*)` all
    // stay inside the index. This one covers the `all` tab and the long-tail
    // types (poll, pollopt).
    index('items_search_tin')
      .using('tin', searchText)
      .where(sql`NOT ${table.deleted} AND NOT ${table.dead}`),
    index('items_story_tin')
      .using('tin', searchText)
      .where(sql`${table.type} = 'story' AND NOT ${table.deleted} AND NOT ${table.dead}`),
    index('items_comment_tin')
      .using('tin', searchText)
      .where(sql`${table.type} = 'comment' AND NOT ${table.deleted} AND NOT ${table.dead}`),
    index('items_job_tin')
      .using('tin', searchText)
      .where(sql`${table.type} = 'job' AND NOT ${table.deleted} AND NOT ${table.dead}`),
  ],
)

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert

/**
 * Cursor for the live HN sync (see `src/lib/hn-sync.ts`). One row per mode:
 * `latest` remembers the highest max item id seen, `backfill` the forward
 * catch-up position. Created idempotently by the sync itself, so the cron works
 * even before `db:migrate` runs.
 */
export const syncState = pgTable('sync_state', {
  key: text('key').primaryKey(),
  lastId: bigint('last_id', { mode: 'number' }).notNull().default(0),
  synced: integer('synced').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export type SyncStateRow = typeof syncState.$inferSelect
