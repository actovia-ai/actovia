// The trace context lives in @actovia-ai/logger, one AsyncLocalStorage for
// the process — the logger reads the same one `withTrace` sets.
export {
  bindTraceAttributes,
  currentTrace,
  newTraceId,
  type TraceContext,
  withTrace
} from '@actovia-ai/logger'
