import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const QuestionIgnoreReasonSchema = z.union([
  z.literal('NO_QUESTION'),
  z.literal('CHATTER'),
  z.literal('NOT_CARD_RELATED'),
  z.literal('UNCLEAR'),
  z.null()
]);

export const QuestionDecisionSchema = z
  .object({
    shouldRespond: z
      .boolean()
      .describe('True only when transcript contains a clear card-related question from the current player.'),
    editedQuestion: z
      .string()
      .describe('Minimal cleanup of filler words while keeping original meaning and structure. Empty when no question.'),
    answer: z.union([z.literal('YES'), z.literal('NO'), z.null()]).describe('YES/NO for valid questions; null otherwise.'),
    ignoreReason: QuestionIgnoreReasonSchema.describe('Reason for skipping response when shouldRespond is false.')
  })
  .superRefine((value, ctx) => {
    if (value.shouldRespond) {
      if (!value.editedQuestion.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'editedQuestion is required when shouldRespond=true.'
        });
      }
      if (!value.answer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'answer is required when shouldRespond=true.'
        });
      }
    } else if (value.answer !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'answer must be null when shouldRespond=false.'
      });
    }
    if (value.shouldRespond && value.ignoreReason !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ignoreReason must be null when shouldRespond=true.'
      });
    }
    if (!value.shouldRespond && value.ignoreReason === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ignoreReason is required when shouldRespond=false.'
      });
    }
  });

export type QuestionDecision = z.infer<typeof QuestionDecisionSchema>;

function readJsonSchemaFromDisk(filename: string): Record<string, unknown> {
  const localDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(localDir, 'schemas', filename),
    path.resolve(process.cwd(), 'src', 'ai', 'schemas', filename),
    path.resolve(process.cwd(), 'apps', 'server', 'src', 'ai', 'schemas', filename)
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const raw = fs.readFileSync(candidate, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  throw new Error(
    `AI schema file not found (${filename}). Checked: ${candidates.join(', ')}`
  );
}

export const QUESTION_DECISION_JSON_SCHEMA = readJsonSchemaFromDisk('question_decision_v1.schema.json');
