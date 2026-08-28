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
    category: { type: 'string', enum: ['soft_decline', 'hard_decline', 'fraud_suspected', 'customer_action_needed'] },
    confidence: { type: 'number', description: '0 to 1' },
    recommended_action: {
      type: 'string',
      enum: ['retry_now', 'retry_scheduled', 'send_update_payment_link', 'send_grace_period_offer', 'escalate_to_human', 'stop_permanently']
    },
    retry_delay_hours: { type: 'number' },
    customer_message: { type: 'string', description: 'Short, empathetic customer-facing message' },
    reasoning: { type: 'string', description: 'One sentence internal reasoning for the audit log' }
  },
  required: ['category', 'confidence', 'recommended_action', 'reasoning']
};
