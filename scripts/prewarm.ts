import { prewarm } from '../src/lib/prewarm'
import { unpooledUrl } from './env'

async function main() {
  const url = unpooledUrl()
  const { total, results, mb } = await prewarm(url)
  for (const row of results) {
    console.log(`  prewarmed ${row.rel}: ${row.blocks} blocks`)
  }
  console.log(`Done. Warmed ${total} blocks (~${mb} MB).`)
}

main()
