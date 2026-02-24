import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideQuestionFromTranscript } from '../src/ai/questionAnalyzer.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('question analyzer OpenAI request shape', () => {
  it('uses one structured chat completion call with developer role and strict schema', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  shouldRespond: true,
                  editedQuestion: 'Is the card red?',
                  answer: 'YES',
                  ignoreReason: null
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    const result = await decideQuestionFromTranscript({
      transcript: 'uh is the card red?',
      secretCard: 'QD',
      config: {
        apiKey: 'test-key',
        questionModel: 'gpt-5-nano'
      }
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(String(call[0])).toContain('/chat/completions');

    const request = JSON.parse(String((call[1] as RequestInit)?.body ?? '{}')) as {
      messages: Array<{ role: string }>;
      response_format: {
        type: string;
        json_schema: {
          strict: boolean;
          schema: Record<string, unknown>;
        };
      };
    };

    expect(request.messages[0]?.role).toBe('developer');
    expect(request.messages[1]?.role).toBe('user');
    expect(request.response_format?.type).toBe('json_schema');
    expect(request.response_format?.json_schema?.strict).toBe(true);
    expect(request.response_format?.json_schema?.schema).toBeDefined();

    expect(result.shouldRespond).toBe(true);
    expect(result.answer).toBe('YES');
    expect(result.editedQuestion).toBe('Is the card red?');
  });

  it('fails safely when model returns malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{not-json'
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    await expect(
      decideQuestionFromTranscript({
        transcript: 'is it red?',
        secretCard: 'QD',
        config: {
          apiKey: 'test-key'
        }
      })
    ).rejects.toThrowError('invalid JSON');
  });
});
