// Before the boot splash paints; no API or module graph is needed.
try {
  document.documentElement.dataset.reduceMotion = String(
    localStorage.getItem('actovia-reduce-motion') === 'true'
  )
} catch {
  /* OS preference still applies */
}
