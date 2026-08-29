import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBatch } from './src/syntheticData.js';
import { runBatch } from './src/dunningEngine.js';
import { activeProvider } from './src/llmClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Revenue Recovery Agent running at http://localhost:${PORT}  [provider: ${activeProvider()}]`);
});
