/**
 * Sheet guide text is now a server-owned ORIO skill. This compatibility
 * catalog lets the local executor reject stale clients without carrying any
 * guide instruction in the desktop bundle.
 */
export interface GuideEntry {
  readonly description: string
  readonly content: string
}

export const GUIDE_CATALOG: Readonly<Record<string, GuideEntry>> = {}
export const GUIDE_NAMES: string[] = []

export function guideCatalogSummary(): string { return 'Server-managed by ORIO.' }

export function loadGuides(_names: readonly string[]): { ok: true; content: string } | { ok: false; error: string } {
  return { ok: false, error: 'Workbook guides are managed by ORIO and are unavailable to this desktop client.' }
}
