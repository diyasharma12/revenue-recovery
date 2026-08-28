// Code-enforced stopping rules. These are never overridden by the model's
// recommendation — the model advises, this file decides the hard limits.
export const MAX_ATTEMPTS = 4;
export const MAX_WINDOW_DAYS = 21;
export const DEFAULT_RETRY_DELAY_HOURS = 24;

// Simulated probability that a given retry/nudge actually recovers the payment,
// used only because we don't have a live payment gateway to test against.
export const RETRY_SUCCESS_PROB = {
  soft_decline: 0.45,
  customer_action_needed: 0.35,
  hard_decline: 0.02,
  fraud_suspected: 0.0
};
