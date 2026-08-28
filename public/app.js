const runBtn = document.getElementById('runBtn');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const tbody = document.querySelector('#paymentsTable tbody');
const modal = document.getElementById('detailModal');
const detailContent = document.getElementById('detailContent');
document.getElementById('closeModal').onclick = () => modal.close();

runBtn.onclick = async () => {
  runBtn.disabled = true;
  statusEl.textContent = 'Agent is diagnosing and recovering payments...';
  try {
    const res = await fetch('/api/run-batch?count=40', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    render(data);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  } finally {
    runBtn.disabled = false;
    if (statusEl.textContent.startsWith('Agent')) statusEl.textContent = '';
  }
};

function render(data) {
  const s = data.summary;
  summaryEl.innerHTML = `
    <div class="card"><div class="value">${s.recoveryRatePct}%</div><div class="label">Recovery rate</div></div>
    <div class="card"><div class="value">Rs.${s.amountRecovered.toLocaleString('en-IN')}</div><div class="label">Amount recovered</div></div>
    <div class="card"><div class="value">${s.escalatedCount}</div><div class="label">Escalated</div></div>
    <div class="card"><div class="value">${s.givenUpCount}</div><div class="label">Given up</div></div>
    <div class="card"><div class="value">${s.exceptionsCount}</div><div class="label">Exceptions (low confidence)</div></div>
  `;

  tbody.innerHTML = '';
  data.payments.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.customerId}</td>
      <td>${p.planName}</td>
      <td>Rs.${p.amountInr}</td>
      <td><span class="badge status-${p.status}">${p.status.replace('_', ' ')}</span></td>
      <td>${p.attemptsUsed}</td>
      <td><button data-idx="${idx}" class="viewBtn">View trail</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.viewBtn').forEach((btn) => {
    btn.onclick = () => showDetail(data.payments[btn.dataset.idx]);
  });
}

function showDetail(p) {
  detailContent.innerHTML = `
    <h3>${p.customerId} — ${p.planName} (Rs.${p.amountInr})</h3>
    <p>Raw decline message: <em>"${p.gatewayRawMessage}"</em></p>
    <ol>
      ${p.history.map((h) => `
        <li>
          <strong>Attempt ${h.attempt}</strong> — category: ${h.category} (confidence ${h.confidence})<br>
          Model recommended: ${h.modelRecommendedAction}${h.overridden ? ` <span class="overridden">(overridden by stopping rules -&gt; ${h.actionTaken})</span>` : ` -&gt; ${h.actionTaken}`}<br>
          Message sent: "${h.customerMessage}"<br>
          Reasoning: ${h.reasoning}<br>
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
