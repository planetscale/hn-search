import { typeahead } from '@/lib/queries'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? ''
  const rows = q ? await typeahead(q) : []
  const response = Response.json(rows)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
