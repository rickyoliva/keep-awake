// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { afterEach, assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import type { KeepAwakeState } from './protocol'
import * as panel from './panel'

let view: TestPanel | undefined
afterEach(() => view?.unmount())

const reported = (over: Partial<KeepAwakeState> = {}): KeepAwakeState => ({
  disabled: false,
  source: 'AC',
  percent: 88,
  passwordless: true,
  error: null,
  at: 1_700_000_000_000,
  ...over
})

test('shows the state the worker reports', async () => {
  const host = mockHost({ requests: { 'keepawake.state': () => reported({ disabled: true }) } })
  view = await mount(panel, { host })
  assert.ok(view.summary().some((line) => line.includes('System sleep is blocked')))
  assert.equal(view.valueOf({ label: 'Block system sleep' }), true)
  assert.deepEqual(view.errors, [])
})

test('asks the worker to block sleep and follows what it answers', async () => {
  const asked: boolean[] = []
  const host = mockHost({
    requests: {
      'keepawake.state': () => reported(),
      'keepawake.set': ({ disabled }) => {
        asked.push(disabled)
        return reported({ disabled })
      }
    }
  })
  view = await mount(panel, { host })
  assert.ok(view.summary().some((line) => line.includes('System sleep is allowed')))

  await view.toggle({ label: 'Block system sleep' })
  assert.deepEqual(asked, [true])
  assert.ok(view.summary().some((line) => line.includes('System sleep is blocked')))
})

test('shows a failed toggle and keeps the reported state', async () => {
  const host = mockHost({
    requests: {
      'keepawake.state': () => reported(),
      'keepawake.set': () => {
        throw new Error('sudo: a password is required')
      }
    }
  })
  view = await mount(panel, { host })
  await view.toggle({ label: 'Block system sleep' })
  assert.ok(view.find({ text: /a password is required/ }))
  assert.ok(view.summary().some((line) => line.includes('System sleep is allowed')))
})

test('offers the sudo rule only while a password is needed', async () => {
  const withRule = mockHost({ requests: { 'keepawake.state': () => reported() } })
  view = await mount(panel, { host: withRule })
  assert.equal(view.find({ type: 'Collapsible' }), null)
  view.unmount()
  view = undefined

  const without = mockHost({ requests: { 'keepawake.state': () => reported({ passwordless: false }) } })
  view = await mount(panel, { host: without })
  assert.ok(view.find({ type: 'Collapsible' }))
  assert.match(JSON.stringify(view.tree()), /yes, a macOS dialog each time/)
})

test('warns that blocked sleep drains the battery', async () => {
  const host = mockHost({
    requests: { 'keepawake.state': () => reported({ disabled: true, source: 'Battery', percent: 21 }) }
  })
  view = await mount(panel, { host })
  assert.ok(view.summary().some((line) => line.includes('On battery')))
  assert.match(JSON.stringify(view.tree()), /"21%"/)
})
