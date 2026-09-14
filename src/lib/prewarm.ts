import { neon } from '@neondatabase/serverless'

const RELATIONS = [
  'items',
  'items_pkey',
  'items_type_time_idx',
  'items_type_score_idx',
  'items_parent_idx',
  'items_by_time_idx',
  'items_title_trgm_idx',
  'items_by_trgm_idx',
  'items_story_new_idx',
  'items_titled_time_idx',
  'items_search_gin',
  'items_search_bm25',
  'items_story_bm25',
  'items_comment_bm25',
  'items_job_bm25',
]

export async function prewarm(databaseUrl: string) {
  const sql = neon(databaseUrl)
  await sql`CREATE EXTENSION IF NOT EXISTS pg_prewarm`
  let total = 0
  const results: Array<{ rel: string; blocks: number }> = []
  for (const rel of RELATIONS) {
    try {
      const rows = await sql`SELECT pg_prewarm(${rel}::regclass) AS blocks`
      const blocks = Number(rows[0].blocks)
      total += blocks
      results.push({ rel, blocks })
    } catch {
      results.push({ rel, blocks: 0 })
    }
  }
  return { total, results, mb: Math.round((total * 8) / 1024) }
}
