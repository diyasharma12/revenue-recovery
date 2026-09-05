import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBatch } from './src/syntheticData.js';
import { runBatch } from './src/dunningEngine.js';
import { activeProvider } from './src/llmClient.js';
import { MAX_ATTEMPTS, MAX_WINDOW_DAYS } from './src/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Exposes the pure simulation modules (no secrets, no live calls) so the
// dashboard's policy sandbox can import the exact same rule-replay logic
// the real engine uses, instead of a second hand-copied implementation.
app.use('/src', express.static(path.join(__dirname, 'src')));

let lastRun = null;
let progress = { running: false, completed: 0, total: 0 };

app.post('/api/run-batch', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count) || 40, 100);
    const seed = parseInt(req.query.seed) || 42;
    const payments = generateBatch(count, seed);
    progress = { running: true, completed: 0, total: count };
    const result = await runBatch(payments, (completed, total) => {
      progress = { running: true, completed, total };
    });
    result.provider = activeProvider();
    lastRun = result;
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    progress.running = false;
  }
});

app.get('/api/run-progress', (req, res) => {
  res.json(progress);
});

app.get('/api/last-run', (req, res) => {
  res.json(lastRun || { summary: null, payments: [] });
});

app.get('/api/rules', (req, res) => {
  res.json({ maxAttempts: MAX_ATTEMPTS, maxWindowDays: MAX_WINDOW_DAYS });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Revenue Recovery Agent running at http://localhost:${PORT}  [provider: ${activeProvider()}]`);
});
