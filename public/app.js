import { simulatePolicy } from '/src/policySimulator.js';

// Category/action values from the model are snake_case identifiers
// (e.g. "customer_action_needed") — fine as code, unreadable as UI text.
const humanize = (s) => s.replace(/_/g, ' ');

const runBtn = document.getElementById('runBtn');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const classificationEl = document.getElementById('classificationSection');
const funnelEl = document.getElementById('funnelSection');
const baselineEl = document.getElementById('baselineSection');
const sandboxEl = document.getElementById('sandboxSection');
const tbody = document.querySelector('#paymentsTable tbody');
const modal = document.getElementById('detailModal');
const detailContent = document.getElementById('detailContent');
const statusFilter = document.getElementById('statusFilter');
document.getElementById('closeModal').onclick = () => modal.close();

let currentPayments = [];
let productionRules = { maxAttempts: 4, maxWindowDays: 21 };
statusFilter.onchange = () => renderTable(currentPayments);

fetch('/api/rules').then((r) => r.json()).then((rules) => { productionRules = rules; });

runBtn.onclick = async () => {
  runBtn.disabled = true;
  statusEl.textContent = 'Agent is diagnosing and recovering payments... (0/40)';

  const poll = setInterval(async () => {
    try {
      const p = await (await fetch('/api/run-progress')).json();
      if (p.running) {
        statusEl.textContent = `Agent is diagnosing and recovering payments... (${p.completed}/${p.total})`;
      }
    } catch {
      // progress polling is best-effort; the main request below is authoritative
    }
  }, 1000);

  try {
    const res = await fetch('/api/run-batch?count=40', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    render(data);
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  } finally {
    clearInterval(poll);
    runBtn.disabled = false;
  }
};

function render(data) {
  const s = data.summary;
  const c = s.classification;
  summaryEl.innerHTML = `
    <div class="stat"><div class="value">${s.recoveryRatePct}%</div><div class="label">Recovery rate</div></div>
    <div class="stat good"><div class="value">₹${s.amountRecovered.toLocaleString('en-IN')}</div><div class="label">Amount recovered</div></div>
    <div class="stat accent"><div class="value">${c.accuracyPct === null ? 'N/A' : c.accuracyPct + '%'}</div><div class="label">Classification accuracy (${c.correctCount}/${c.scorableCount})</div></div>
    <div class="stat warn"><div class="value">${s.escalatedCount}</div><div class="label">Escalated</div></div>
    <div class="stat bad"><div class="value">${s.givenUpCount}</div><div class="label">Given up</div></div>
    <div class="stat warn"><div class="value">${s.exceptionsCount}</div><div class="label">Exceptions (low confidence)</div></div>
  `;

  renderFunnel(s);
  renderBaselines(s.baselines, s.totalAtRiskAmount);
  renderClassification(c);

  currentPayments = data.payments;
  renderTable(currentPayments);
  renderSandbox(currentPayments);
}

function funnelBarHTML(segments, total) {
  const bars = segments.map((seg) => {
    const pct = total ? Math.round((seg.count / total) * 1000) / 10 : 0;
    return pct > 0 ? `<div class="funnel-seg ${seg.cls}" style="width:${pct}%" title="${seg.label}: ${seg.count} (${pct}%)">${pct}%</div>` : '';
  }).join('');
  const legend = segments.map((seg) => `<span class="legend-item"><span class="legend-swatch ${seg.cls}"></span>${seg.label} (${seg.count})</span>`).join('');
  return `<div class="funnel-bar">${bars}</div><div class="funnel-legend">${legend}</div>`;
}

function renderFunnel(s) {
  const segments = [
    { label: 'Recovered', count: s.recoveredCount, cls: 'seg-recovered' },
    { label: 'Escalated', count: s.escalatedCount, cls: 'seg-escalated' },
    { label: 'Given up', count: s.givenUpCount, cls: 'seg-given_up' }
  ];
  funnelEl.innerHTML = `<h2>Outcome breakdown</h2>${funnelBarHTML(segments, s.totalPayments)}`;
}

function renderBaselines(baselines, totalAtRisk) {
  if (!baselines) { baselineEl.innerHTML = ''; return; }

  const rows = baselines.map((b) => {
    const perAttempt = b.totalAttempts ? Math.round((b.recoveredCount / b.totalAttempts) * 1000) / 10 : null;
    return `
      <tr>
        <td>${b.label}</td>
        <td class="num">₹${b.amountRecovered.toLocaleString('en-IN')}</td>
        <td class="num">${b.totalAttempts}</td>
        <td class="num">${perAttempt === null ? '—' : perAttempt + '%'}</td>
        <td class="num${b.recklessAttempts > 0 ? ' reckless' : ''}">${b.recklessAttempts}</td>
      </tr>
    `;
  }).join('');

  const naive = baselines.find((b) => b.key === 'retry_everything');
  const agent = baselines.find((b) => b.key === 'agent');
  let comparisonNote = '';
  if (naive && agent) {
    comparisonNote = naive.amountRecovered >= agent.amountRecovered
      ? `"${naive.label}" recovered a similar or slightly higher raw amount here — but only by spending ${naive.recklessAttempts} retry attempts on cards already flagged as fraud or already permanently declined by the bank, cases with essentially no real chance of success. This agent spends zero attempts on those, and recovers comparable money using far fewer total customer contacts (${agent.totalAttempts} vs ${naive.totalAttempts}).`
      : `This agent recovers more money using fewer total attempts, and spends zero of them on cards already flagged as fraud or permanently declined — "${naive.label}" wastes ${naive.recklessAttempts} attempts on exactly those.`;
  }

  baselineEl.innerHTML = `
    <h2>This agent vs. doing nothing smart</h2>
    <p class="note">Same payments (₹${totalAtRisk.toLocaleString('en-IN')} at risk), replayed through two naive policies. "Reckless attempts" = retries spent on cards already flagged as fraud or already permanently declined — cases with no real chance of recovering that a diagnosis-driven agent should never touch again.</p>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Policy</th><th class="num">Recovered</th><th class="num">Total attempts</th><th class="num">Success per attempt</th><th class="num">Reckless attempts</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="note">${comparisonNote}</p>
  `;
}

function classificationFromPayment(p) {
  const first = p.history[0];
  return {
    category: first.category,
    confidence: first.confidence,
    recommended_action: first.modelRecommendedAction,
    customer_message: first.customerMessage,
    reasoning: first.reasoning,
    retry_delay_hours: first.retryDelayHours
  };
}

function recomputeWithPolicy(payments, maxAttempts, maxWindowDays) {
  let recoveredCount = 0;
  let amountRecovered = 0;
  let escalatedCount = 0;
  let givenUpCount = 0;

  for (const p of payments) {
    const classification = classificationFromPayment(p);
    const result = simulatePolicy(p, classification, p.hadLlmError, { maxAttempts, maxWindowDays });
    if (result.status === 'recovered') { recoveredCount++; amountRecovered += result.amountRecovered; }
    else if (result.status === 'escalated') escalatedCount++;
    else givenUpCount++;
  }

  return {
    recoveredCount,
    amountRecovered: Math.round(amountRecovered * 100) / 100,
    recoveryRatePct: Math.round((recoveredCount / payments.length) * 1000) / 10,
    escalatedCount,
    givenUpCount
  };
}

function renderSandbox(payments) {
  sandboxEl.innerHTML = `
    <h2>Policy sandbox</h2>
    <p class="note">This replays the same diagnoses already made — no new API calls — through different stopping-rule limits, so you can see the tradeoff those limits are actually making.</p>
    <div class="sandbox-controls">
      <label>Max attempts: <span id="maxAttemptsVal"></span>
        <input type="range" id="maxAttemptsSlider" min="1" max="8" step="1">
      </label>
      <label>Max retry window (days): <span id="maxWindowVal"></span>
        <input type="range" id="maxWindowSlider" min="3" max="45" step="1">
      </label>
      <button id="resetSandbox" class="viewBtn">Reset to actual run</button>
    </div>
    <div id="sandboxOutput"></div>
  `;

  const maxAttemptsSlider = document.getElementById('maxAttemptsSlider');
  const maxWindowSlider = document.getElementById('maxWindowSlider');
  const maxAttemptsVal = document.getElementById('maxAttemptsVal');
  const maxWindowVal = document.getElementById('maxWindowVal');
  const output = document.getElementById('sandboxOutput');

  function update() {
    const maxAttempts = Number(maxAttemptsSlider.value);
    const maxWindowDays = Number(maxWindowSlider.value);
    maxAttemptsVal.textContent = maxAttempts;
    maxWindowVal.textContent = maxWindowDays;

    const r = recomputeWithPolicy(payments, maxAttempts, maxWindowDays);
    const isActual = maxAttempts === productionRules.maxAttempts && maxWindowDays === productionRules.maxWindowDays;

    const segments = [
      { label: 'Recovered', count: r.recoveredCount, cls: 'seg-recovered' },
      { label: 'Escalated', count: r.escalatedCount, cls: 'seg-escalated' },
      { label: 'Given up', count: r.givenUpCount, cls: 'seg-given_up' }
    ];

    output.innerHTML = `
      <div class="statement sandbox-statement">
        <div class="stat"><div class="value">${r.recoveryRatePct}%</div><div class="label">Recovery rate</div></div>
        <div class="stat good"><div class="value">₹${r.amountRecovered.toLocaleString('en-IN')}</div><div class="label">Amount recovered</div></div>
        <div class="stat warn"><div class="value">${r.escalatedCount}</div><div class="label">Escalated</div></div>
        <div class="stat bad"><div class="value">${r.givenUpCount}</div><div class="label">Given up</div></div>
      </div>
      ${funnelBarHTML(segments, payments.length)}
      <p class="note">${isActual ? 'Matches the actual run above.' : 'Hypothetical — the actual run used max attempts = ' + productionRules.maxAttempts + ', window = ' + productionRules.maxWindowDays + ' days.'}</p>
    `;
  }

  maxAttemptsSlider.value = productionRules.maxAttempts;
  maxWindowSlider.value = productionRules.maxWindowDays;
  maxAttemptsSlider.oninput = update;
  maxWindowSlider.oninput = update;
  document.getElementById('resetSandbox').onclick = () => {
    maxAttemptsSlider.value = productionRules.maxAttempts;
    maxWindowSlider.value = productionRules.maxWindowDays;
    update();
  };

  update();
}

function paymentFlags(p) {
  const flags = [];
  if (p.history.some((h) => h.overridden)) flags.push('<span class="flag flag-overridden" title="A stopping rule overrode the model\'s recommendation">overridden</span>');
  if (p.hadLlmError) flags.push('<span class="flag flag-error" title="LLM call failed at least once; fell back to keyword classifier">LLM fallback</span>');
  if (p.isException && !p.hadLlmError) flags.push('<span class="flag flag-warning" title="Model confidence dropped below 0.55 on this payment">low confidence</span>');
  return flags.join(' ') || '<span class="note">—</span>';
}

function renderTable(payments) {
  const filter = statusFilter.value;
  const filtered = filter === 'all' ? payments : payments.filter((p) => p.status === filter);

  tbody.innerHTML = '';
  filtered.forEach((p) => {
    const idx = payments.indexOf(p);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.customerId}</td>
      <td>${p.planName}</td>
      <td class="num">₹${p.amountInr}</td>
      <td><span class="status status-${p.status}"><span class="status-dot"></span>${humanize(p.status)}</span></td>
      <td>${paymentFlags(p)}</td>
      <td class="num">${p.attemptsUsed}</td>
      <td><button data-idx="${idx}" class="viewBtn">View trail</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.viewBtn[data-idx]').forEach((btn) => {
    btn.onclick = () => showDetail(currentPayments[btn.dataset.idx]);
  });
}

