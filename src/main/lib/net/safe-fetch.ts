// Fetching a URL someone else chose (an images API's link, a Places photo)
// without reaching this machine or its networks: `@actovia-ai/web-reader`
// (packages/web-reader, ISSUE-270). Kept at this path for its callers.
export {
  canonicalizeIp,
  fetchPublicHttps,
  type FetchPublicHttpsOptions,
  type IpBytes,
  isLocalhostName,
  isLoopbackOrUnspecified,
  isPublicAddress,
  type ResolvedAddress,
  resolveAddresses,
  UnsafeUrlError
} from '@actovia-ai/web-reader'
