import { simulatePolicy } from '/src/policySimulator.js';

// Category/action values from the model are snake_case identifiers
// (e.g. "customer_action_needed") — fine as code, unreadable as UI text.
const humanize = (s) => s.replace(/_/g, ' ');

const OVERRIDE_REASON_LABEL = {
  cap_reached: 'cap reached',
  window_exceeded: 'window exceeded',
  fraud_override: 'fraud override'
};

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
let showAllRows = false;
const LEDGER_PAGE_SIZE = 8;
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
    <div class="headline-row">
      <div class="headline-stat primary"><div class="value">₹${s.amountRecovered.toLocaleString('en-IN')}</div><div class="label">Amount recovered</div></div>
      <div class="headline-stat secondary"><div class="value">${s.recoveryRatePct}%</div><div class="label">Recovery rate</div></div>
    </div>
    <div class="support-row">
      <div class="support-stat accent"><div class="value">${c.accuracyPct === null ? 'N/A' : c.accuracyPct + '%'}</div><div class="label">Accuracy (${c.correctCount}/${c.scorableCount})</div></div>
      <div class="support-stat warn"><div class="value">${s.escalatedCount}</div><div class="label">Escalated</div></div>
      <div class="support-stat bad"><div class="value">${s.givenUpCount}</div><div class="label">Given up</div></div>
      <div class="support-stat warn"><div class="value">${s.exceptionsCount}</div><div class="label">Exceptions</div></div>
    </div>
  `;

  renderFunnel(s);
  renderBaselines(s.baselines, s.totalAtRiskAmount);
  renderClassification(c);

  currentPayments = data.payments;
  showAllRows = false;
  renderTable(currentPayments);
  renderSandbox(currentPayments, {
    recoveredCount: s.recoveredCount,
    amountRecovered: s.amountRecovered,
    escalatedCount: s.escalatedCount,
    givenUpCount: s.givenUpCount
  });
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

function buildPresets() {
  const b = productionRules;
  return [
    { key: 'conservative', name: 'Conservative', maxAttempts: Math.max(1, Math.round(b.maxAttempts / 2)), maxWindowDays: Math.max(3, Math.round(b.maxWindowDays / 3)) },
    { key: 'balanced', name: 'Balanced', maxAttempts: b.maxAttempts, maxWindowDays: b.maxWindowDays },
    { key: 'extended', name: 'Extended', maxAttempts: b.maxAttempts + 2, maxWindowDays: Math.round(b.maxWindowDays * 1.67) }
  ];
}

function renderSandbox(payments, actual) {
  sandboxEl.innerHTML = `
    <h2>Policy sandbox</h2>
    <p class="note">Replays the same diagnoses already made — no new API calls — through different stopping-rule limits, so you can see the tradeoff those limits are actually making.</p>
    <div class="preset-row" id="presetRow"></div>
    <div id="sandboxOutput"></div>
  `;

  const presetRow = document.getElementById('presetRow');
  const output = document.getElementById('sandboxOutput');
  const presets = buildPresets();

  function renderPresetButtons(activeKey) {
    presetRow.innerHTML = presets.map((p) => `
      <button class="preset-btn${p.key === activeKey ? ' active' : ''}" data-key="${p.key}">
        <div class="name">${p.name}</div>
        <div class="detail">${p.maxAttempts} attempts, ${p.maxWindowDays}-day window</div>
      </button>
    `).join('');
    presetRow.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.onclick = () => update(btn.dataset.key);
    });
  }

  function update(key) {
    const preset = presets.find((p) => p.key === key) || presets[1];
    renderPresetButtons(preset.key);

    const r = recomputeWithPolicy(payments, preset.maxAttempts, preset.maxWindowDays);
    const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');

    const dRecovered = r.recoveredCount - actual.recoveredCount;
    const dAmount = Math.round((r.amountRecovered - actual.amountRecovered) * 100) / 100;
    const dEscalated = r.escalatedCount - actual.escalatedCount;
    const dGivenUp = r.givenUpCount - actual.givenUpCount;

    const chips = [];
    if (dRecovered !== 0) chips.push(`<span class="delta ${dRecovered > 0 ? 'good' : 'bad'}">${sign(dRecovered)}${Math.abs(dRecovered)} recovered</span>`);
    if (dAmount !== 0) chips.push(`<span class="delta ${dAmount > 0 ? 'good' : 'bad'}">${sign(dAmount)}₹${Math.abs(dAmount).toLocaleString('en-IN')}</span>`);
    if (dEscalated !== 0) chips.push(`<span class="delta neutral">${sign(dEscalated)}${Math.abs(dEscalated)} escalated</span>`);
    if (dGivenUp !== 0) chips.push(`<span class="delta ${dGivenUp > 0 ? 'bad' : 'good'}">${sign(dGivenUp)}${Math.abs(dGivenUp)} given up</span>`);

    output.innerHTML = chips.length
      ? `<div class="delta-line">${chips.join('')}</div>`
      : `<p class="unchanged-note">No change — matches the actual run.</p>`;
  }

  update('balanced');
}

function paymentFlags(p) {
  const flags = [];
  const reasons = new Set(p.history.filter((h) => h.overrideReason).map((h) => h.overrideReason));
  if (reasons.has('cap_reached')) flags.push('<span class="flag flag-cap" title="The model wanted to keep going, but the attempt limit had already been reached">cap reached</span>');
  if (reasons.has('window_exceeded')) flags.push('<span class="flag flag-window" title="The model recommended another retry, but the 21-day retry window had already passed">window exceeded</span>');
  if (reasons.has('fraud_override')) flags.push('<span class="flag flag-fraud" title="Code stopped this immediately because the category is fraud_suspected, regardless of what the model recommended">fraud override</span>');
  if (p.hadLlmError) flags.push('<span class="flag flag-error" title="LLM call failed at least once; fell back to keyword classifier">LLM fallback</span>');
  if (p.isException && !p.hadLlmError) flags.push('<span class="flag flag-warning" title="Model confidence dropped below 0.55 on this payment">low confidence</span>');
  return flags.join(' ') || '<span class="note">—</span>';
}

function renderTable(payments) {
  const filter = statusFilter.value;
  const filtered = filter === 'all' ? payments : payments.filter((p) => p.status === filter);
  const visible = showAllRows ? filtered : filtered.slice(0, LEDGER_PAGE_SIZE);

  tbody.innerHTML = '';
  visible.forEach((p) => {
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

  let toggleBtn = document.getElementById('showAllRowsBtn');
  if (!toggleBtn) {
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'showAllRowsBtn';
    toggleBtn.className = 'show-all-btn';
    toggleBtn.onclick = () => { showAllRows = !showAllRows; renderTable(currentPayments); };
    document.querySelector('#tableSection .table-scroll').after(toggleBtn);
  }
  if (filtered.length > LEDGER_PAGE_SIZE) {
    toggleBtn.style.display = 'block';
    toggleBtn.textContent = showAllRows ? 'Show fewer rows ↑' : `Show all ${filtered.length} rows ↓`;
  } else {
    toggleBtn.style.display = 'none';
  }
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
          Model recommended: ${humanize(h.modelRecommendedAction)}${h.overridden ? ` <span class="overridden">(${OVERRIDE_REASON_LABEL[h.overrideReason] || 'overridden'} -&gt; ${humanize(h.actionTaken)})</span>` : ` -&gt; ${humanize(h.actionTaken)}`}<br>
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
