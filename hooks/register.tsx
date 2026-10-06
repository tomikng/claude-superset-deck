import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Banner, Diff, DiffStat, Form, Mode, Project, Screen, Tab, Terminal, Workspace } from '../types'
import { ago, parseProjects, parseShortstat, parseTerminals, parseWorkspaces, slug } from './cli'
import { iconsFor } from './icons'

const PANE = 'superset-deck'
const TITLE = 'Superset'
const COMMANDS = ['deck', 'superset-deck']

const workspaces = atom({ plugin: 'superset-deck', key: 'workspaces' } as const, [] as Workspace[])
const terminals = atom({ plugin: 'superset-deck', key: 'terminals' } as const, {} as Record<string, Terminal[]>)
const stats = atom({ plugin: 'superset-deck', key: 'stats' } as const, {} as Record<string, DiffStat>)
const projects = atom({ plugin: 'superset-deck', key: 'projects' } as const, [] as Project[])
const selected = atom({ plugin: 'superset-deck', key: 'selected' } as const, null as string | null)
const terminal = atom({ plugin: 'superset-deck', key: 'terminal' } as const, null as string | null)
const tab = atom({ plugin: 'superset-deck', key: 'tab' } as const, 'agent' as Tab)
const mode = atom({ plugin: 'superset-deck', key: 'mode' } as const, 'browse' as Mode)
const form = atom({ plugin: 'superset-deck', key: 'form' } as const, { projectId: '', branch: '', prompt: '' } as Form)
const screen = atom({ plugin: 'superset-deck', key: 'screen' } as const, null as Screen | null)
const diff = atom({ plugin: 'superset-deck', key: 'diff' } as const, null as Diff | null)
const diffOffset = atom({ plugin: 'superset-deck', key: 'diffOffset' } as const, 0)
const confirmDelete = atom({ plugin: 'superset-deck', key: 'confirmDelete' } as const, null as string | null)
const busy = atom({ plugin: 'superset-deck', key: 'busy' } as const, null as string | null)
const banner = atom({ plugin: 'superset-deck', key: 'banner' } as const, null as Banner | null)
const loadedAt = atom({ plugin: 'superset-deck', key: 'loadedAt' } as const, 0)
const frame = atom({ plugin: 'superset-deck', key: 'frame' } as const, 0)

type Run = { ok: true; json: unknown; stdout: string } | { ok: false; error: string }

