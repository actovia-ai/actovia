import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { app } from 'electron'

import { getActoviaHome } from '../paths'

const execFileAsync = promisify(execFile)
export type AutomationEngine = 'agent-desktop' | 'agent-browser'

/** Run the pinned upstream executable, never a shell or runtime download. */
export function automationBinary(engine: AutomationEngine): string {
  const arch =
    engine === 'agent-browser' && process.platform === 'win32'
      ? 'x64'
      : process.arch
  const ext = process.platform === 'win32' ? '.exe' : ''
  return join(
    app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'),
    'node_modules',
    engine,
    'bin',
    `${engine}-${process.platform}-${arch}${ext}`
  )
}

export async function runAutomation(
  engine: AutomationEngine,
  args: string[],
  signal?: AbortSignal
): Promise<{ text: string; failed: boolean }> {
  signal?.throwIfAborted()
  const root = join(getActoviaHome(), 'automation')
  await mkdir(root, { recursive: true })
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('AGENT_BROWSER_') && !key.startsWith('AGENT_DESKTOP_')
    )
  )
  env.AGENT_DESKTOP_HOME = join(root, 'desktop')
  env.AGENT_DESKTOP_MACOS_HELPER_PATH = join(
    automationBinary('agent-desktop'),
    '..',
    'agent-desktop-macos-helper'
  )
  env.AGENT_BROWSER_NAMESPACE = 'actovia'
  env.AGENT_BROWSER_CONTENT_BOUNDARIES = '1'
  env.AGENT_BROWSER_IDLE_TIMEOUT_MS = '300000'
  env.AGENT_BROWSER_MAX_OUTPUT = '24000'
  if (engine === 'agent-browser') {
    const configPath = join(root, 'browser.json')
    await writeFile(configPath, '{}\n', { mode: 0o600 })
    args = ['--config', configPath, ...args]
    const chrome = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      join(
        process.env.PROGRAMFILES ?? 'C:\\Program Files',
        'Google/Chrome/Application/chrome.exe'
      )
    ].find(existsSync)
    if (chrome) env.AGENT_BROWSER_EXECUTABLE_PATH = chrome
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      automationBinary(engine),
      args,
      {
        cwd: root,
        env,
        signal,
        timeout: 45_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true
      }
    )
    return { text: stdout.trim() || stderr.trim(), failed: false }
  } catch (error) {
    signal?.throwIfAborted()
    const e = error as { stdout?: string; stderr?: string; message?: string }
    return {
      text:
        e.stdout?.trim() ||
        e.stderr?.trim() ||
        e.message ||
        'Automation failed',
      failed: true
    }
  }
}

export interface DesktopApp {
  name: string
  bundleId: string
  path: string
  pid?: number
}
export async function listDesktopApps(
  signal?: AbortSignal
): Promise<DesktopApp[]> {
  const result = await runAutomation('agent-desktop', ['list-apps'], signal)
  if (result.failed) throw new Error(result.text)
  const data = JSON.parse(result.text).data
  const apps: Array<Record<string, unknown>> = Array.isArray(data)
    ? data
    : (data.apps ?? [])
  return apps
    .map((a) => ({
      name: String(a.name ?? a.app_name ?? ''),
      bundleId: String(a.bundle_id ?? a.bundleId ?? ''),
      path: String(a.path ?? a.bundle_path ?? ''),
      pid: typeof a.pid === 'number' ? a.pid : undefined
    }))
    .filter((a) => a.name && a.pid !== process.pid)
}
