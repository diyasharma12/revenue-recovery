import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import { mockRecommend, buildPrompt, ACTION_SCHEMA } from './mockClient.js';

const client = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const TOOL_DECLARATION = {
  name: 'recommend_action',
  description: 'Classify why a subscription payment failed and recommend the next bounded action.',
  parametersJsonSchema: ACTION_SCHEMA
};

export async function recommendAction(payment, attemptContext) {
  if (!client) return mockRecommend(payment);

  const response = await client.models.generateContent({
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

  const call = response.functionCalls && response.functionCalls[0];
  if (!call) {
    throw new Error('Gemini did not return a function call. Raw response: ' + JSON.stringify(response).slice(0, 500));
  }
  return call.args;
}
