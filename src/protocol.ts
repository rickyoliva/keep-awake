// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

/** What the machine says right now. Read-only; nothing here needs a password. */
export type KeepAwakeState = {
  /** true when `pmset -g` reports SleepDisabled 1; null when it could not be read. */
  disabled: boolean | null
  /** Where power comes from, when known. */
  source: 'AC' | 'Battery' | null
  /** Battery percentage, when known. */
  percent: number | null
  /** true when `sudo pmset -a disablesleep …` runs without a password prompt. */
  passwordless: boolean
  /** Last error, if a toggle failed. */
  error: string | null
  /** When the state was read. */
  at: number
}

declare module 'orca' {
  interface PluginRequests {
    /** Read the current state of system sleep. */
    'keepawake.state': { output: KeepAwakeState }
    /** Block or allow system sleep, then answer the state it actually reached. */
    'keepawake.set': { input: { disabled: boolean }; output: KeepAwakeState }
  }
  interface PluginPanelEvents {
    /** Posted to every open panel after the worker reads or changes the state. */
    'keepawake.changed': KeepAwakeState
  }
}
