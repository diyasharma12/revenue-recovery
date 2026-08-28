import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBatch } from './src/syntheticData.js';
import { runBatch } from './src/dunningEngine.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let lastRun = null;

app.post('/api/run-batch', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count) || 40, 100);
    const seed = parseInt(req.query.seed) || 42;
    const payments = generateBatch(count, seed);
    const result = await runBatch(payments);
    lastRun = result;
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/last-run', (req, res) => {
  res.json(lastRun || { summary: null, payments: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const mode = process.env.ANTHROPIC_API_KEY ? 'LIVE (Claude API)' : 'MOCK (no ANTHROPIC_API_KEY set)';
  console.log(`Revenue Recovery Agent running at http://localhost:${PORT}  [mode: ${mode}]`);
});
