// `orca plugin check` renders the panel once per scenario. The state comes from the worker, so
// stub that one request and let the rest run against this machine.
import { defineCheck } from 'orca/testing'
import type { KeepAwakeState } from './protocol'

const state = (over: Partial<KeepAwakeState> = {}): KeepAwakeState => ({
  disabled: false,
  source: 'AC',
  percent: 92,
  passwordless: true,
  error: null,
  at: 0,
  ...over
})

export default defineCheck({
  allowed: { requests: { 'keepawake.state': () => state() } },
  blocked: { requests: { 'keepawake.state': () => state({ disabled: true }) } },
  'blocked on battery': { requests: { 'keepawake.state': () => state({ disabled: true, source: 'Battery', percent: 34 }) } },
  'needs password': { requests: { 'keepawake.state': () => state({ passwordless: false }) } },
  unreadable: { requests: { 'keepawake.state': () => state({ disabled: null, source: null, percent: null }) } },
  failed: { requests: { 'keepawake.state': () => state({ error: 'sudo: a password is required' }) } }
})
