/**
 * Single source of truth for every third-party URL the app references.
 * Define each one here so any future change (brand domain, doc URL move,
 * region mirror, etc.) is a one-line edit.
 *
 * NOT included: user-editable settings placeholders such as provider API
 * base URLs (Anthropic / OpenAI / xAI / Gemini) or the MCP example inputs —
 * those are defaults shown in form fields, not links the app itself
 * navigates to.
 */

// Actovia brand
export const EXODUS_WEBSITE = 'https://actovia.yancey.app'
export const EXODUS_REPO = 'https://github.com/actovia-ai/actovia'
export const EXODUS_TWITTER = 'https://x.com/YanceyOfficial'

// skills.sh (Agent Skills registry). The main process reaches it through the
// same BFF relay the Actovia CLI uses; `EXODUS_SKILLS_BFF_URL` overrides the relay.
export const SKILLS_SH_HOMEPAGE = 'https://www.skills.sh'
export const SKILLS_SH_BFF_URL = 'https://skills-md.yancey.app'
/** Public page of a skill; `id` is `owner/repo/slug`. */
export function skillsShSkill(id: string): string {
  return `${SKILLS_SH_HOMEPAGE}/${id}`
}

/** Source repository of a skill, from the registry's `owner/repo` string. */
export function githubRepoUrl(ownerRepo: string): string {
  return `https://github.com/${ownerRepo}`
}

// The Actovia CLI — the terminal counterpart of the Skills Market page.
export const EXODUS_CLI_NPM = 'https://www.npmjs.com/package/@actovia-ai/cli'
export const EXODUS_CLI_REPO = 'https://github.com/actovia-ai/cli'

// Documentation
export const BRAVE_SEARCH_DOCS =
  'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started'
export const GOOGLE_MAPS_ROUTES_DOCS =
  'https://developers.google.com/maps/documentation/routes/overview'
export const GOOGLE_MAPS_PLACES_DOCS =
  'https://developers.google.com/maps/documentation/places/web-service/overview'
export const MCP_HOMEPAGE = 'https://modelcontextprotocol.io'

// Google services
export const GOOGLE_FAVICON_API = 'https://www.google.com/s2/favicons'
export const GOOGLE_MAPS_SEARCH = 'https://www.google.com/maps/search/'
export const GOOGLE_PLACES_API_BASE = 'https://places.googleapis.com/v1/'
export const GOOGLE_MAPS_NO_THUMBNAIL =
  'https://maps.gstatic.com/tactile/pane/result-no-thumbnail-2x.png'

// Embedded third-party assets
export const TRADINGVIEW_SYMBOL_OVERVIEW_WIDGET =
  'https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js'
export const ELEVEN_PERLIN_NOISE_TEXTURE =
  'https://storage.googleapis.com/eleven-public-cdn/images/perlin-noise.png'

/**
 * Build a Google favicon URL.
 * Accepts either a full URL ("https://example.com/foo") or an origin
 * ("https://example.com"); returns the Google s2 favicon endpoint.
 */
export function faviconUrl(urlOrOrigin: string, size = 128): string {
  let domain = urlOrOrigin
  try {
    domain = new URL(urlOrOrigin).origin
  } catch {
    // already an origin string, or invalid — pass through
  }
  return `${GOOGLE_FAVICON_API}?domain=${domain}&sz=${size}`
}

/**
 * Build a Google Maps search URL ("?api=1&query=…") for an address.
 */
export function googleMapsSearchUrl(query: string): string {
  return `${GOOGLE_MAPS_SEARCH}?api=1&query=${encodeURIComponent(query)}`
}
