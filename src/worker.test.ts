// Runs src/worker.ts's activate(orca) with the orca object Orca passes, over a mock host.
// These read the real machine (pmset is cheap and needs no password), so assert on shape.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

test('reads the current setting and says it on the status bar', async () => {
  const host = mockHost()
  const worker = await mountWorker(main, { host })
  const state = await worker.request('keepawake.state')
  assert.equal(typeof state.at, 'number')
  assert.ok(state.disabled === true || state.disabled === false)
  assert.equal(typeof state.passwordless, 'boolean')

  const updates = host.callsOf('statusBar.update') as unknown as { text?: string; tooltip?: string }[]
  const text = updates.at(-1)?.text
  assert.ok(text === 'Awake' || text === 'Sleep on')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('presses in the status bar toggle the same setting', async () => {
  const host = mockHost()
  const worker = await mountWorker(main, { host })
  const before = await worker.request('keepawake.state')
  const after = await worker.request('keepawake.set', { disabled: !before.disabled })
  assert.equal(after.disabled, !before.disabled)
  // Put it back the way it was found.
  await worker.request('keepawake.set', { disabled: before.disabled ?? false })
  await worker.deactivate()
})
