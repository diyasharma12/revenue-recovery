// Deterministic per-payment PRNG so outcome simulation is reproducible —
// the real engine, the baseline comparisons, and the dashboard's policy
// sandbox all derive from the same underlying "was this payment secretly
// recoverable on attempt N" draws, so they stay comparable to each other.
export function seededRandomFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return function () {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    return h / 0x7fffffff;
  };
}
