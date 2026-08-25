import React, { useEffect, useMemo, useState } from 'react'

export interface ProjectMention {
  projectId: string
  rootPath?: string
  path: string
  name: string
  ext: string
  sizeBytes: number
}

interface RootEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  ext?: string
  sizeBytes?: number
}

interface ProjectApiLike {
  getProjectRoot(args: { projectId: string }): Promise<{ rootPath?: string; available: boolean }>
  listProjectRoot(args: { projectId: string; path?: string }): Promise<RootEntry[]>
}

/** Compact root-relative browser used by all AI composers for @file mentions. */
export function ProjectMentionPicker({
  projectId,
  open,
  query,
  onSelect,
  onClose,
}: {
  projectId: string | null
  open: boolean
  query: string
  onSelect: (mention: ProjectMention) => void
  onClose: () => void
}): React.JSX.Element | null {
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<RootEntry[]>([])
  const [available, setAvailable] = useState<boolean | null>(null)
  const [rootPath, setRootPath] = useState<string | undefined>()
  const [active, setActive] = useState(0)
  const api = (window as unknown as { projectApi?: ProjectApiLike }).projectApi

  useEffect(() => {
    if (!open || !projectId || !api) return
    let alive = true
    void api.getProjectRoot({ projectId }).then((result) => {
      if (!alive) return
      setAvailable(result.available)
      setRootPath(result.rootPath)
      if (!result.available) return
      void api.listProjectRoot({ projectId, ...(path ? { path } : {}) }).then((next) => {
        if (alive) {
          setEntries(next)
          setActive(0)
        }
      })
    })
    return () => {
      alive = false
    }
  }, [api, open, path, projectId])

  const visible = useMemo(() => {
    const needle = query.toLocaleLowerCase()
    return needle
      ? entries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle))
      : entries
  }, [entries, query])

  if (!open) return null
  const choose = (entry: RootEntry) => {
    if (entry.kind === 'directory') {
      setPath(entry.path)
      return
    }
    onSelect({
      projectId: projectId ?? 'default',
      ...(rootPath ? { rootPath } : {}),
      path: entry.path,
      name: entry.name,
      ext: entry.ext ?? '',
      sizeBytes: entry.sizeBytes ?? 0,
    })
  }
  return (
    <div className="ai-mention-picker" role="dialog" aria-label="Project files">
      <div className="ai-mention-picker-head">
        <button disabled={!path} onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}>
          ←
        </button>
        <span title={path || 'Project root'}>{path || 'Project root'}</span>
        <button onClick={onClose} aria-label="Close file mentions">
          ×
        </button>
      </div>
      {!projectId || available === false ? (
        <div className="ai-mention-empty">
          Configure this project’s folder from Home to mention files.
        </div>
      ) : visible.length === 0 ? (
        <div className="ai-mention-empty">No matching supported files.</div>
      ) : (
        <div
          role="listbox"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((i) => Math.min(i + 1, visible.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const entry = visible[active]
              if (entry) choose(entry)
            }
            if (event.key === 'Escape') onClose()
          }}
        >
          {visible.map((entry, index) => (
            <button
              key={`${entry.kind}:${entry.path}`}
              className={index === active ? 'active' : ''}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(entry)}
            >
              <span aria-hidden>{entry.kind === 'directory' ? '▸' : '@'}</span> {entry.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
