export type Workspace = {
  id: string
  name: string
  branch: string
  projectId: string
  projectName: string
  worktreePath: string
  createdAt: string
  lastActivityAt: number
}

export type Terminal = {
  terminalId: string
  workspaceId: string
  createdAt: number
  exited: boolean
  title: string
}

export type Project = { id: string; name: string; path: string }

export type DiffStat = { files: number; added: number; removed: number }

export type Screen = { terminalId: string; text: string; changedAt: number }

export type Diff = { workspaceId: string; base: string; stat: string; patch: string; untracked: string[] }

export type Banner = { text: string; isError: boolean }

export type Tab = 'agent' | 'diff' | 'info'

export type Mode = 'browse' | 'new'

export type Form = { projectId: string; branch: string; prompt: string }

declare module 'claude-code' {
  interface PluginState {
    'superset-deck': {
      workspaces: Workspace[]
      terminals: Record<string, Terminal[]>
      stats: Record<string, DiffStat>
      projects: Project[]
      selected: string | null
      terminal: string | null
      tab: Tab
      mode: Mode
      form: Form
      screen: Screen | null
      diff: Diff | null
      diffOffset: number
      confirmDelete: string | null
      busy: string | null
      banner: Banner | null
      loadedAt: number
      frame: number
    }
  }
}
