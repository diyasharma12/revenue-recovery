# Revenue Recovery Agent

Razorpay AI Buildathon — Track 03: AI Revenue Recovery

## Problem

Subscription payments fail for many reasons — insufficient funds, expired
cards, suspected fraud, temporary bank issues. Naive retry logic either
wastes money hammering unrecoverable declines, or gives up on recoverable
ones too early. This agent diagnoses *why* each payment failed and recovers
what can be recovered, while staying within hard compliance and spam limits.

## Architecture

```
Synthetic failed payments (seeded, reproducible)
        |
        v
Dunning loop (src/dunningEngine.js)  <---- per payment, up to MAX_ATTEMPTS
        |
        v
Claude API tool-call (src/claudeClient.js)
  -> classifies decline category (soft / hard / fraud / needs customer action)
  -> recommends ONE next action + a customer message + reasoning
        |
        v
Code-enforced stopping rules (src/rules.js)   <-- always wins over the model
  -> max 4 attempts, max 21-day window, fraud always stops immediately
        |
        v
Simulated outcome (stands in for a real gateway retry / customer response)
        |
        v
Per-payment audit trail + batch summary  -->  dashboard (public/)
```

**Key design choice:** the model recommends, the code decides. Every
recommendation passes through `rules.js` before it's acted on, and every
override is logged (`overridden` field) so it shows up in the audit trail.
This is what keeps the agent "compliant and bounded" rather than letting an
LLM freely decide how many times to contact a customer or whether to keep
retrying a suspected-fraud card.

## What's real vs simulated

- **Real:** the classification + decision call to Claude, the stopping-rule
  enforcement, the audit trail, the aggregate reporting.
- **Simulated:** whether a retry/nudge actually succeeds. There's no live
  payment gateway in this sandbox, so outcomes are drawn from a seeded
  probability model per decline category (`src/rules.js`). In production,
  the "execute" step would call Razorpay's actual retry/notification APIs
  and this simulation would be replaced by the real result.

## Running it

```bash
npm install
cp .env.example .env   # add your ANTHROPIC_API_KEY
npm start
```

Open http://localhost:3000 and click **Run Batch**. Without an API key set,
the engine falls back to a keyword-based mock classifier so you can still
exercise the full pipeline (stopping rules, simulation, dashboard) end to
end — useful for testing before wiring in the real key.

## Judging criteria mapping

- **Measured money recovered across a batch:** summary panel reports
  recovery rate %, total ₹ recovered, escalated/given-up counts over the
  full batch — not a single cherry-picked example.
- **Compliant escalation:** fraud-suspected cases stop immediately;
  unresolved cases after the retry window escalate to a human rather than
  looping forever.
- **Stopping rules:** hard-coded in `src/rules.js`, enforced in
  `dunningEngine.js` regardless of what the model suggests.
- **Audit trail:** every payment has a full per-attempt history — category,
  confidence, model recommendation, actual action taken, override flag,
  customer message, and reasoning — viewable per-row in the dashboard.

## Known limitations (worth saying out loud in the pitch)

- Outcome simulation is probabilistic, not a real gateway integration.
- Synthetic dataset is small (default 40) and messages are drawn from a
  fixed pool — real gateway decline text is messier.
- No real customer messaging (email/SMS) is sent; `customer_message` is
  generated but only logged.
