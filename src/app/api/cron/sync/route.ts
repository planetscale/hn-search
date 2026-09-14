import { syncHn, type SyncMode } from '@/lib/hn-sync'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Give the run room to fetch and upsert a large batch. Vercel enforces the
// plan's own ceiling (60s on Hobby, up to 300s on Pro), and the sync stops at
// its internal budget below that, persisting its cursor so the next run resumes.
export const maxDuration = 300

const BUDGET_MS = (maxDuration - 15) * 1000

/** Vercel attaches `Authorization: Bearer $CRON_SECRET` to scheduled requests. */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 })

  const params = request.nextUrl.searchParams
  const mode: SyncMode = params.get('mode') === 'backfill' ? 'backfill' : 'latest'
  const batch = intParam(params.get('batch'), 10000, 1, 20000)
  // Gentle default: Firebase throttles high-concurrency bursts from Vercel's
  // egress IP, and a throttled run persists almost nothing.
  const concurrency = intParam(params.get('concurrency'), 12, 1, 128)
  const fromRaw = params.get('from')
  const from = fromRaw ? intParam(fromRaw, 0, 1, Number.MAX_SAFE_INTEGER) : undefined

  try {
    const result = await syncHn({ mode, batch, concurrency, from, budgetMs: BUDGET_MS })
    const response = Response.json({ ok: true, ...result })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
