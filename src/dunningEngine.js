import { recommendAction } from './llmClient.js';
import { mockRecommend } from './mockClient.js';
import { evaluateClassifications } from './evaluation.js';
import { simulatePolicy } from './policySimulator.js';
import { computeBaselines } from './baselines.js';
import { MAX_ATTEMPTS, MAX_WINDOW_DAYS } from './rules.js';

export async function runBatch(payments, onProgress) {
  const results = [];

  for (const payment of payments) {
    let classification;
    let hadLlmError = false;
    try {
      classification = await recommendAction(payment, { attempt: 1, maxAttempts: MAX_ATTEMPTS, daysSinceFirstFailure: 0 });
    } catch (err) {
      // One payment's LLM call failing (rate limit exhausted, transient API
      // error, etc.) shouldn't take down the whole batch — fall back to the
      // keyword classifier and flag it for audit/review.
      console.error(`[llmError] ${payment.id}:`, err.status, err.message?.slice(0, 300));
      classification = mockRecommend(payment);
      hadLlmError = true;
    }

    const { status, amountRecovered, history } = simulatePolicy(payment, classification, hadLlmError, {
      maxAttempts: MAX_ATTEMPTS,
      maxWindowDays: MAX_WINDOW_DAYS
    });

    results.push({
      ...payment,
      status,
      amountRecovered,
      attemptsUsed: history.length,
      isException: classification.confidence < 0.55 || hadLlmError,
      hadLlmError,
      predictedCategory: classification.category,
      history
    });

    onProgress?.(results.length, payments.length);
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
    exceptionsCount: exceptions.length,
    classification: evaluateClassifications(results),
    baselines: [
      {
        key: 'agent',
        label: 'This agent',
        recoveredCount: recovered.length,
        amountRecovered: Math.round(amountRecoveredTotal * 100) / 100,
        recoveryRatePct: Math.round((recovered.length / payments.length) * 1000) / 10,
        totalAttempts: results.reduce((s, r) => s + r.attemptsUsed, 0),
        fraudAttemptsWasted: 0,
        recklessAttempts: 0
      },
      ...computeBaselines(payments)
    ]
  };

  return { summary, payments: results };
}
