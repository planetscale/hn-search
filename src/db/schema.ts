import { sql } from 'drizzle-orm'
import { bigint, boolean, customType, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

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
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce("by", '') || ' ' || coalesce(regexp_replace(text, '<[^>]+>', ' ', 'g'), ''))`),
  },
  (table) => [
    index('items_type_time_idx').on(table.type, table.time),
    index('items_type_score_idx').on(table.type, table.score),
    index('items_parent_idx').on(table.parent),
    index('items_by_time_idx').on(table.by, table.time),
    index('items_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`),
    index('items_by_trgm_idx').using('gin', sql`${table.by} gin_trgm_ops`),
    index('items_story_new_idx')
      .on(table.time)
      .where(sql`${table.type} = 'story' AND NOT ${table.deleted} AND NOT ${table.dead} AND ${table.title} IS NOT NULL AND ${table.title} <> ''`),
    index('items_titled_time_idx')
      .on(table.time)
      .where(sql`NOT ${table.deleted} AND NOT ${table.dead} AND ${table.title} IS NOT NULL AND ${table.title} <> ''`),
    // Boolean full-text matching for exact match counts: a GIN bitmap scan of
    // search_tsv intersects per-term posting lists, so multi-word (tsquery AND)
    // counts stay exact and fast. Ranking still uses the lakebase_bm25 indexes below.
    index('items_search_gin').using('gin', table.searchTsv),
    // Full corpus, used by the "all" tab and long-tail types (poll, pollopt).
    index('items_search_bm25').using('lakebase_bm25', table.searchTsv),
    // Per-type partial indexes: the query filters by type, so ranking and exact
    // counts happen over the requested type alone instead of being truncated by
    // the shared index's top-N candidate limit.
    index('items_story_bm25')
      .using('lakebase_bm25', table.searchTsv)
      .where(sql`${table.type} = 'story' AND NOT ${table.deleted} AND NOT ${table.dead}`),
    index('items_comment_bm25')
      .using('lakebase_bm25', table.searchTsv)
      .where(sql`${table.type} = 'comment' AND NOT ${table.deleted} AND NOT ${table.dead}`),
    index('items_job_bm25')
      .using('lakebase_bm25', table.searchTsv)
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
