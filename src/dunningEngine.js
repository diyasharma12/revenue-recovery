import { recommendAction } from './llmClient.js';
import { MAX_ATTEMPTS, MAX_WINDOW_DAYS, RETRY_SUCCESS_PROB, DEFAULT_RETRY_DELAY_HOURS } from './rules.js';

// Deterministic per-payment PRNG for reproducible outcome simulation
// (stands in for a real payment gateway retry result).
function seededRandomFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return function () {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    return h / 0x7fffffff;
  };
}

export async function runBatch(payments) {
  const results = [];

  for (const payment of payments) {
    const rand = seededRandomFor(payment.id);
    const history = [];
    let attempt = 1;
    let daysSinceFirstFailure = 0;
    let status = 'pending';
    let amountRecovered = 0;
    let hasLowConfidence = false;

    while (status === 'pending') {
      const rec = await recommendAction(payment, { attempt, maxAttempts: MAX_ATTEMPTS, daysSinceFirstFailure });

      let action = rec.recommended_action;
      let overridden = null;

      // Hard-coded, code-enforced stopping rules. The model's recommendation
      // is a suggestion; these limits always win.
      if (attempt >= MAX_ATTEMPTS && action !== 'stop_permanently' && action !== 'escalate_to_human') {
        overridden = action;
        action = 'stop_permanently';
      }
      if (daysSinceFirstFailure >= MAX_WINDOW_DAYS && action.startsWith('retry')) {
        overridden = action;
        action = 'escalate_to_human';
      }
      if (rec.category === 'fraud_suspected' && action !== 'stop_permanently') {
        overridden = action;
        action = 'stop_permanently';
      }

      if (rec.confidence < 0.55) hasLowConfidence = true;

      const entry = {
        attempt,
        timestamp: new Date(Date.now() + daysSinceFirstFailure * 86400000).toISOString(),
        category: rec.category,
        confidence: rec.confidence,
        modelRecommendedAction: rec.recommended_action,
        actionTaken: action,
        overridden,
        customerMessage: rec.customer_message,
        reasoning: rec.reasoning
      };

      if (action === 'stop_permanently' || action === 'escalate_to_human') {
        history.push(entry);
        status = action === 'escalate_to_human' ? 'escalated' : 'given_up';
        break;
      }

      const successProb = RETRY_SUCCESS_PROB[rec.category] ?? 0.1;
      const succeeded = rand() < successProb;
      entry.outcome = succeeded ? 'recovered' : 'no_response';
      history.push(entry);

      if (succeeded) {
        status = 'recovered';
        amountRecovered = payment.amountInr;
        break;
      }

      attempt++;
      daysSinceFirstFailure += Math.round((rec.retry_delay_hours || DEFAULT_RETRY_DELAY_HOURS) / 24) || 1;

      if (attempt > MAX_ATTEMPTS || daysSinceFirstFailure > MAX_WINDOW_DAYS) {
        status = 'given_up';
      }
    }

    results.push({
      ...payment,
      status,
      amountRecovered,
      attemptsUsed: history.length,
      isException: hasLowConfidence,
      history
    });
  }

  const totalAmount = payments.reduce((s, p) => s + p.amountInr, 0);
  const recovered = results.filter((r) => r.status === 'recovered');
  const escalated = results.filter((r) => r.status === 'escalated');
  const givenUp = results.filter((r) => r.status === 'given_up');
  const exceptions = results.filter((r) => r.isException);
  const amountRecoveredTotal = recovered.reduce((s, r) => s + r.amountRecovered, 0);

  const summary = {
    totalPayments: payments.length,
    totalAtRiskAmount: Math.round(totalAmount * 100) / 100,
    recoveredCount: recovered.length,
    amountRecovered: Math.round(amountRecoveredTotal * 100) / 100,
    recoveryRatePct: Math.round((recovered.length / payments.length) * 1000) / 10,
    escalatedCount: escalated.length,
    givenUpCount: givenUp.length,
    exceptionsCount: exceptions.length
  };

  return { summary, payments: results };
}
