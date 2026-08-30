const runBtn = document.getElementById('runBtn');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const classificationEl = document.getElementById('classificationSection');
const funnelEl = document.getElementById('funnelSection');
const tbody = document.querySelector('#paymentsTable tbody');
const modal = document.getElementById('detailModal');
const detailContent = document.getElementById('detailContent');
const statusFilter = document.getElementById('statusFilter');
document.getElementById('closeModal').onclick = () => modal.close();

let currentPayments = [];
statusFilter.onchange = () => renderTable(currentPayments);

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
    <div class="card"><div class="value">${s.recoveryRatePct}%</div><div class="label">Recovery rate</div></div>
    <div class="card"><div class="value">Rs.${s.amountRecovered.toLocaleString('en-IN')}</div><div class="label">Amount recovered</div></div>
    <div class="card"><div class="value">${c.accuracyPct === null ? 'N/A' : c.accuracyPct + '%'}</div><div class="label">Classification accuracy (${c.correctCount}/${c.scorableCount})</div></div>
    <div class="card"><div class="value">${s.escalatedCount}</div><div class="label">Escalated</div></div>
    <div class="card"><div class="value">${s.givenUpCount}</div><div class="label">Given up</div></div>
    <div class="card"><div class="value">${s.exceptionsCount}</div><div class="label">Exceptions (low confidence)</div></div>
  `;

  renderClassification(c);
  renderFunnel(s);

  currentPayments = data.payments;
  renderTable(currentPayments);
}

function renderFunnel(s) {
  const segments = [
    { label: 'Recovered', count: s.recoveredCount, cls: 'seg-recovered' },
    { label: 'Escalated', count: s.escalatedCount, cls: 'seg-escalated' },
    { label: 'Given up', count: s.givenUpCount, cls: 'seg-given_up' }
  ];
  const bars = segments.map((seg) => {
    const pct = s.totalPayments ? (seg.count / s.totalPayments) * 100 : 0;
    return pct > 0 ? `<div class="funnel-seg ${seg.cls}" style="width:${pct}%" title="${seg.label}: ${seg.count} (${Math.round(pct)}%)">${Math.round(pct)}%</div>` : '';
  }).join('');

  const legend = segments.map((seg) => `<span class="legend-item"><span class="legend-swatch ${seg.cls}"></span>${seg.label} (${seg.count})</span>`).join('');

  funnelEl.innerHTML = `
    <div class="funnel-bar">${bars}</div>
    <div class="funnel-legend">${legend}</div>
  `;
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
      <td>Rs.${p.amountInr}</td>
      <td><span class="badge status-${p.status}">${p.status.replace('_', ' ')}</span></td>
      <td>${paymentFlags(p)}</td>
      <td>${p.attemptsUsed}</td>
      <td><button data-idx="${idx}" class="viewBtn">View trail</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.viewBtn').forEach((btn) => {
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
    return `<tr><th>${trueCat}</th>${cells}</tr>`;
  }).join('');

  const ambiguousNote = c.ambiguousCount
    ? `<p class="note">${c.ambiguousCount} payment(s) had a deliberately ambiguous decline message with no single correct category
       — excluded from the accuracy score above. The model classified them as:
       ${Object.entries(c.ambiguousBreakdown).map(([cat, n]) => `${cat} (${n})`).join(', ')}.</p>`
    : '';

  classificationEl.innerHTML = `
    <h2>Classification accuracy vs. ground truth</h2>
    <p class="note">Predicted category (columns) vs. actual synthetic ground truth (rows). Diagonal = correct.</p>
    <table class="confusion-matrix">
      <thead><tr><th></th>${categories.map((cat) => `<th>${cat}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${ambiguousNote}
  `;
}

function showDetail(p) {
  const groundTruthLine = p.trueCategory === 'ambiguous'
    ? `<p><em>Ground truth: deliberately ambiguous — model predicted "${p.predictedCategory}"</em></p>`
    : `<p><em>Ground truth: ${p.trueCategory} — model predicted "${p.predictedCategory}" ${p.predictedCategory === p.trueCategory ? '(correct)' : '(incorrect)'}</em></p>`;

  detailContent.innerHTML = `
    <h3>${p.customerId} — ${p.planName} (Rs.${p.amountInr})</h3>
    <p>Raw decline message: <em>"${p.gatewayRawMessage}"</em></p>
    ${groundTruthLine}
    <ol>
      ${p.history.map((h) => `
        <li>
          <strong>Attempt ${h.attempt}</strong> — category: ${h.category} (confidence ${h.confidence})<br>
          Model recommended: ${h.modelRecommendedAction}${h.overridden ? ` <span class="overridden">(overridden by stopping rules -&gt; ${h.actionTaken})</span>` : ` -&gt; ${h.actionTaken}`}<br>
          Message sent: "${h.customerMessage}"<br>
          Reasoning: ${h.reasoning}${h.reusedDiagnosis ? ' <em>(reused from attempt 1 — nothing new to re-diagnose)</em>' : ''}<br>
          ${h.llmError ? '<span class="overridden">(LLM call failed — fell back to keyword classifier for this attempt)</span><br>' : ''}
          ${h.outcome ? `Outcome: ${h.outcome}` : ''}
        </li>
      `).join('')}
    </ol>
    <p><strong>Final status:</strong> ${p.status}</p>
  `;
  modal.showModal();
}

fetch('/api/last-run').then((r) => r.json()).then((data) => {
  if (data.summary) render(data);
});