// One `superset` call on this machine; every answer parsed from --json.
async function superset($: EngineInterface, args: readonly string[], timeoutMs = 30_000): Promise<Run> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['superset', ...args, '--json'], { timeoutMs })
    if (exitCode !== 0) {
      return { ok: false, error: (stderr || stdout).trim().split('\n')[0] || `superset exited ${exitCode}` }
    }
    try {
      return { ok: true, json: JSON.parse(stdout), stdout }
    } catch {
      return { ok: true, json: null, stdout }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function git($: EngineInterface, cwd: string, args: readonly string[]) {
  try {
    const r = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 15_000 })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

// The commit the branch forked from: merge-base with the remote's default branch.
async function forkPoint($: EngineInterface, cwd: string): Promise<string | null> {
  const head = (await git($, cwd, ['rev-parse', '--abbrev-ref', 'origin/HEAD']))?.trim()
  for (const base of [head, 'origin/main', 'origin/master', 'main', 'master']) {
    if (!base) continue
    const mb = (await git($, cwd, ['merge-base', 'HEAD', base]))?.trim()
    if (mb) return mb
  }
  return null
}

async function diffStat($: EngineInterface, cwd: string): Promise<DiffStat | null> {
  const base = await forkPoint($, cwd)
  if (!base) return null
  const out = await git($, cwd, ['diff', '--shortstat', base])
  return out === null ? null : parseShortstat(out)
}

async function fullDiff($: EngineInterface, cwd: string) {
  const base = await forkPoint($, cwd)
  if (!base) return null
  const [stat, patch, untracked] = await Promise.all([
    git($, cwd, ['diff', '--stat=100', base]),
    git($, cwd, ['diff', '--no-color', base]),
    git($, cwd, ['ls-files', '--others', '--exclude-standard']),
  ])
  return {
    base: base.slice(0, 8),
    stat: (stat ?? '').trimEnd(),
    patch: (patch ?? '').slice(0, 400_000),
    untracked: (untracked ?? '').split('\n').filter(Boolean),
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Hands back the old value when nothing changed, so a quiet poll keeps its identity.
const keep = <T,>(prev: T, next: T): T => (same(prev, next) ? prev : next)


const ACTIVE_MS = 90_000
const SCREEN_ACTIVE_MS = 6_000

const liveTerminals = (list: readonly Terminal[] | undefined) => (list ?? []).filter(t => !t.exited)

// Workspaces grouped by project, both ordered by most recent activity.
const grouped = (list: readonly Workspace[]) => {
  const groups = new Map<string, Workspace[]>()
  for (const w of [...list].sort((a, b) => b.lastActivityAt - a.lastActivityAt)) {
    groups.set(w.projectName, [...(groups.get(w.projectName) ?? []), w])
  }
  return [...groups.entries()]
}

const ordered = (list: readonly Workspace[]) => grouped(list).flatMap(([, ws]) => ws)

const cut = (text: string, width: number) =>
  width <= 1 ? '' : text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text

let icons = iconsFor('nerd')
let agentPreset = 'claude'
let showBand = true

let inflight: Promise<void> | null = null
let isReading = false
let lastStatsAt = 0
let lastProjectsAt = 0

const paneShown = async ($: EngineInterface) => (await $.ui.panes()).some(p => p.id === PANE && p.isShown)

async function flash($: EngineInterface, text: string, isError = false) {
  await update($, banner, () => ({ text, isError }))
  $.clock.after(6000, () => {
    void update($, banner, now => (now?.text === text ? null : now))
  })
}

// One refresh at a time; a caller arriving mid-refresh waits for that one.
function refresh($: EngineInterface, opts: { force?: boolean } = {}): Promise<void> {
  inflight ??= loadAll($, opts).finally(() => {
    inflight = null
  })
  return inflight
}

async function loadAll($: EngineInterface, opts: { force?: boolean }) {
  {
    const listed = await superset($, ['ws', 'list', '--local'])
    if (!listed.ok) {
      await update($, banner, prev => keep(prev, { text: `superset ws list: ${listed.error}`, isError: true }))
      return
    }
    const list = parseWorkspaces(listed.json)
    await update($, workspaces, prev => keep(prev, list))

    const now = Date.now()
    const termPairs = await Promise.all(
      list.map(async w => {
        const r = await superset($, ['terminals', 'list', '--local', '--workspace', w.id])
        return [w.id, r.ok ? parseTerminals(r.json) : []] as const
      }),
    )
    await update($, terminals, prev => keep(prev, Object.fromEntries(termPairs)))

    if (opts.force || now - lastStatsAt > 30_000) {
      lastStatsAt = now
      const statPairs = await Promise.all(
        list.map(async w => [w.id, w.worktreePath ? await diffStat($, w.worktreePath) : null] as const),
      )
      const next = Object.fromEntries(statPairs.filter((p): p is readonly [string, DiffStat] => p[1] !== null))
        await update($, stats, prev => keep(prev, next))
    }

    if (opts.force || now - lastProjectsAt > 120_000) {
      lastProjectsAt = now
      const p = await superset($, ['projects', 'list'])
      if (p.ok) await update($, projects, prev => keep(prev, parseProjects(p.json)))
    }

    const current = await read($, selected)
    if (!current || !list.some(w => w.id === current)) {
      await update($, selected, prev => keep(prev, ordered(list)[0]?.id ?? null))
    }
    await pickTerminal($)
    await update($, loadedAt, prev => keep(prev, now))
  }
}

// Keeps the chosen terminal valid: the newest live one of the selected workspace.
async function pickTerminal($: EngineInterface) {
  const id = await read($, selected)
  const live = liveTerminals(id ? (await read($, terminals))[id] : [])
  const current = await read($, terminal)
  if (!current || !live.some(t => t.terminalId === current)) {
    await update($, terminal, prev => keep(prev, [...live].sort((a, b) => b.createdAt - a.createdAt)[0]?.terminalId ?? null))
  }
}

async function readScreen($: EngineInterface, rows = 60) {
  if (isReading) return
  const [ws, term] = [await read($, selected), await read($, terminal)]
  if (!ws || !term) {
    await update($, screen, prev => keep(prev, null))
    return
  }
  isReading = true
  try {
    const r = await superset($, [
      'terminals', 'read', '--local', '--workspace', ws, '--terminal', term, '--max-lines', String(rows),
    ])
    if (!r.ok) return
    const text = typeof (r.json as { text?: unknown })?.text === 'string' ? (r.json as { text: string }).text : ''
    const prev = await read($, screen)
    if (prev?.terminalId === term && prev.text === text) return
    await update($, screen, () => ({ terminalId: term, text, changedAt: Date.now() }))
  } finally {
    isReading = false
  }
}

async function loadDiff($: EngineInterface) {
  const id = await read($, selected)
  const w = (await read($, workspaces)).find(x => x.id === id)
  if (!w?.worktreePath) return void (await update($, diff, () => null))
  await update($, busy, () => 'Reading diff…')
  try {
    const d = await fullDiff($, w.worktreePath)
    await update($, diff, () => (d ? { workspaceId: w.id, ...d } : null))
    await update($, diffOffset, () => 0)
  } finally {
    await update($, busy, () => null)
  }
}

async function select($: EngineInterface, id: string) {
  await update($, selected, () => id)
  await update($, confirmDelete, () => null)
  await update($, mode, () => 'browse' as Mode)
  await update($, screen, () => null)
  await update($, terminal, () => null)
  await pickTerminal($)
  if ((await read($, tab)) === 'diff') await loadDiff($)
  else void readScreen($)
}

async function move($: EngineInterface, by: number) {
  const list = ordered(await read($, workspaces))
  if (list.length === 0) return
  const current = await read($, selected)
  const i = list.findIndex(w => w.id === current)
  const next = list[(Math.max(0, i) + by + list.length) % list.length]
  if (next) await select($, next.id)
}

async function switchTab($: EngineInterface, t: Tab) {
  await update($, tab, () => t)
  await update($, mode, () => 'browse' as Mode)
  if (t === 'diff') await loadDiff($)
  if (t === 'agent') void readScreen($)
}

async function send($: EngineInterface, text: string) {
  const body = text.trim()
  const ws = await read($, selected)
  if (!body || !ws) return
  const term = await read($, terminal)
  await update($, busy, () => (term ? 'Sending…' : `Starting ${agentPreset}…`))
  try {
    if (term) {
      const r = await superset($, ['terminals', 'send', '--local', '--workspace', ws, '--terminal', term, '--text', body])
      if (r.ok) await flash($, 'Sent to the agent')
      else await flash($, r.error, true)
    } else {
      const r = await superset($, ['agents', 'create', '--local', '--workspace', ws, '--agent', agentPreset, '--prompt', body])
      if (!r.ok) return flash($, r.error, true)
      const out = (r.json ?? {}) as { sessionId?: string; terminalId?: string }
      await refresh($)
      const started = out.terminalId ?? out.sessionId
      if (started) await update($, terminal, () => started)
      await flash($, `${agentPreset} started`)
    }
    $.clock.after(800, () => void readScreen($))
  } finally {
    await update($, busy, () => null)
  }
}

async function create($: EngineInterface) {
  const f = await read($, form)
  const branch = slug(f.branch)
  if (!f.projectId) return flash($, 'Pick a project first', true)
  if (!branch) return flash($, 'Give the workspace a branch name', true)
  await update($, busy, () => `Creating ${branch}…`)
  try {
    const args = ['ws', 'create', '--local', '--project', f.projectId, '--name', branch, '--branch', branch]
    if (f.prompt.trim()) args.push('--agent', agentPreset, '--prompt', f.prompt.trim())
    const r = await superset($, args, 180_000)
    if (!r.ok) return flash($, r.error, true)
    const out = (r.json ?? {}) as { id?: string; workspaceId?: string; workspace?: { id?: string } }
    await update($, form, () => ({ projectId: f.projectId, branch: '', prompt: '' }))
    await update($, mode, () => 'browse' as Mode)
    await refresh($, { force: true })
    const id = out.id ?? out.workspaceId ?? out.workspace?.id
    if (id) await select($, id)
    await flash($, `Workspace ${branch} is up`)
  } finally {
    await update($, busy, () => null)
  }
}

async function remove($: EngineInterface, id: string) {
  await update($, busy, () => 'Deleting…')
  try {
    const r = await superset($, ['ws', 'delete', '--local', id], 120_000)
    await update($, confirmDelete, () => null)
    if (!r.ok) return flash($, r.error, true)
    await update($, selected, () => null)
    await refresh($, { force: true })
    await flash($, 'Workspace deleted')
  } finally {
    await update($, busy, () => null)
  }
}

async function openInApp($: EngineInterface, id: string) {
  const r = await superset($, ['ws', 'open', '--local', id])
  await flash($, r.ok ? 'Opened in Superset' : r.error, !r.ok)
}

// Main-window mode asks the dock for every column but a sliver of transcript;
// side mode leaves the width to the engine's share (or what the person dragged).
let isMax = false
let needsWiden = false
let screenColumns = 0
const TRANSCRIPT_SLIVER = 24

function openPane($: EngineInterface, focus: boolean, columns = screenColumns) {
  const wide = isMax && columns > 0 ? { columns: Math.max(60, columns - TRANSCRIPT_SLIVER) } : {}
  return $.ui.open({ id: PANE, title: TITLE, ...wide, ...(focus ? { focus: true as const } : {}) })
}

async function toggleMax($: EngineInterface) {
  isMax = !isMax
  await openPane($, true)
}


export const register: Register = (on, options) => {
  icons = iconsFor(options.icons)
  agentPreset = typeof options.agent === 'string' && options.agent ? options.agent : 'claude'
  showBand = options.band !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // `/superset` itself belongs to the Superset plugin's skill namespace.
    for (const name of COMMANDS) {
      await $.command.register({
        name,
        description: 'Superset workspace deck (max | side | new <branch> [prompt] | refresh | close)',
        argumentHint: '[max | side | new <branch> [prompt] | refresh | close]',
      })
    }
    if ((await $.env.get('SUPERSET_DECK_MAIN')) === '1') {
      // The width is known once the pane first draws; it widens itself then.
      isMax = true
      needsWiden = true
      void openPane($, true)
    }
    void refresh($, { force: true })
    $.clock.every(8000, () => void refresh($).catch(() => {}))
    $.clock.every(1500, () => {
      void (async () => {
        if (!(await paneShown($))) return
        if ((await read($, tab)) === 'agent' && (await read($, mode)) === 'browse') await readScreen($)
        const s = await read($, screen)
        const ws = await read($, workspaces)
        const now = Date.now()
        const isBusy =
          (await read($, busy)) !== null ||
          (s !== null && now - s.changedAt < SCREEN_ACTIVE_MS) ||
          ws.some(w => now - w.lastActivityAt < ACTIVE_MS)
        if (isBusy) await update($, frame, f => (f + 1) % 1000)
      })().catch(() => {})
    })
    return started
  })

  on('command.run', async ($, e, next) => {
    if (!COMMANDS.includes(e.command)) return next(e)
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Superset deck closed.' }
    }
    if (verb === 'refresh') {
      await refresh($, { force: true })
      return { text: `Refreshed: ${(await read($, workspaces)).length} workspaces.` }
    }
    if (verb === 'max' || verb === 'side') {
      isMax = verb === 'max'
      screenColumns = e.presentation.columns || screenColumns
      await openPane($, true)
      return { text: isMax ? 'Superset deck maximized.' : 'Superset deck back to a sidebar.' }
    }
    if (verb === 'new') {
      const [branch = '', ...prompt] = rest
      await update($, form, f => ({ ...f, branch, prompt: prompt.join(' ') }))
      await update($, mode, () => 'new' as Mode)
    }
    screenColumns = e.presentation.columns || screenColumns
    await openPane($, true)
    return { text: verb === 'new' ? 'Pick a project to create the workspace in.' : 'Superset deck opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface === 'mobile') return next(e)
    const { Box, Text, Button, Input, Select, Code } = $.ui.resolve(e)
    const cols = e.props.bodyColumns
    if (e.viewport?.columns) screenColumns = e.viewport.columns
    if (needsWiden && screenColumns) {
      needsWiden = false
      void openPane($, false)
    }
    const rows = Math.max(12, (e.viewport?.rows ?? 30) - 3)
    const now = Date.now()

    const [list, terms, stat, projs, sel, term, t, m, f, scr, d, off, del, bz, ban, loaded, fr] =
      await Promise.all([
        read($, workspaces), read($, terminals), read($, stats), read($, projects), read($, selected),
        read($, terminal), read($, tab), read($, mode), read($, form), read($, screen), read($, diff),
        read($, diffOffset), read($, confirmDelete), read($, busy), read($, banner),
        read($, loadedAt), read($, frame),
      ])

    const spin = icons.spinner[fr % icons.spinner.length]
    const ws = list.find(w => w.id === sel) ?? null
    const live = liveTerminals(ws ? terms[ws.id] : [])
    const totalLive = Object.values(terms).reduce((n, l) => n + liveTerminals(l).length, 0)
    const isWide = cols >= 90
    const sideW = isWide ? Math.min(40, Math.max(28, Math.floor(cols * 0.32))) : cols
    const mainW = isWide ? cols - sideW - 1 : cols

    const statusOf = (w: Workspace) => {
      const l = liveTerminals(terms[w.id]).length
      const isHot = now - w.lastActivityAt < ACTIVE_MS || (w.id === sel && scr && now - scr.changedAt < SCREEN_ACTIVE_MS)
      if (l > 0 && isHot) return { glyph: spin, color: 'yellow', word: 'working' }
      if (l > 0) return { glyph: icons.live, color: 'green', word: `${l} live` }
      return { glyph: icons.idle, color: 'gray', word: 'idle' }
    }

    const StatText = ({ s }: { s: DiffStat | undefined }) =>
      s && (s.added || s.removed) ? (
        <Text>
          <Text color="green">+{s.added}</Text>
          <Text color="red"> −{s.removed}</Text>
        </Text>
      ) : (
        <Text dimColor> </Text>
      )

    // ── header ───────────────────────────────────────────────
    const header = (
      <Box flexDirection="row" justifyContent="space-between" width={cols}>
        <Text>
          <Text color="magenta" bold>
            {icons.logo} Superset
          </Text>
          <Text dimColor>
            {'  '}
            {icons.host} local · {list.length} workspaces ·{' '}
          </Text>
          <Text color={totalLive ? 'green' : 'gray'}>
            {icons.live} {totalLive} live
          </Text>
          {bz && (
            <Text color="yellow">
              {'  '}
              {spin} {bz}
            </Text>
          )}
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="new" plain hotkey="n" label={`${icons.plus} New`} onPress={() => update($, mode, () => 'new' as Mode)} />
          <Button key="refresh" plain hotkey="r" label={icons.refresh} onPress={() => refresh($, { force: true })} />
          <Button key="max" plain hotkey="z" label={isMax ? icons.restore : icons.maximize} onPress={() => toggleMax($)} />
        </Box>
      </Box>
    )

    // ── sidebar ──────────────────────────────────────────────
    const sideRows: { key: string; node: RenderElement; id?: string }[] = []
    for (const [project, items] of grouped(list)) {
      const liveInGroup = items.reduce((n, w) => n + liveTerminals(terms[w.id]).length, 0)
      sideRows.push({
        key: `g:${project}`,
        node: (
          <Box key={`g:${project}`} flexDirection="row" justifyContent="space-between" width={sideW} marginTop={sideRows.length ? 1 : 0}>
            <Text bold color="blue" wrap="truncate">
              {icons.folderOpen} {cut(project, sideW - 8)}
            </Text>
            <Text dimColor>{liveInGroup ? `${liveInGroup}/${items.length}` : items.length}</Text>
          </Box>
        ),
      })
      for (const w of items) {
        const st = statusOf(w)
        const isSel = w.id === sel
        const s = stat[w.id]
        const right = `${s && (s.added || s.removed) ? `+${s.added} −${s.removed} ` : ''}${ago(w.lastActivityAt, now)}`
        sideRows.push({
          key: `w:${w.id}`,
          id: w.id,
          node: (
            <Box key={`w:${w.id}`} flexDirection="row" width={sideW} backgroundColor={isSel ? 'blackBright' : undefined}>
              <Text color={isSel ? 'cyan' : 'gray'}>{isSel ? '▌' : ' '}</Text>
              <Text color={st.color}>{st.glyph} </Text>
              <Box flexGrow={1} flexShrink={1}>
                <Button
                  key={`ws:${w.id}`}
                  plain
                  label={cut(w.branch || w.name, sideW - right.length - 6)}
                  onPress={() => select($, w.id)}
                />
              </Box>
              <StatText s={s} />
              <Text dimColor> {ago(w.lastActivityAt, now)}</Text>
            </Box>
          ),
        })
      }
    }
    const sideRoom = Math.max(4, (isWide ? rows : Math.floor(rows / 3)) - 4)
    const selIndex = Math.max(0, sideRows.findIndex(r => r.id === sel))
    const start = Math.max(0, Math.min(selIndex - Math.floor(sideRoom / 2), sideRows.length - sideRoom))
    const visible = sideRows.slice(start, start + sideRoom)

    const sidebar = (
      <Box flexDirection="column" width={sideW} flexShrink={0}>
        {list.length === 0 ? (
          <Text dimColor>
            {loaded ? 'No workspaces on this machine yet. Press n to make one.' : `${spin} Loading workspaces…`}
          </Text>
        ) : (
          visible.map(r => r.node)
        )}
        <Box flexGrow={1} />
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="up" plain hotkey="k" label={`${icons.up} k`} onPress={() => move($, -1)} />
          <Button key="down" plain hotkey="j" label={`${icons.down} j`} onPress={() => move($, 1)} />
          <Text dimColor>
            {start + 1}–{Math.min(sideRows.length, start + sideRoom)}/{sideRows.length}
          </Text>
        </Box>
      </Box>
    )

    // ── main: new-workspace form ─────────────────────────────
    const newForm = () => (
      <Box flexDirection="column" width={mainW} borderStyle="round" borderColor="magenta" paddingX={1}>
        <Text bold color="magenta">
          {icons.plus} New workspace
        </Text>
        <Text dimColor>A git worktree on a new branch, with {agentPreset} started on your prompt.</Text>
        <Box marginTop={1} flexDirection="column">
          {projs.length === 0 ? (
            <Text dimColor>
              {spin} Loading projects…
            </Text>
          ) : (
          <Select
            key="new:project"
            label={`${icons.folder} Project `}
            value={f.projectId || undefined}
            options={projs.map(p => ({ value: p.id, label: p.name }))}
            onSelect={v => update($, form, x => ({ ...x, projectId: v }))}
          />
          )}
          <Input
            key="new:branch"
            label={`${icons.branch} Branch  `}
            placeholder="fix/flaky-tests"
            value={f.branch}
            submitLabel="next"
            onInput={v => update($, form, x => ({ ...x, branch: v }))}
            onSubmit={v => update($, form, x => ({ ...x, branch: v }))}
          />
          <Input
            key="new:prompt"
            label={`${icons.agent} Prompt  `}
            placeholder="What should the agent do? (optional)"
            value={f.prompt}
            submitLabel="create"
            onInput={v => update($, form, x => ({ ...x, prompt: v }))}
            onSubmit={v => update($, form, x => ({ ...x, prompt: v })).then(() => create($))}
          />
        </Box>
        <Box flexDirection="row" gap={2} marginTop={1}>
          <Button key="new:create" variant="primary" label={`${icons.check} Create`} onPress={() => create($)} />
          <Button key="new:cancel" role="dismiss" label="Cancel" onPress={() => update($, mode, () => 'browse' as Mode)} />
        </Box>
      </Box>
    )

    // ── main: selected workspace ─────────────────────────────
    const tabButton = (id: Tab, hotkey: string, label: string) => (
      <Button
        key={`tab:${id}`}
        plain
        hotkey={hotkey}
        variant={t === id ? 'primary' : undefined}
        dimColor={t !== id}
        label={t === id ? `▸${label}` : ` ${label}`}
        onPress={() => switchTab($, id)}
      />
    )

    const bodyRows = Math.max(4, rows - 9)

    const agentBody = () => {
      if (!ws) return <Text dimColor>Select a workspace.</Text>
      const lines = (scr && scr.terminalId === term ? scr.text : '').replace(/\s+$/, '').split('\n')
      return (
        <Box flexDirection="column">
          {live.length > 1 && (
            <Box flexDirection="row" gap={1}>
              {live.map((x, i) => (
                <Button
                  key={`term:${x.terminalId}`}
                  plain
                  dimColor={x.terminalId !== term}
                  label={`${icons.terminal} ${i + 1}${x.terminalId === term ? '•' : ''}`}
                  onPress={() => update($, terminal, () => x.terminalId).then(() => readScreen($))}
                />
              ))}
            </Box>
          )}
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={term ? (scr && now - scr.changedAt < SCREEN_ACTIVE_MS ? 'yellow' : 'green') : 'gray'}
            paddingX={1}
            height={bodyRows}
            overflow="hidden"
          >
            {!term ? (
              <Box flexDirection="column">
                <Text dimColor>
                  {icons.agent} No live agent in this workspace.
                </Text>
                <Text dimColor>Type a prompt below to start {agentPreset} in {ws.branch || ws.name}.</Text>
              </Box>
            ) : !scr || scr.terminalId !== term ? (
              <Text dimColor>{spin} Reading terminal…</Text>
            ) : (
              lines.slice(-(bodyRows - 2)).map((line, i) => (
                <Text key={`l${i}`} wrap="truncate">
                  {line || ' '}
                </Text>
              ))
            )}
          </Box>
        </Box>
      )
    }

    const diffBody = () => {
      if (!d || d.workspaceId !== ws?.id) return <Text dimColor>{spin} Reading diff…</Text>
      const patch = d.patch.split('\n')
      const room = Math.max(3, bodyRows - 3)
      const from = Math.min(off, Math.max(0, patch.length - room))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor wrap="truncate">
              {icons.diff} vs fork point {d.base}
              {d.untracked.length ? ` · ${d.untracked.length} untracked` : ''}
            </Text>
            <Box flexDirection="row" gap={1}>
              <Button key="pg:up" plain hotkey="u" label={`${icons.up} u`} onPress={() => update($, diffOffset, o => Math.max(0, o - room))} />
              <Button
                key="pg:down"
                plain
                hotkey="d"
                label={`${icons.down} d`}
                onPress={() => update($, diffOffset, o => Math.min(Math.max(0, patch.length - room), o + room))}
              />
              <Text dimColor>
                {patch.length ? `${from + 1}–${Math.min(patch.length, from + room)}/${patch.length}` : ''}
              </Text>
            </Box>
          </Box>
          {d.patch.trim() === '' ? (
            <Box borderStyle="round" borderColor="gray" paddingX={1}>
              <Text dimColor>
                {icons.check} No changes against the fork point
                {d.untracked.length ? `; untracked: ${d.untracked.slice(0, 5).join(', ')}` : ''}
              </Text>
            </Box>
          ) : (
            <Box height={room} overflow="hidden" flexDirection="column">
              <Code key="patch" format="diff" source={patch.slice(from, from + room).join('\n')} />
            </Box>
          )}
        </Box>
      )
    }

    const infoBody = () =>
      ws && (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          {(
            [
              [icons.branch, 'Branch', ws.branch],
              [icons.folder, 'Project', ws.projectName],
              [icons.folderOpen, 'Path', ws.worktreePath],
              [icons.clock, 'Created', ws.createdAt.replace('T', ' ').slice(0, 16)],
              [icons.clock, 'Active', `${ago(ws.lastActivityAt, now)} ago`],
              [icons.terminal, 'Terminals', `${live.length} live, ${(terms[ws.id] ?? []).length} total`],
              [icons.info, 'Id', ws.id],
            ] as const
          ).map(([icon, k, v]) => (
            <Box key={`i:${k}`} flexDirection="row">
              <Text color="cyan">
                {icon} {k.padEnd(10)}
              </Text>
              <Text wrap="truncate-middle">{v}</Text>
            </Box>
          ))}
          {live.map(x => (
            <Text key={`it:${x.terminalId}`} dimColor wrap="truncate">
              {'  '}
              {icons.terminal} {x.title || x.terminalId}
            </Text>
          ))}
        </Box>
      )

    const detail = ws ? (
      <Box flexDirection="column" width={mainW}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate">
            <Text color={statusOf(ws).color}>{statusOf(ws).glyph} </Text>
            {cut(ws.name, mainW - 30)}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button key="open" plain hotkey="o" label={`${icons.open} Open`} onPress={() => openInApp($, ws.id)} />
            {del === ws.id ? (
              <Button key="del:yes" hotkey="y" variant="primary" label={`${icons.trash} Confirm delete`} onPress={() => remove($, ws.id)} />
            ) : (
              <Button key="del" plain hotkey="x" label={`${icons.trash}`} onPress={() => update($, confirmDelete, () => ws.id)} />
            )}
          </Box>
        </Box>
        <Text dimColor wrap="truncate">
          {icons.branch} {ws.branch} · {icons.folder} {ws.projectName} · {icons.clock} {ago(ws.lastActivityAt, now)}
          {' · '}
          {statusOf(ws).word}
        </Text>
        <Box flexDirection="row" gap={2} marginY={1}>
          {tabButton('agent', '1', `${icons.agent} Agent`)}
          {tabButton('diff', '2', `${icons.diff} Diff${stat[ws.id] ? ` +${stat[ws.id]!.added} −${stat[ws.id]!.removed}` : ''}`)}
          {tabButton('info', '3', `${icons.info} Info`)}
        </Box>
        {t === 'agent' ? agentBody() : t === 'diff' ? diffBody() : infoBody()}
        <Box marginTop={1}>
          <Input
            key={`msg:${ws.id}:${term ?? 'none'}`}
            label={`${term ? icons.send : icons.agent} `}
            placeholder={term ? 'Message the agent… (Enter sends)' : `Prompt to start ${agentPreset} here…`}
            submitLabel={term ? 'send' : 'start'}
            value=""
            onSubmit={v => send($, v)}
          />
        </Box>
      </Box>
    ) : (
      <Box width={mainW} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text dimColor>No workspace selected.</Text>
      </Box>
    )

    const footer = (
      <Box flexDirection="row" justifyContent="space-between" width={cols}>
        {ban ? (
          <Text color={ban.isError ? 'red' : 'green'} wrap="truncate">
            {ban.isError ? icons.warn : icons.check} {ban.text}
          </Text>
        ) : (
          <Text dimColor wrap="truncate">
            ctrl+x tab focus · j/k move · 1/2/3 tabs · n new · o open · x delete · r refresh · z maximize
          </Text>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" width={cols}>
        {header}
        <Text dimColor>{'─'.repeat(Math.max(0, cols))}</Text>
        <Box flexDirection={isWide ? 'row' : 'column'} gap={isWide ? 1 : 0} flexGrow={1}>
          {sidebar}
          {isWide && <Text dimColor>{'│\n'.repeat(Math.max(1, rows - 4)).trimEnd()}</Text>}
          {m === 'new' ? newForm() : detail}
        </Box>
        {footer}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!showBand || e.props.hasSurvey) return next(e)
    const [list, terms] = [await read($, workspaces), await read($, terminals)]
    if (list.length === 0) return next(e)
    const isOpen = await paneShown($)
    if (isOpen) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = Date.now()
    const live = Object.values(terms).reduce((n, l) => n + liveTerminals(l).length, 0)
    const hot = list.filter(w => now - w.lastActivityAt < ACTIVE_MS).length
    return (
      <Box flexDirection="row" gap={1}>
        <Text>
          <Text color="magenta" bold>
            {icons.logo} Superset
          </Text>
          <Text dimColor> {list.length} workspaces · </Text>
          <Text color={live ? 'green' : 'gray'}>
            {icons.live} {live} live
          </Text>
          {hot > 0 && <Text color="yellow"> · {hot} active</Text>}
        </Text>
        <Button key="band:open" plain hotkey="s" label={`${icons.open} open`} onPress={() => openPane($, true)} />
      </Box>
    )
  })
}
