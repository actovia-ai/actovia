import { electronTest as test, expect } from '../fixtures/electron'

const SANDBOX_URL =
  'actovia-artifact://sandbox/src/renderer/sub-apps/artifacts/index.html'

// What a hostile artifact would try — and a web page can talk the model into
// writing one. It renders what it managed to reach.
const PROBE = `
import { useEffect, useState } from 'react'

export default function Probe() {
  const [report, setReport] = useState('pending')
  useEffect(() => {
    ;(async () => {
      let parent
      try {
        parent = 'reached:' + window.parent.document.title
      } catch {
        parent = 'blocked'
      }
      let bridge
      try {
        bridge = window.parent.electron ? 'reached' : 'absent'
      } catch {
        bridge = 'blocked'
      }
      let api
      try {
        const res = await fetch('http://localhost:60223/api/v1/settings')
        api = 'reached:' + res.status
      } catch {
        api = 'blocked'
      }
      setReport('parent=' + parent + ';bridge=' + bridge + ';api=' + api)
    })()
  }, [])
  return <p id="probe-report">{report}</p>
}
`

/**
 * The artifact sandbox evaluates model-written code. It is served from an
 * origin of its own (src/main/lib/artifact-protocol.ts) precisely so that code
 * cannot reach the window that embeds it, the preload bridge, or the local
 * API. This drives the real sandbox page, in the packaged build, with code
 * that tries all three.
 */
test.describe('Artifact sandbox isolation', () => {
  test('artifact code renders, but cannot reach the app or the API', async ({
    mainWindow
  }) => {
    await mainWindow.evaluate(
      ({ url, code }) => {
        const frame = document.createElement('iframe')
        frame.id = 'probe-frame'
        // The same attribute artifact-card.tsx uses.
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
        window.addEventListener('message', (event) => {
          if (event.data?.type !== 'artifact-sandbox-ready') return
          frame.contentWindow?.postMessage(
            { type: 'render', code, artifactId: 'probe' },
            '*'
          )
        })
        frame.src = url
        document.body.append(frame)
      },
      { url: SANDBOX_URL, code: PROBE }
    )

    const report = mainWindow
      .frameLocator('#probe-frame')
      .locator('#probe-report')
    // It rendered (so the sandbox works) and everything it reached for was shut.
    await expect(report).toHaveText(
      'parent=blocked;bridge=blocked;api=blocked',
      { timeout: 20_000 }
    )
  })
})
