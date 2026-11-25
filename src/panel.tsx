// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Button,
  Callout,
  Code,
  Collapsible,
  Heading,
  IconButton,
  KeyValue,
  plugin,
  read,
  RelativeTime,
  Row,
  set,
  Skeleton,
  Stack,
  Switch,
  Text,
  type PanelContext
} from 'orca'
import type { KeepAwakeState } from './protocol'

/** What the worker last reported; null until it answers. */
const state = atom<KeepAwakeState | null>(null)
/** true while a toggle is in flight, so the switch cannot be double-pressed. */
const busy = atom(false)
const problem = atom<string | null>(null)

async function refresh(): Promise<void> {
  try {
    set(state, await plugin.request('keepawake.state'))
    set(problem, null)
  } catch (error) {
    set(problem, (error as Error).message)
  }
}

async function toggle(disabled: boolean): Promise<void> {
  set(busy, true)
  try {
    set(state, await plugin.request('keepawake.set', { disabled }))
    set(problem, null)
  } catch (error) {
    set(problem, (error as Error).message)
  } finally {
    set(busy, false)
  }
}

/** Runs once before the first render; what it pushes to `subscriptions` ends with the panel. */
export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('keepawake.changed', (next) => set(state, next)))
  void refresh()
  // The setting can change outside Orca (another app, a reboot); keep the panel honest while open.
  const timer = setInterval(() => void refresh(), 10_000)
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) })
}

const SUDOERS = `Cmnd_Alias KEEPAWAKE = /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1
%admin ALL = (root) NOPASSWD: KEEPAWAKE`

export default function Panel() {
  const now = read(state)
  const isBusy = read(busy)
  const error = read(problem)
  const disabled = now?.disabled ?? null

  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Heading>Keep Awake</Heading>
        <IconButton icon="refresh" label="Refresh status" variant="ghost" size="sm" onPress={() => void refresh()} />
      </Row>

      {now === null ? (
        <Row gap="sm" align="center">
          <Skeleton shape="text" lines={1} label="Reading the sleep setting" />
        </Row>
      ) : now.disabled === null ? (
        <Callout tone="neutral" title="Could not read the setting" icon="info">
          <Text size="sm">
            <Code>pmset -g</Code> did not answer. Sleep is probably on its normal timers.
          </Text>
        </Callout>
      ) : now.disabled ? (
        <Callout tone="success" title="System sleep is blocked" icon="zap">
          <Text size="sm">
            No idle sleep and the lid can close: the Mac stays awake. Read <RelativeTime at={now.at} />.
          </Text>
        </Callout>
      ) : (
        <Callout tone="neutral" title="System sleep is allowed" icon="pause">
          <Text size="sm">
            The Mac sleeps on its usual timers. Read <RelativeTime at={now.at} />.
          </Text>
        </Callout>
      )}

      <Switch
        label="Block system sleep"
        checked={disabled === true}
        disabled={disabled === null || isBusy}
        onChange={(next) => void toggle(next)}
      />

      {error ? (
        <Callout tone="danger" title="That did not take" icon="warning">
          <Text size="sm">{error}</Text>
        </Callout>
      ) : null}

      {now ? (
        <KeyValue
          items={[
            { label: 'Power', value: now.source ?? 'unknown' },
            { label: 'Battery', value: now.percent === null ? 'unknown' : `${now.percent}%` },
            { label: 'Needs a password', value: now.passwordless ? 'no' : 'yes, a macOS dialog each time' }
          ]}
        />
      ) : null}

      {now?.disabled && now.source === 'Battery' ? (
        <Callout tone="warning" title="On battery" icon="warning">
          <Text size="sm">Blocked sleep drains the battery faster. Turn it off before the lid goes down for long.</Text>
        </Callout>
      ) : null}

      <Text muted size="xs">
        Runs <Code>sudo pmset -a disablesleep 1</Code> and reads the state from <Code>pmset -g</Code>. It is
        system-wide and survives closing the lid, Orca quitting and a reboot (a reboot clears it).
      </Text>

      {now && !now.passwordless ? (
        <Collapsible title="Make the toggle instant" description="one-time sudo rule, no password after">
          <Stack gap="sm">
            <Text size="sm">
              Save this as <Code>/etc/sudoers.d/keepawake</Code> (mode 0440), or run the command in a terminal:
            </Text>
            <Code block>{SUDOERS}</Code>
            <Text muted size="xs">
              <Code>sudo install -m 0440 /dev/stdin /etc/sudoers.d/keepawake</Code> then paste it and press
              Ctrl-D. Until then macOS asks for your password on every change.
            </Text>
            <Button variant="ghost" size="sm" icon="refresh" onPress={() => void refresh()}>
              Re-check
            </Button>
          </Stack>
        </Collapsible>
      ) : null}
    </Stack>
  )
}
