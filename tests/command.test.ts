import { expect, test } from 'claude-code/testing'

test('session.start registers /deck and /superset-deck', async ($, on) => {
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('clock.every', () => ({ value: () => {} }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'offline', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['deck', 'superset-deck'])
  await new Promise(resolve => setTimeout(resolve, 100))
})

test('/deck max opens the pane wide', async ($, on) => {
  const opened: { id: string; columns?: number }[] = []
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, columns: e.columns })
    return { value: { isPlaced: true } }
  })
  const out = await $.command.run({
    command: 'deck',
    args: 'max',
    origin: { kind: 'user' },
    presentation: { isFullscreen: true, columns: 200 },
  } as never)
  expect(out).toMatchObject({ text: 'Superset deck maximized.' })
  expect(opened.at(-1)).toEqual({ id: 'superset-deck', columns: 176 })
})
