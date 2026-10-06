import { expect, test } from 'claude-code/testing'

const WS = {
  id: 'ws-1',
  name: 'fix-flaky-tests',
  branch: 'fix/flaky-tests',
  projectId: 'p-1',
  projectName: 'web-app',
  worktreePath: '/tmp/wt/fix-flaky-tests',
  createdAt: '2026-10-06T08:00:00.000Z',
  lastActivityAt: 0,
  archivedAt: null,
}

const TERM = { terminalId: 't-1', workspaceId: 'ws-1', createdAt: 1, exited: false, title: 'claude' }

const run = (exitCode: number, stdout: string) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const ok = (json: unknown) => run(0, JSON.stringify(json))

const PROPS = {
  title: 'Superset',
  isFocused: true,
  bodyColumns: 140,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`lists workspaces and sends a message to the live agent (${surface})`, async ($, on) => {
    const calls: string[][] = []
    on('clock.after', () => ({ value: undefined }))
    on('ui.panes', () => ({ value: [] }))
    on('process.run', async (_$, e) => {
      calls.push([...e.argv])
      const [cmd, ...args] = e.argv
      if (cmd === 'git') return run(1, '')
      const verb = args.slice(0, 2).join(' ')
      if (verb === 'ws list') return ok([WS])
      if (verb === 'terminals list') return ok({ sessions: [TERM] })
      if (verb === 'terminals read') return ok({ terminalId: 't-1', text: 'Running tests…\n✓ 42 passed' })
      if (verb === 'terminals send') return ok({ terminalId: 't-1', submitted: true })
      if (verb === 'projects list') return ok([{ id: 'p-1', name: 'web-app', path: '/src/web-app' }])
      return ok({})
    })

    const ui = await $.ui.mount({
      plugin: 'superset-deck',
      surface,
      component: 'Pane',
      requestId: 'superset-deck',
      props: PROPS,
      viewport: { columns: 140, rows: 40, isFullscreen: true },
    })

    await ui.press({ key: 'refresh' })
    expect(await ui.find({ key: 'ws:ws-1' })).toBeDefined()
    expect(await ui.find({ text: /web-app/ })).toBeDefined()

    await ui.press({ key: 'ws:ws-1' })
    expect(await ui.find({ text: /42 passed/ })).toBeDefined()

    await ui.input({ key: 'msg:ws-1:t-1', text: 'also fix the lint errors' })
    expect(calls).toContainEqual([
      'superset', 'terminals', 'send', '--local', '--workspace', 'ws-1', '--terminal', 't-1',
      '--text', 'also fix the lint errors', '--json',
    ])
  })
}
