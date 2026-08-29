import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import { mockRecommend, buildPrompt, ACTION_SCHEMA } from './mockClient.js';

const client = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
// gemini-3.6-flash's free tier caps at 20 requests/DAY (not just per-minute) —
// easy to blow through while iterating. The -lite variant carries a much
// higher free-tier request allowance and quotas are tracked per-model, so
// switching also gives us a fresh, untouched quota.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// Space calls out proactively instead of relying purely on reactive 429 retries.
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS) || 6500;
const MAX_RETRIES = 5;
let lastCallAt = 0;

const TOOL_DECLARATION = {
  name: 'recommend_action',
  description: 'Classify why a subscription payment failed and recommend the next bounded action.',
  parametersJsonSchema: ACTION_SCHEMA
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pulls the server-suggested wait out of a 429's error body
// (details[].retryDelay, e.g. "37s"); falls back to exponential backoff
// if the response didn't include one.
function retryDelayMsFrom(err, attempt) {
  try {
    const body = JSON.parse(err.message);
    const info = body?.error?.details?.find((d) => d['@type']?.includes('RetryInfo'));
    if (info?.retryDelay) return Math.ceil(parseFloat(info.retryDelay) * 1000) + 500;
  } catch {
    // not a parseable quota error body — fall through to backoff
  }
  return Math.min(2 ** attempt * 1000, 30000);
}

async function callGemini(payment, attemptContext) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();

  return client.models.generateContent({
    model: MODEL,
    contents: buildPrompt(payment, attemptContext),
    config: {
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ['recommend_action']
        }
      },
      tools: [{ functionDeclarations: [TOOL_DECLARATION] }]
    }
  });
}

export async function recommendAction(payment, attemptContext) {
  if (!client) return mockRecommend(payment);

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await callGemini(payment, attemptContext);
      const call = response.functionCalls && response.functionCalls[0];
      if (!call) {
        throw new Error('Gemini did not return a function call. Raw response: ' + JSON.stringify(response).slice(0, 500));
      }
      return call.args;
    } catch (err) {
      if (err.status !== 429 || attempt >= MAX_RETRIES) throw err;
      await sleep(retryDelayMsFrom(err, attempt));
    }
  }
}
