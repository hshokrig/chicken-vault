import { describe, expect, it } from 'vitest';
import { QuestionDecisionSchema } from '../src/ai/questionSchema.js';

describe('QuestionDecisionSchema', () => {
  it('accepts a valid responding payload', () => {
    const parsed = QuestionDecisionSchema.parse({
      shouldRespond: true,
      editedQuestion: 'Is the card red?',
      answer: 'YES',
      ignoreReason: null
    });

    expect(parsed.shouldRespond).toBe(true);
    expect(parsed.answer).toBe('YES');
  });

  it('rejects inconsistent answer when shouldRespond=false', () => {
    const invalid = {
      shouldRespond: false,
      editedQuestion: '',
      answer: 'NO',
      ignoreReason: 'CHATTER'
    };

    expect(() => QuestionDecisionSchema.parse(invalid)).toThrowError();
  });
});
