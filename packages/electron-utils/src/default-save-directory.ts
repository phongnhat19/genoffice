import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** Global destination for newly created Office files. */
export function defaultSaveDirectory(): string {
  let configured: unknown
  try {
    configured = (JSON.parse(
      readFileSync(join(app.getPath('userData'), 'app-settings.json'), 'utf8'),
    ) as Record<string, unknown>).defaultSaveDirectory
  } catch {
    // Missing or malformed settings fall back to the historical location.
  }
  const directory =
    typeof configured === 'string' && configured.trim()
      ? configured
      : join(app.getPath('documents'), 'ORIO')
  mkdirSync(directory, { recursive: true })
  return directory
}