function renderClassification(c) {
  const categories = Object.keys(c.confusionMatrix).sort();
  const rows = categories.map((trueCat) => {
    const row = c.confusionMatrix[trueCat];
    const cells = categories.map((predCat) => {
      const count = row[predCat] || 0;
      const cls = predCat === trueCat ? 'match' : count > 0 ? 'mismatch' : '';
      return `<td class="${cls}">${count || ''}</td>`;
    }).join('');
    return `<tr><th>${humanize(trueCat)}</th>${cells}</tr>`;
  }).join('');

  const ambiguousNote = c.ambiguousCount
    ? `<p class="note">${c.ambiguousCount} payment(s) had a deliberately ambiguous decline message with no single correct category
       — excluded from the accuracy score above. The model classified them as:
       ${Object.entries(c.ambiguousBreakdown).map(([cat, n]) => `${humanize(cat)} (${n})`).join(', ')}.</p>`
    : '';

  classificationEl.innerHTML = `
    <h2>Classification accuracy vs. ground truth</h2>
    <p class="note">Predicted category (columns) vs. actual synthetic ground truth (rows). Diagonal = correct.</p>
    <table class="confusion-matrix">
      <thead><tr><th></th>${categories.map((cat) => `<th>${humanize(cat)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${ambiguousNote}
  `;
}

function showDetail(p) {
  const groundTruthLine = p.trueCategory === 'ambiguous'
    ? `<p><em>Ground truth: deliberately ambiguous — model predicted "${humanize(p.predictedCategory)}"</em></p>`
    : `<p><em>Ground truth: ${humanize(p.trueCategory)} — model predicted "${humanize(p.predictedCategory)}" ${p.predictedCategory === p.trueCategory ? '(correct)' : '(incorrect)'}</em></p>`;

  detailContent.innerHTML = `
    <h3>${p.customerId} — ${p.planName} (₹${p.amountInr})</h3>
    <p class="raw-message">"${p.gatewayRawMessage}"</p>
    ${groundTruthLine}
    <ol>
      ${p.history.map((h) => `
        <li>
          <strong>Attempt ${h.attempt}</strong> — category: ${humanize(h.category)} (confidence ${h.confidence})<br>
          Model recommended: ${humanize(h.modelRecommendedAction)}${h.overridden ? ` <span class="overridden">(overridden by stopping rules -&gt; ${humanize(h.actionTaken)})</span>` : ` -&gt; ${humanize(h.actionTaken)}`}<br>
          Message sent: "${h.customerMessage}"<br>
          Reasoning: ${h.reasoning}${h.reusedDiagnosis ? ' <em>(reused from attempt 1 — nothing new to re-diagnose)</em>' : ''}<br>
          ${h.llmError ? '<span class="overridden">(LLM call failed — fell back to keyword classifier for this attempt)</span><br>' : ''}
          ${h.outcome ? `Outcome: ${h.outcome}` : ''}
        </li>
      `).join('')}
    </ol>
    <p><strong>Final status:</strong> ${humanize(p.status)}</p>
  `;
  modal.showModal();
}

fetch('/api/last-run').then((r) => r.json()).then((data) => {
  if (data.summary) render(data);
});
