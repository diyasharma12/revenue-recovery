import Anthropic from '@anthropic-ai/sdk';
import { mockRecommend, buildPrompt, ACTION_SCHEMA } from './mockClient.js';

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const TOOL = {
  name: 'recommend_action',
  description: 'Classify why a subscription payment failed and recommend the next bounded action.',
  input_schema: ACTION_SCHEMA
};

export async function recommendAction(payment, attemptContext) {
  if (!client) return mockRecommend(payment);

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'recommend_action' },
    messages: [{ role: 'user', content: buildPrompt(payment, attemptContext) }]
  });

  const toolUse = msg.content.find((b) => b.type === 'tool_use');
  return toolUse.input;
}
