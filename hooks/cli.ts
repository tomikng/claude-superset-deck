import type { DiffStat, Project, Terminal, Workspace } from '../types'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export const parseWorkspaces = (json: unknown): Workspace[] =>
  (Array.isArray(json) ? json : [])
    .map(rec)
    .filter(w => !w.archivedAt)
    .map(w => ({
      id: str(w.id),
      name: str(w.name),
      branch: str(w.branch),
      projectId: str(w.projectId),
      projectName: str(w.projectName) || 'session',
      worktreePath: str(w.worktreePath),
      createdAt: str(w.createdAt),
      lastActivityAt: num(w.lastActivityAt),
    }))

export const parseTerminals = (json: unknown): Terminal[] =>
  (Array.isArray(rec(json).sessions) ? (rec(json).sessions as unknown[]) : []).map(rec).map(t => ({
    terminalId: str(t.terminalId),
    workspaceId: str(t.workspaceId),
    createdAt: num(t.createdAt),
    exited: t.exited === true,
    title: str(t.customTitle) || str(t.title),
  }))

export const parseProjects = (json: unknown): Project[] =>
  (Array.isArray(json) ? json : []).map(rec).map(p => ({ id: str(p.id), name: str(p.name), path: str(p.path) }))

export const parseShortstat = (text: string): DiffStat => ({
  files: Number(/(\d+) files? changed/.exec(text)?.[1] ?? 0),
  added: Number(/(\d+) insertions?/.exec(text)?.[1] ?? 0),
  removed: Number(/(\d+) deletions?/.exec(text)?.[1] ?? 0),
})

export const ago = (ms: number, now: number): string => {
  if (!ms) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

export const slug = (text: string): string =>
  text
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
