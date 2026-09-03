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

// Raw gateway decline messages. The first block is unambiguous, keyword-
// obvious cases ("insufficient funds", "expired card") — realistic, but
// trivially easy to classify by pattern-matching alone. The second block
// deliberately paraphrases the same underlying reasons with no giveaway
// keyword, so a keyword-matching classifier gets them wrong while genuine
// language understanding should still get them right — otherwise a 100%
// accuracy score proves nothing beyond "the test was too easy." The third
// block is genuinely ambiguous with no single correct category.
const RAW_MESSAGES = [
  // --- keyword-obvious ---
  { text: 'Your bank declined this transaction due to insufficient funds in your account.', trueCategory: 'soft_decline' },
  { text: 'Transaction declined - insufficient balance. Please retry after adding funds.', trueCategory: 'soft_decline' },
  { text: 'Card declined: expired card. Please update your payment method.', trueCategory: 'customer_action_needed' },
  { text: 'CVV verification failed for this transaction.', trueCategory: 'customer_action_needed' },
  { text: 'Do not honor - issuer declined the transaction.', trueCategory: 'hard_decline' },
  { text: 'Card reported lost or stolen. Transaction blocked.', trueCategory: 'fraud_suspected' },
  { text: 'Suspected fraudulent activity detected on this card.', trueCategory: 'fraud_suspected' },
  { text: 'Bank server timeout, please try again.', trueCategory: 'soft_decline' },
  { text: 'Daily transaction limit exceeded on card.', trueCategory: 'soft_decline' },
  { text: 'Card blocked by issuing bank for security review.', trueCategory: 'hard_decline' },
  { text: 'Invalid card number format.', trueCategory: 'customer_action_needed' },

  // --- same reasons, paraphrased with no giveaway keyword ---
  { text: 'Your available balance was not enough to cover this charge.', trueCategory: 'soft_decline' },
  { text: 'The payment network timed out before confirming this transaction.', trueCategory: 'soft_decline' },
  { text: 'This card has reached its spending cap for today.', trueCategory: 'soft_decline' },
  { text: "This card's validity period has lapsed.", trueCategory: 'customer_action_needed' },
  { text: 'The security code entered does not match our records.', trueCategory: 'customer_action_needed' },
  { text: 'The card number entered appears to be incorrectly formatted.', trueCategory: 'customer_action_needed' },
  { text: 'The issuing bank will not authorize this transaction under any circumstances.', trueCategory: 'hard_decline' },
  { text: "This account has been flagged by the bank's compliance team and transactions are refused.", trueCategory: 'hard_decline' },
  { text: 'The cardholder has disputed a prior charge as unauthorized, and this card is now restricted.', trueCategory: 'fraud_suspected' },
  { text: 'Card issuer has placed a hold pending investigation into unusual account activity.', trueCategory: 'fraud_suspected' },

  // --- genuinely ambiguous, no single correct category ---
  { text: 'Transaction declined - error code 51.', trueCategory: 'ambiguous' },
  { text: 'Response code 05.', trueCategory: 'ambiguous' },
  { text: 'The issuer could not complete this request at this time.', trueCategory: 'ambiguous' },
  { text: 'Please contact your card issuer for more information regarding this decline.', trueCategory: 'ambiguous' }
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
      firstFailedAt: new Date(Date.now() - Math.floor(rand() * 5) * 86400000).toISOString(),
      trueCategory: msg.trueCategory
    });
  }
  return payments;
}
