import type { ClientConfig } from 'pg'

/**
 * Turns a PlanetScale connection string into a node-postgres config.
 *
 * The URL carries libpq's `sslmode=verify-full&sslrootcert=system`, which
 * node-postgres does not understand — it reads `sslrootcert` as a file path and
 * fails on `'system'`. Node already ships the same public CA bundle libpq means
 * by `system`, so the equivalent is to drop both parameters and verify against
 * the default trust store.
 */
export function pgConnectionConfig(url: string): ClientConfig {
  const parsed = new URL(url)
  parsed.searchParams.delete('sslmode')
  parsed.searchParams.delete('sslrootcert')
  return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: true } }
}
