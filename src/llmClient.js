// Provider router: uses whichever API key is present. Gemini is checked first
// since it's the free, no-phone-verification option; Anthropic works too if
// you have a Claude API key set up. Falls back to a mock classifier if
// neither key is set, so the rest of the app is still testable.
import { recommendAction as geminiRecommend } from './geminiClient.js';
import { recommendAction as claudeRecommend } from './claudeClient.js';
import { mockRecommend } from './mockClient.js';

export function activeProvider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  return 'mock';
}

export async function recommendAction(payment, attemptContext) {
  const provider = activeProvider();
  if (provider === 'gemini') return geminiRecommend(payment, attemptContext);
  if (provider === 'claude') return claudeRecommend(payment, attemptContext);
  return mockRecommend(payment);
}
