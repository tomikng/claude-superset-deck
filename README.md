# Superset Deck

A [Superset](https://superset.sh)-style workspace sidebar **inside Claude Code**, driven by the `superset` CLI of your own host.

Browse every workspace on the machine grouped by project, watch an agent's terminal live, read the branch diff, message the agent, start new agents and spin up new worktree workspaces, all from a docked pane next to your Claude Code conversation.

```
 Superset   local · 14 workspaces · ● 2 live                       New  
─────────────────────────────────────────────────────────────────────────────────
  web-app                  2/4 │ ⠹ fix/checkout-button-match-figma        Open  
▌⠹ fix/checkout-butt…  +48 −12 │  fix/checkout… ·  web-app ·  now
 ○ feat/onboarding-co…      3h │ ▸󰚩 Agent    Diff +48 −12    Info
 ○ refactor/split-acc…      1d │ ╭────────────────────────────────────────────────╮
                                │ │ ● Updated CheckoutButton.tsx to match Figma      │
  api-server               0/3 │ │ ● Running pnpm test --filter checkout     │
 ○ fix/rate-limiter-r…      2d │ │   ✓ 18 passed                                  │
 ○ feat/audit-log-exp…      2d │ ╰────────────────────────────────────────────────╯
                                │  Message the agent… (Enter sends)
  k   j  1–8/19              │
 ctrl+x tab focus · j/k move · 1/2/3 tabs · n new · o open · x delete · r refresh
```

## What it does

| | |
| --- | --- |
| **Sidebar** | Workspaces grouped by project, newest activity first. A spinner marks agents that are working, `●` live terminals, `○` idle. Each row shows its `+added −removed` against the fork point and how long ago it was active. |
| **Agent tab** | The live screen of the workspace's agent terminal (`superset terminals read`), refreshed every 1.5 s while the pane is shown. With several terminals, pick one from the chips. |
| **Diff tab** | The branch's diff against its fork point from the default branch, syntax-highlighted, paged with `u` / `d`. |
| **Info tab** | Branch, project, worktree path, timestamps, terminals. |
| **Message bar** | With a live agent: sends your text into its terminal (`superset terminals send`). Without one: starts a new agent on your prompt (`superset agents create`). |
| **New workspace** | `n`, or `/superset new <branch> [prompt]`: pick a project, name the branch, optionally give a prompt, and `superset ws create` makes the worktree and starts the agent. |
| **Open / delete** | `o` opens the workspace in the Superset desktop app; `x` then `y` deletes it. |
| **Status band** | While the pane is closed, a one-line summary above the prompt (`s` opens the deck). |

## Requirements

- Claude Code with function-hook plugins (2.1.289 or newer).
- The `superset` CLI on `PATH`, logged in, with a running host on this machine (`superset status`).
- The **fullscreen terminal layout** to dock the pane as a sidebar (it seats from 144 columns when opened on its own; `/superset` opens it at any width).
- A [Nerd Font](https://www.nerdfonts.com) for the icons, or set the icon option to `unicode`.

## Install

```sh
claude plugin marketplace add tomikng/claude-superset-deck
claude plugin install superset-deck@superset-deck
```

Or run it straight from a clone:

```sh
git clone https://github.com/tomikng/claude-superset-deck
claude --plugin-dir ./claude-superset-deck
```

## Use

| Keys / command | |
| --- | --- |
| `/superset` | Open the deck (focused) |
| `/superset new <branch> [prompt]` | Open the new-workspace form pre-filled |
| `/superset refresh` · `/superset close` | Refresh everything now · close the pane |
| `ctrl+x tab` or click | Move the keyboard into the pane |
| `j` / `k` | Next / previous workspace |
| `1` `2` `3` | Agent · Diff · Info |
| `n` · `r` · `o` · `x` | New · refresh · open in Superset · delete |
| `u` / `d` | Page the diff |
| `Esc` | Back to the prompt |

## Options

Set them in `/plugin` → superset-deck → configure, or under `pluginConfigs` in settings:

| Option | Default | |
| --- | --- | --- |
| `icons` | `nerd` | `nerd` or `unicode` |
| `agent` | `claude` | Superset agent preset id (or HostAgentConfig UUID) used when starting agents |
| `band` | `true` | Show the summary band above the prompt |

## How it works

Every number on screen comes from the Superset CLI with `--json`, run on the host through the plugin's `$.process.run`:

- `superset ws list --local` and `superset terminals list --local --workspace <id>` every 8 s;
- `superset terminals read --local … --max-lines N` every 1.5 s, for the selected terminal while the pane is shown;
- `git merge-base` and `git diff --shortstat` in each worktree every 30 s.

Nothing leaves your machine except what the Superset CLI itself does.

## Develop

```sh
claude plugin validate .
claude plugin test .
tsc -p .            # once Claude Code has loaded the plugin and laid .claude-plugin/types
```

## License

MIT
