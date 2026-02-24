import { decideQuestionFromTranscript, resolveAiConfigFromEnv } from '../src/ai/questionAnalyzer.js';
import { loadEnv } from '../src/utils/env.js';
import { AI_QUESTION_ROUNDS } from '../tests/fixtures/aiQuestionCases.js';

loadEnv();

async function run(): Promise<void> {
  const config = resolveAiConfigFromEnv();
  if (!config.apiKey) {
    throw new Error('OPENAI_API_KEY is required.');
  }

  let total = 0;
  let passed = 0;
  let totalLatency = 0;

  for (const round of AI_QUESTION_ROUNDS) {
    // eslint-disable-next-line no-console
    console.log(`\n[eval] ${round.round} (secret card: ${round.card})`);
    for (const testCase of round.cases) {
      const startedAt = Date.now();
      const result = await decideQuestionFromTranscript({
        transcript: testCase.transcript,
        secretCard: testCase.secretCard,
        config
      });
      const latencyMs = Date.now() - startedAt;

      total += 1;
      totalLatency += latencyMs;

      const ok =
        result.shouldRespond === testCase.expectShouldRespond && result.answer === testCase.expectedAnswer && (!testCase.expectShouldRespond || Boolean(result.editedQuestion.trim()));
      if (ok) {
        passed += 1;
      }

      // eslint-disable-next-line no-console
      console.log(
        `[${ok ? 'PASS' : 'FAIL'}] ${testCase.id} | latency=${latencyMs}ms | shouldRespond=${result.shouldRespond} | answer=${result.answer} | edited="${result.editedQuestion}"`
      );
    }
  }

  const accuracy = ((passed / Math.max(1, total)) * 100).toFixed(1);
  const avgLatency = Math.round(totalLatency / Math.max(1, total));
  // eslint-disable-next-line no-console
  console.log(`\n[eval] summary: ${passed}/${total} passed (${accuracy}%), avg latency ${avgLatency}ms`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[eval] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
