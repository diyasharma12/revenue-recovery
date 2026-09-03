import { seededRandomFor } from './rng.js';
import { MAX_ATTEMPTS, RETRY_SUCCESS_PROB } from './rules.js';

const FALLBACK_PROB = 0.1;
const NEVER_RETRY_CATEGORIES = new Set(['fraud_suspected', 'hard_decline']);

// Naive baseline: retry every failed payment blindly, with no diagnosis at
// all — including cards already reported for fraud, and cards the bank has
// already permanently declined. Since this policy does no diagnosis,
// whether a retry actually succeeds is governed by the payment's real
// underlying reason (trueCategory), not a guess — a policy with no brain
// still exists in the same physical world the agent does. That means it can
// occasionally get lucky on a case it should never have touched (a
// "permanently declined" card has a small real-world chance of clearing
// anyway) — which is exactly why raw recovered amount alone is a misleading
// way to compare these policies; see recklessAttempts below.
function retryEverythingBlindly(payments) {
  let recoveredCount = 0;
  let amountRecovered = 0;
  let totalAttempts = 0;
  let fraudAttemptsWasted = 0;
  let recklessAttempts = 0;

  for (const payment of payments) {
    const rand = seededRandomFor(payment.id);
    const prob = RETRY_SUCCESS_PROB[payment.trueCategory] ?? FALLBACK_PROB;
    const neverRetry = NEVER_RETRY_CATEGORIES.has(payment.trueCategory);
    let recovered = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      totalAttempts++;
      if (payment.trueCategory === 'fraud_suspected') fraudAttemptsWasted++;
      if (neverRetry) recklessAttempts++;
      if (rand() < prob) {
        recovered = true;
        break;
      }
    }

    if (recovered) {
      recoveredCount++;
      amountRecovered += payment.amountInr;
    }
  }

  return {
    key: 'retry_everything',
    label: 'Retry everything blindly',
    recoveredCount,
    amountRecovered: Math.round(amountRecovered * 100) / 100,
    recoveryRatePct: Math.round((recoveredCount / payments.length) * 1000) / 10,
    totalAttempts,
    fraudAttemptsWasted,
    recklessAttempts
  };
}

// Naive baseline: no retry, no nudge, no escalation — the payment is simply
// written off the moment it fails.
function giveUpImmediately(payments) {
  return {
    key: 'give_up',
    label: 'Give up immediately',
    recoveredCount: 0,
    amountRecovered: 0,
    recoveryRatePct: 0,
    totalAttempts: 0,
    fraudAttemptsWasted: 0,
    recklessAttempts: 0
  };
}

export function computeBaselines(payments) {
  return [retryEverythingBlindly(payments), giveUpImmediately(payments)];
}
