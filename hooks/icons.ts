export type IconSet = {
  logo: string
  folder: string
  folderOpen: string
  branch: string
  live: string
  idle: string
  exited: string
  agent: string
  terminal: string
  diff: string
  info: string
  plus: string
  trash: string
  open: string
  send: string
  refresh: string
  check: string
  warn: string
  clock: string
  up: string
  down: string
  host: string
  spinner: readonly string[]
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

// Nerd Font glyphs (JetBrainsMono Nerd Font ships with Omarchy).
const NERD: IconSet = {
  logo: '\u{f0e7}',
  folder: '\u{f07b}',
  folderOpen: '\u{f07c}',
  branch: '\u{e725}',
  live: '●',
  idle: '○',
  exited: '\u{f00d}',
  agent: '\u{f06a9}',
  terminal: '\u{f120}',
  diff: '\u{f440}',
  info: '\u{f05a}',
  plus: '\u{f067}',
  trash: '\u{f1f8}',
  open: '\u{f08e}',
  send: '\u{f1d8}',
  refresh: '\u{f021}',
  check: '\u{f00c}',
  warn: '\u{f071}',
  clock: '\u{f017}',
  up: '\u{f077}',
  down: '\u{f078}',
  host: '\u{f108}',
  spinner: SPINNER,
}

const UNICODE: IconSet = {
  logo: '◆',
  folder: '▸',
  folderOpen: '▾',
  branch: '⎇',
  live: '●',
  idle: '○',
  exited: '×',
  agent: '✦',
  terminal: '❯',
  diff: '±',
  info: 'ℹ',
  plus: '+',
  trash: '✕',
  open: '↗',
  send: '➤',
  refresh: '↻',
  check: '✓',
  warn: '⚠',
  clock: '◷',
  up: '↑',
  down: '↓',
  host: '⌂',
  spinner: SPINNER,
}

export const iconsFor = (set: unknown): IconSet => (set === 'unicode' ? UNICODE : NERD)
