/** CLIs give epoch seconds; Exodus keeps ms. */
export const toMs = (n: number) => (n < 1e12 ? n * 1000 : n)
