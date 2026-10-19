// Plaintext HTTP, bound to loopback only: the renderer, the Actovia CLI, the API
// tests and the iOS Simulator. Nothing on the LAN can reach it.
export const SERVER_PORT = 60223

// HTTPS, behind a per-device token, and only up while a device is paired or a
// pairing window is open (src/main/lib/lan/). exodus-ios on a device connects
// here. Changing either port means updating every client.
export const LAN_SERVER_PORT = 63129

// How long a pairing window (and the QR code on Settings → Devices) stays
// open. The main process enforces it; the renderer only draws the countdown.
export const PAIRING_TTL_MS = 120_000

export const BASE_URL = `http://localhost:${SERVER_PORT}`

// How much of one stack (an error's own, React's component stack) a client
// sends with an error report — `POST /api/v1/logs` — and the main process
// reads. More than the 8000 characters an attribute is stored under, on
// purpose: a frame in the packaged renderer is a
// `file:///…/app.asar/.vite/renderer/…` URL, about twice as long as the source
// position the main process maps it to, so mapping first keeps more frames.
export const REPORTED_STACK_MAX_CHARS = 32_000
