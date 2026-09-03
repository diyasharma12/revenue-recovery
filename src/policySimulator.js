import { seededRandomFor } from './rng.js';
import { RETRY_SUCCESS_PROB, DEFAULT_RETRY_DELAY_HOURS } from './rules.js';

// Replays one payment's already-made diagnosis through the stopping rules
// and outcome simulation. This is the single place that logic lives — the
// real engine (dunningEngine.js, called with the production rule constants)
// and the dashboard's interactive policy sandbox (called with slider values
// in the browser) both call this exact function, so the sandbox can never
// drift from what the rules actually enforce in a real run.
export function simulatePolicy(payment, classification, hadLlmError, { maxAttempts, maxWindowDays }) {
  const rand = seededRandomFor(payment.id);
  const successProb = RETRY_SUCCESS_PROB[classification.category] ?? 0.1;
  const delayDays = Math.round((classification.retry_delay_hours || DEFAULT_RETRY_DELAY_HOURS) / 24) || 1;

  const history = [];
  let attempt = 1;
  let daysSinceFirstFailure = 0;
  let status = 'pending';
  let amountRecovered = 0;

  while (status === 'pending') {
    let action = classification.recommended_action;
    let overridden = null;

    // Hard-coded, code-enforced stopping rules. The model's recommendation
    // is a suggestion; these limits always win.
    if (attempt >= maxAttempts && action !== 'stop_permanently' && action !== 'escalate_to_human') {
      overridden = action;
      action = 'stop_permanently';
    }
    if (daysSinceFirstFailure >= maxWindowDays && action.startsWith('retry')) {
      overridden = action;
      action = 'escalate_to_human';
    }
    if (classification.category === 'fraud_suspected' && action !== 'stop_permanently') {
      overridden = action;
      action = 'stop_permanently';
    }

    const entry = {
      attempt,
      timestamp: new Date(Date.now() + daysSinceFirstFailure * 86400000).toISOString(),
      category: classification.category,
      confidence: classification.confidence,
      modelRecommendedAction: classification.recommended_action,
      actionTaken: action,
      overridden,
      customerMessage: classification.customer_message,
      reasoning: classification.reasoning,
      retryDelayHours: classification.retry_delay_hours,
      llmError: attempt === 1 && hadLlmError,
      reusedDiagnosis: attempt > 1
    };

    if (action === 'stop_permanently' || action === 'escalate_to_human') {
      history.push(entry);
      status = action === 'escalate_to_human' ? 'escalated' : 'given_up';
      break;
    }

    const succeeded = rand() < successProb;
    entry.outcome = succeeded ? 'recovered' : 'no_response';
    history.push(entry);

    if (succeeded) {
      status = 'recovered';
      amountRecovered = payment.amountInr;
      break;
    }

    attempt++;
    daysSinceFirstFailure += delayDays;

    if (attempt > maxAttempts || daysSinceFirstFailure > maxWindowDays) {
      status = 'given_up';
    }
  }

  return { status, amountRecovered, history };
}
