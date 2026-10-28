// Pure secret detection, shared by the main process (the API's masking, the
// log scrub) and the renderer (the MCP form's "secrets in arguments" notice):
// `@actovia-ai/secret-detect` (packages/secret-detect, ISSUE-270). The
// write-side rules (restoring a posted mask, destinations) stay in
// `src/main/lib/secrets/`.
export * from '@actovia-ai/secret-detect'
