// @vitest-environment happy-dom
import { HttpError } from '@actovia/shared/utils/http'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

type Row = { id: string }
type Pending = {
  id: string
  after?: string
  resolve: (r: Row[]) => void
  reject: (e: unknown) => void
}
const calls: Pending[] = []
vi.mock('@/services/philharmonic-chat', () => ({
  getConversationMessages: (id: string, after?: string) =>
    new Promise((resolve, reject) => calls.push({ id, after, resolve, reject }))
}))

const { useGroupHistory } =
  await import('@/components/philharmonic/chat/group-history')

let latest: Row[] = []
function Probe(props: { id: string; revision: number }) {
  latest = useGroupHistory(props.id, props.revision) as Row[]
  return null
}
const root = createRoot(document.createElement('div'))
const render = (id: string, revision: number) =>
  act(async () => root.render(createElement(Probe, { id, revision })))
const settle = (p: Pending, value: Row[] | Error) =>
  act(async () => (value instanceof Error ? p.reject(value) : p.resolve(value)))

afterEach(() => {
  calls.length = 0
})

describe('useGroupHistory', () => {
  it('never puts an old group’s rows into the one opened since', async () => {
    await render('A', 0)
    await settle(calls[0], [{ id: 'a1' }])
    await render('A', 1)
    const afterA = calls[1]
    expect(afterA).toMatchObject({ id: 'A', after: 'a1' })
    await render('B', 1)
    const fullB = calls.find((c) => c.id === 'B')!
    expect(fullB.after).toBeUndefined()
    await settle(fullB, [{ id: 'b1' }])
    await settle(afterA, [{ id: 'a2' }])
    expect(latest).toEqual([{ id: 'b1' }])
    // and opening B asked it nothing `after` A's row
    expect(calls.filter((c) => c.id === 'B' && c.after)).toEqual([])
  })

  it('reads the whole group again when the re-read fails', async () => {
    await render('C', 0)
    await settle(calls[0], [{ id: 'c1' }])
    await render('C', 1)
    await settle(calls[1], new HttpError(500, 'INTERNAL', 'boom'))
    expect(calls[2]).toMatchObject({ id: 'C', after: undefined })
    await settle(calls[2], [{ id: 'c1' }, { id: 'c2' }])
    expect(latest).toEqual([{ id: 'c1' }, { id: 'c2' }])
  })
})
