// The plugin's worker: reads the sleep setting, changes it, and keeps the status bar honest.
// Status reads need no password. Changing it needs root, so the worker first tries a passwordless
// `sudo` rule and otherwise falls back to macOS's own administrator prompt.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { OrcaWorkerApi } from 'orca/worker'
import type { KeepAwakeState } from './protocol'

const exec = promisify(execFile)
const PMSET = '/usr/bin/pmset'
const ITEM = 'state'
const POLL_MS = 60_000

const NEEDS_PASSWORD = /a password is required|no tty present|a terminal is required/i

async function run(file: string, args: string[], timeout = 15_000) {
  return exec(file, args, { timeout })
}

function emptyState(): KeepAwakeState {
  return { disabled: null, source: null, percent: null, passwordless: false, error: null, at: Date.now() }
}

async function readState(): Promise<KeepAwakeState> {
  const state = emptyState()
  const [settings, battery, allowed] = await Promise.allSettled([
    run(PMSET, ['-g']),
    run(PMSET, ['-g', 'batt']),
    // -l asks sudo whether the rule applies; -n keeps it from prompting.
    run('sudo', ['-n', '-l', PMSET, '-a', 'disablesleep', '1'])
  ])

  if (settings.status === 'fulfilled') state.disabled = /SleepDisabled\s+1/.test(settings.value.stdout)
  if (battery.status === 'fulfilled') {
    const text = battery.value.stdout
    if (/'AC Power'/.test(text)) state.source = 'AC'
    else if (/'Battery Power'/.test(text)) state.source = 'Battery'
    const percent = /(\d{1,3})%/.exec(text)
    state.percent = percent ? Number(percent[1]) : null
  }
  state.passwordless = allowed.status === 'fulfilled'
  return state
}

async function setSleepDisabled(disabled: boolean): Promise<void> {
  const args = ['-a', 'disablesleep', disabled ? '1' : '0']
  try {
    await run('sudo', ['-n', PMSET, ...args], 10_000)
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '')
    if (!NEEDS_PASSWORD.test(stderr)) throw new Error(stderr.trim() || String(error))
    // macOS shows its own password dialog; cancelling it fails this call. A person can be slow.
    await run('osascript', ['-e', `do shell script "${PMSET} ${args.join(' ')}" with administrator privileges`], 180_000)
  }
}

async function publish(orca: OrcaWorkerApi, state: KeepAwakeState): Promise<void> {
  const text = state.disabled === null ? 'Sleep ?' : state.disabled ? 'Awake' : 'Sleep on'
  const tooltip =
    state.disabled === null
      ? 'Keep Awake: could not read the sleep setting'
      : state.disabled
        ? `System sleep is blocked${state.source === 'Battery' ? ' (on battery)' : ''}; click to allow`
        : 'System sleep is allowed; click to block it'

  await orca.host.call('statusBar.update', {
    id: ITEM,
    text,
    icon: state.disabled ? 'zap' : 'pause',
    tone: state.disabled === null ? 'neutral' : state.disabled ? (state.source === 'Battery' ? 'warning' : 'success') : 'neutral',
    tooltip,
    visible: true
  })
}

async function broadcast(orca: OrcaWorkerApi, state: KeepAwakeState): Promise<KeepAwakeState> {
  await publish(orca, state)
  orca.panels.post('keepawake.changed', state)
  return state
}

async function apply(orca: OrcaWorkerApi, disabled: boolean): Promise<KeepAwakeState> {
  try {
    await setSleepDisabled(disabled)
  } catch (error) {
    const state = await readState()
    state.error = String((error as Error).message).trim() || 'pmset failed'
    await broadcast(orca, state)
    throw new Error(state.error)
  }
  // Trust the machine, not the exit code: pmset can be refused by a policy or a missing battery.
  const after = await readState()
  if (after.disabled !== disabled) {
    after.error = `pmset reported success but the setting is still ${after.disabled === null ? 'unreadable' : after.disabled ? 'blocked' : 'allowed'}`
    await broadcast(orca, after)
    throw new Error(after.error)
  }
  return broadcast(orca, after)
}

const timers = new Map<OrcaWorkerApi, ReturnType<typeof setInterval>>()

export function deactivate(): void {
  for (const timer of timers.values()) clearInterval(timer)
  timers.clear()
}

export default function activate(orca: OrcaWorkerApi): void {
  let ticking = false

  const refresh = async (): Promise<KeepAwakeState> => broadcast(orca, await readState())

  const tick = async () => {
    if (ticking) return
    ticking = true
    try {
      await refresh()
    } catch (error) {
      orca.log(`refresh failed: ${String(error)}`)
    } finally {
      ticking = false
    }
  }

  orca.panels.handle('keepawake.state', refresh)
  orca.panels.handle('keepawake.set', ({ disabled }) => apply(orca, disabled))

  orca.commands.register('keepawake.toggle', async () => {
    const current = await readState()
    if (current.disabled === null) throw new Error('could not read the sleep setting')
    const next = await apply(orca, !current.disabled)
    return next.disabled ? 'System sleep is blocked' : 'System sleep is allowed'
  })
  orca.commands.register('keepawake.on', async () => {
    const next = await apply(orca, true)
    return next.disabled ? 'System sleep is blocked' : 'still allowed'
  })
  orca.commands.register('keepawake.off', async () => {
    const next = await apply(orca, false)
    return next.disabled ? 'still blocked' : 'System sleep is allowed'
  })
  orca.commands.register('keepawake.refresh', async () => {
    const state = await refresh()
    return state.disabled ? 'System sleep is blocked' : 'System sleep is allowed'
  })

  // Wake with the app and whenever the window moves; that is when a stale item would be read.
  orca.events.on('workspace.changed', () => void tick())
  timers.set(orca, setInterval(() => void tick(), POLL_MS))
  void tick()
}
