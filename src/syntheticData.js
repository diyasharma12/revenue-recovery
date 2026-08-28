// Deterministic PRNG so the same seed always produces the same batch —
// makes the demo reproducible run to run.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Raw gateway decline messages. Some are unambiguous, a few are deliberately
// vague ("error code 51") so the agent has genuinely hard cases to classify,
// not just a lookup table dressed up as AI.
const RAW_MESSAGES = [
  { text: 'Your bank declined this transaction due to insufficient funds in your account.', trueCategory: 'soft_decline' },
  { text: 'Transaction declined - insufficient balance. Please retry after adding funds.', trueCategory: 'soft_decline' },
  { text: 'Card declined: expired card. Please update your payment method.', trueCategory: 'customer_action_needed' },
  { text: 'CVV verification failed for this transaction.', trueCategory: 'customer_action_needed' },
  { text: 'Do not honor - issuer declined the transaction.', trueCategory: 'hard_decline' },
  { text: 'Card reported lost or stolen. Transaction blocked.', trueCategory: 'fraud_suspected' },
  { text: 'Suspected fraudulent activity detected on this card.', trueCategory: 'fraud_suspected' },
  { text: 'Transaction declined - error code 51.', trueCategory: 'ambiguous' },
  { text: 'Bank server timeout, please try again.', trueCategory: 'soft_decline' },
  { text: 'Daily transaction limit exceeded on card.', trueCategory: 'soft_decline' },
  { text: 'Card blocked by issuing bank for security review.', trueCategory: 'hard_decline' },
  { text: 'Invalid card number format.', trueCategory: 'customer_action_needed' }
];

const CARD_TYPES = ['Visa', 'Mastercard', 'RuPay', 'Amex'];
const PLANS = ['Basic Monthly', 'Pro Monthly', 'Pro Annual', 'Team Monthly'];

export function generateBatch(count = 40, seed = 42) {
  const rand = mulberry32(seed);
  const payments = [];
  for (let i = 0; i < count; i++) {
    const msg = RAW_MESSAGES[Math.floor(rand() * RAW_MESSAGES.length)];
    payments.push({
      id: `sub_${1000 + i}`,
      customerId: `cust_${2000 + i}`,
      amountInr: Math.round((199 + rand() * 1800) * 100) / 100,
      planName: PLANS[Math.floor(rand() * PLANS.length)],
      cardType: CARD_TYPES[Math.floor(rand() * CARD_TYPES.length)],
      customerTenureDays: Math.floor(rand() * 900),
      previousSuccessfulPayments: Math.floor(rand() * 24),
      gatewayRawMessage: msg.text,
      firstFailedAt: new Date(Date.now() - Math.floor(rand() * 5) * 86400000).toISOString()
    });
  }
  return payments;
}
