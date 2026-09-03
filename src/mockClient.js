// Keyword-based fallback used when no LLM API key is set at all, so the rest
// of the engine (stopping rules, simulation, dashboard) can be exercised and
// demoed before any real key is wired in.
export function mockRecommend(payment) {
  const text = payment.gatewayRawMessage.toLowerCase();
  let category = 'hard_decline';
  if (text.includes('insufficient') || text.includes('timeout') || text.includes('limit')) category = 'soft_decline';
  else if (text.includes('expired') || text.includes('cvv') || text.includes('invalid')) category = 'customer_action_needed';
  else if (text.includes('stolen') || text.includes('fraud')) category = 'fraud_suspected';

  const actionMap = {
    soft_decline: 'retry_scheduled',
    customer_action_needed: 'send_update_payment_link',
    hard_decline: 'escalate_to_human',
    fraud_suspected: 'stop_permanently'
  };

  return {
    category,
    confidence: 0.7,
    recommended_action: actionMap[category],
    retry_delay_hours: 24,
    customer_message: 'We had trouble processing your payment. Please check your payment method.',
    reasoning: '[MOCK - no API key set] keyword-based fallback classification.'
  };
}

export function buildPrompt(payment, attemptContext) {
  return `A subscription payment failed. Decide the next action.

Payment details:
- Amount: Rs.${payment.amountInr}
- Plan: ${payment.planName}
- Card type: ${payment.cardType}
- Customer tenure: ${payment.customerTenureDays} days
- Previous successful payments: ${payment.previousSuccessfulPayments}
- This is attempt #${attemptContext.attempt} of max ${attemptContext.maxAttempts}
- Days since first failure: ${attemptContext.daysSinceFirstFailure}
- Raw gateway decline message: "${payment.gatewayRawMessage}"

Classify the decline and recommend ONE bounded next action.`;
}

export const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    category: {
      type: 'string',
      enum: ['soft_decline', 'hard_decline', 'fraud_suspected', 'customer_action_needed'],
      description:
        'soft_decline: a temporary issue likely to succeed if simply retried later, with no customer action required ' +
        '(insufficient funds, bank server timeout, daily limit exceeded). ' +
        'customer_action_needed: the payment METHOD itself is broken and only the CUSTOMER can fix it before any retry ' +
        'could work (expired card, failed CVV check, invalid card number) — this is NOT the same as hard_decline. ' +
        'hard_decline: the issuing bank has non-fraud-related but effectively permanent objections to this card/transaction ' +
        '(explicit "do not honor", card blocked for security review) — retrying or asking the customer to fix details will not help. ' +
        'fraud_suspected: card reported lost/stolen or flagged for suspected fraud — never retry or contact the customer for payment.'
    },
    confidence: {
      type: 'number',
      description:
        '0 to 1 — how sure you actually are, calibrated honestly. A genuinely ambiguous or vague decline message ' +
        '(e.g. a bare bank response code with no further detail) should get a LOW score, not a confident guess dressed up as certainty.'
    },
    recommended_action: {
      type: 'string',
      enum: ['retry_now', 'retry_scheduled', 'send_update_payment_link', 'send_grace_period_offer', 'escalate_to_human', 'stop_permanently'],
      description:
        'retry_now / retry_scheduled: for soft_decline, where simply retrying (now or after a delay) is likely to work. ' +
        'send_update_payment_link: for customer_action_needed, where the customer must fix their payment method first. ' +
        'send_grace_period_offer: for a customer_action_needed or soft_decline case where extra time before further action is warranted. ' +
        'escalate_to_human: for hard_decline (the bank has permanently refused for non-fraud reasons — retrying or asking the ' +
        'customer to update details will not help, a person needs to follow up) OR whenever your confidence is low and you are ' +
        'not sure an automated action is safe. ' +
        'stop_permanently: ONLY for fraud_suspected — never retry or contact the customer.'
    },
    retry_delay_hours: { type: 'number' },
    customer_message: { type: 'string', description: 'Short, empathetic customer-facing message' },
    reasoning: { type: 'string', description: 'One sentence internal reasoning for the audit log' }
  },
  required: ['category', 'confidence', 'recommended_action', 'reasoning']
};
