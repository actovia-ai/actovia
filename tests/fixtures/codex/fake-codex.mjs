#!/usr/bin/env node
// tests/fixtures/codex/fake-codex.mjs — replays recorded `codex app-server` output (plan Task 3).
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
if (args[0] === '--version') {
  console.log(process.env.FAKE_CODEX_VERSION ?? 'codex-cli 0.162.1')
  process.exit(0)
}
if (args[0] === 'login' && args[1] === 'status') {
  console.log(process.env.FAKE_CODEX_LOGIN ?? 'Logged in using ChatGPT')
  process.exit(Number(process.env.FAKE_CODEX_LOGIN_EXIT ?? 0))
}
const record = (o) =>
  process.env.FAKE_CODEX_RECORD &&
  appendFileSync(process.env.FAKE_CODEX_RECORD, JSON.stringify(o) + '\n')
record({ argv: args })

const lines = process.env.FAKE_CODEX_FIXTURE
  ? readFileSync(process.env.FAKE_CODEX_FIXTURE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  : []
const responseTo = (id) =>
  lines.find((m) => m.id === id && !m.method && 'result' in m)?.result
const turns = []
let current = null
for (const m of lines) {
  if (m.id !== undefined && !m.method) continue
  if (m.method === 'turn/started') current = []
  if (current) current.push(m)
  if (m.method === 'turn/completed' && current) {
    turns.push(current)
    current = null
  }
}

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let played = 0
let playing = false
let waitingFor = null
let resume = null
let interrupted = false

async function playTurn() {
  const turn = turns[played++] ?? []
  playing = true
  const turnId = turn[0]?.params?.turn?.id ?? `turn-${played}`
  for (const m of turn) {
    if (interrupted) break
    out(m)
    if (m.method === 'turn/started' && process.env.FAKE_CODEX_EXTRA_REQUEST) {
      const extra = JSON.parse(process.env.FAKE_CODEX_EXTRA_REQUEST)
      out(extra)
      waitingFor = extra.id
      await new Promise((r) => (resume = r))
    }
    if (m.id !== undefined && m.method) {
      waitingFor = m.id
      await new Promise((r) => (resume = r))
    }
    await sleep(1)
  }
  if (interrupted) {
    out({
      method: 'turn/completed',
      params: {
        threadId: 't',
        turn: { id: turnId, status: 'interrupted', error: null }
      }
    })
    interrupted = false
  }
  playing = false
}

const isPlaying = () => playing
createInterface({ input: process.stdin })
  .on('line', async (line) => {
    record({ stdin: JSON.parse(line) })
    const m = JSON.parse(line)
    if (m.id !== undefined && !m.method) {
      if (m.id === waitingFor) {
        waitingFor = null
        resume?.()
      }
      return
    }
    switch (m.method) {
      case 'initialize':
        await sleep(Number(process.env.FAKE_CODEX_INIT_DELAY_MS ?? 0))
        return out({ id: m.id, result: responseTo(1) ?? { userAgent: 'fake' } })
      case 'initialized':
        return
      case 'thread/start':
      case 'thread/resume':
        if (process.env.FAKE_CODEX_THREAD_ERROR)
          return out({
            id: m.id,
            error: {
              code: -32000,
              message: process.env.FAKE_CODEX_THREAD_ERROR
            }
          })
        return out({
          id: m.id,
          result: responseTo(2) ?? {
            thread: { id: 'fake-thread' },
            model: 'fake'
          }
        })
      case 'model/list':
        return out({
          id: m.id,
          result: process.env.FAKE_CODEX_MODELS
            ? JSON.parse(process.env.FAKE_CODEX_MODELS)
            : { data: [], nextCursor: null }
        })
      case 'turn/start': {
        const next =
          turns[played]?.[0]?.params?.turn?.id ?? `turn-${played + 1}`
        out({ id: m.id, result: { turn: { id: next } } })
        return void playTurn()
      }
      case 'turn/interrupt':
        // Like the real server: a turn that is over has nothing to interrupt,
        // and a request the turn was waiting on is resolved by Codex itself.
        if (playing) interrupted = true
        out({ id: m.id, result: {} })
        if (waitingFor !== null) {
          out({
            method: 'serverRequest/resolved',
            params: { threadId: 't', requestId: waitingFor }
          })
          waitingFor = null
          resume?.()
        }
        return
      default:
        return out({ id: m.id, result: {} })
    }
  })
  .on('close', async () => {
    // A reply that can no longer arrive does not hold the server open.
    while (isPlaying() && waitingFor === null) await sleep(5)
    process.exit(0)
  })
