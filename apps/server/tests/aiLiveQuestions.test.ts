import { describe, expect, it } from 'vitest';
import { decideQuestionFromTranscript, resolveAiConfigFromEnv } from '../src/ai/questionAnalyzer.js';
import { loadEnv } from '../src/utils/env.js';
import { AI_QUESTION_CASES } from './fixtures/aiQuestionCases.js';

loadEnv();

const runLive = process.env.RUN_LIVE_AI_TESTS === 'true' && Boolean(process.env.OPENAI_API_KEY);
const liveDescribe = runLive ? describe : describe.skip;

liveDescribe('live gpt-5-nano question decisions', () => {
  it(
    'returns expected yes/no decisions on deterministic transcript cases',
    async () => {
      const config = resolveAiConfigFromEnv();
      const mismatches: string[] = [];
      let totalLatencyMs = 0;

      for (const testCase of AI_QUESTION_CASES) {
        const startedAt = Date.now();
        const result = await decideQuestionFromTranscript({
          transcript: testCase.transcript,
          secretCard: testCase.secretCard,
          config
        });
        totalLatencyMs += Date.now() - startedAt;

        if (result.shouldRespond !== testCase.expectShouldRespond) {
          mismatches.push(
            `${testCase.id}: expected shouldRespond=${testCase.expectShouldRespond}, got ${result.shouldRespond}`
          );
          continue;
        }

        if (testCase.expectShouldRespond && !result.editedQuestion.trim()) {
          mismatches.push(`${testCase.id}: expected non-empty editedQuestion`);
        }

        if (result.answer !== testCase.expectedAnswer) {
          mismatches.push(`${testCase.id}: expected answer=${testCase.expectedAnswer}, got ${result.answer}`);
        }
      }

      const avgLatencyMs = Math.round(totalLatencyMs / Math.max(1, AI_QUESTION_CASES.length));
      // eslint-disable-next-line no-console
      console.log(`[ai-live] Cases=${AI_QUESTION_CASES.length}, avg-latency=${avgLatencyMs}ms`);
      expect(mismatches).toEqual([]);
    },
    120_000
  );
});
