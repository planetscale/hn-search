import { pgConnectionConfig } from '@/lib/pg-url'
import { Client } from 'pg'

const RELATIONS = ['items', 'items_pkey', 'items_type_time_idx', 'items_type_score_idx', 'items_parent_idx', 'items_by_time_idx', 'items_story_new_idx', 'items_titled_time_idx', 'items_search_tin']

export async function prewarm(databaseUrl: string) {
  const client = new Client({ ...pgConnectionConfig(databaseUrl), statement_timeout: 0, query_timeout: 0 })
  await client.connect()
  try {
    // pg_prewarm is not part of the app's schema, so the warm-up installs it itself.
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_prewarm')
    let total = 0
    const results: Array<{ rel: string; blocks: number }> = []
    for (const rel of RELATIONS) {
      try {
        const { rows } = await client.query<{ blocks: string }>('SELECT pg_prewarm($1::regclass) AS blocks', [rel])
        const blocks = Number(rows[0].blocks)
        total += blocks
        results.push({ rel, blocks })
      } catch {
        results.push({ rel, blocks: 0 })
      }
    }
    return { total, results, mb: Math.round((total * 8) / 1024) }
  } finally {
    await client.end()
  }
}
