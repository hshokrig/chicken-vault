import { getColorFromSuit, parseCardCode } from '../utils/cards.js';
import { DECISION_DEVELOPER_NOTE, TRANSCRIPTION_PROMPT } from './prompts.js';
import { QuestionDecision, QuestionDecisionSchema, QUESTION_DECISION_JSON_SCHEMA } from './questionSchema.js';

const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-transcribe';
const DEFAULT_QUESTION_MODEL = 'gpt-5-nano';

interface AnalyzeClientConfig {
  apiKey: string;
  transcribeModel?: string;
  questionModel?: string;
  transcriptionLanguage?: string;
}

export interface QuestionDecisionResult extends QuestionDecision {
  modelRefused?: boolean;
}

interface TranscriptionResponse {
  text?: string;
  error?: {
    message?: string;
  };
}

interface ChatCompletionMessage {
  content?: string | Array<{ type?: string; text?: string }>;
  refusal?: string | null;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChatCompletionMessage;
  }>;
  error?: {
    message?: string;
  };
}

interface CardFacts {
  code: string;
  rank: string;
  rankValue: number;
  suit: string;
  color: 'RED' | 'BLACK';
  isFaceCard: boolean;
  isAce: boolean;
}

type IgnoreReason = Exclude<QuestionDecision['ignoreReason'], null>;
const IGNORE_REASONS: IgnoreReason[] = ['NO_QUESTION', 'CHATTER', 'NOT_CARD_RELATED', 'UNCLEAR'];

function unwrapModelField(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  if ('value' in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).value;
  }
  return value;
}

function normalizeDecisionPayload(parsedJson: unknown, transcript: string): QuestionDecision {
  const source = parsedJson && typeof parsedJson === 'object' ? (parsedJson as Record<string, unknown>) : {};

  const shouldRespondRaw = unwrapModelField(source.shouldRespond);
  const shouldRespond = typeof shouldRespondRaw === 'boolean' ? shouldRespondRaw : false;

  const editedRaw = unwrapModelField(source.editedQuestion);
  const editedQuestion = typeof editedRaw === 'string' ? editedRaw.trim() : '';

  const answerRaw = unwrapModelField(source.answer);
  const answer: QuestionDecision['answer'] =
    answerRaw === 'YES' || answerRaw === 'NO' ? answerRaw : null;

  const ignoreReasonRaw = unwrapModelField(source.ignoreReason);
  const ignoreReason =
    typeof ignoreReasonRaw === 'string' && IGNORE_REASONS.includes(ignoreReasonRaw as IgnoreReason)
      ? (ignoreReasonRaw as IgnoreReason)
      : null;

  if (shouldRespond && answer) {
    return {
      shouldRespond: true,
      editedQuestion: editedQuestion || transcript.trim(),
      answer,
      ignoreReason: null
    };
  }

  return {
    shouldRespond: false,
    editedQuestion: '',
    answer: null,
    ignoreReason: ignoreReason ?? 'UNCLEAR'
  };
}

function extensionForAudioMimeType(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('webm')) {
    return 'webm';
  }
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac')) {
    return 'm4a';
  }
  if (lower.includes('wav') || lower.includes('wave')) {
    return 'wav';
  }
  if (lower.includes('ogg')) {
    return 'ogg';
  }
  if (lower.includes('mpeg') || lower.includes('mp3')) {
    return 'mp3';
  }
  if (lower.includes('aiff') || lower.includes('x-aiff')) {
    return 'aiff';
  }
  return 'webm';
}

function ensureApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('OPENAI_API_KEY is required for AI question analysis.');
  }
  return trimmed;
}

async function parseOpenAiResponse<T extends { error?: { message?: string } }>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: T;
  try {
    payload = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    throw new Error(`OpenAI API returned non-JSON response (status ${response.status}).`);
  }

  if (!response.ok) {
    const message = payload.error?.message ?? `OpenAI API request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

function extractContent(message: ChatCompletionMessage | undefined): string {
  if (!message) {
    return '';
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return '';
  }
  return message.content
    .map((chunk) => (typeof chunk?.text === 'string' ? chunk.text : ''))
    .join('')
    .trim();
}

function buildCardFacts(secretCard: string): CardFacts {
  const parsed = parseCardCode(secretCard);
  if (!parsed) {
    throw new Error('Invalid secret card while running AI analysis.');
  }

  const rankOrder: Record<string, number> = {
    A: 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    T: 10,
    J: 11,
    Q: 12,
    K: 13
  };
  const rankValue = rankOrder[parsed.rank];

  return {
    code: `${parsed.rank}${parsed.suit}`,
    rank: parsed.rank,
    rankValue,
    suit: parsed.suit,
    color: getColorFromSuit(parsed.suit),
    isFaceCard: parsed.rank === 'J' || parsed.rank === 'Q' || parsed.rank === 'K',
    isAce: parsed.rank === 'A'
  };
}

async function requestStructuredCompletion(params: {
  apiKey: string;
  model: string;
  developerNote: string;
  userContent: string;
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<{ content: string; refusal: string | null }> {
  const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: params.model,
      reasoning_effort: 'minimal',
      max_completion_tokens: 800,
      messages: [
        {
          role: 'developer',
          content: params.developerNote
        },
        {
          role: 'user',
          content: params.userContent
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: params.schemaName,
          strict: true,
          schema: params.schema
        }
      }
    })
  });

  const payload = await parseOpenAiResponse<ChatCompletionResponse>(response);
  const message = payload.choices?.[0]?.message;
  const refusal = typeof message?.refusal === 'string' ? message.refusal.trim() : '';

  return {
    content: extractContent(message),
    refusal: refusal || null
  };
}

export async function transcribeQuestionAudio(params: {
  audioBuffer: Buffer;
  mimeType: string;
  config: AnalyzeClientConfig;
}): Promise<string> {
  const { audioBuffer, mimeType, config } = params;
  const apiKey = ensureApiKey(config.apiKey);

  if (audioBuffer.length === 0) {
    return '';
  }

  const form = new FormData();
  form.append('model', config.transcribeModel?.trim() || DEFAULT_TRANSCRIBE_MODEL);
  form.append('prompt', TRANSCRIPTION_PROMPT);
  if (config.transcriptionLanguage?.trim()) {
    form.append('language', config.transcriptionLanguage.trim());
  }
  const normalizedMimeType = mimeType?.trim() || 'audio/webm';
  const filename = `question-audio.${extensionForAudioMimeType(normalizedMimeType)}`;
  const audioBytes = new Uint8Array(audioBuffer);
  form.append('file', new Blob([audioBytes], { type: normalizedMimeType }), filename);

  const response = await fetch(`${OPENAI_API_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  const payload = await parseOpenAiResponse<TranscriptionResponse>(response);
  return String(payload.text ?? '').trim();
}

export async function decideQuestionFromTranscript(params: {
  transcript: string;
  secretCard: string;
  config: AnalyzeClientConfig;
}): Promise<QuestionDecisionResult> {
  const { transcript, secretCard, config } = params;
  const apiKey = ensureApiKey(config.apiKey);
  const cardFacts = buildCardFacts(secretCard);
  const model = config.questionModel?.trim() || DEFAULT_QUESTION_MODEL;
  const userContent = [
    'Hidden card facts:',
    JSON.stringify(cardFacts),
    `Transcript: "${transcript}"`
  ].join('\n');

  const decision = await requestStructuredCompletion({
    apiKey,
    model,
    developerNote: DECISION_DEVELOPER_NOTE,
    userContent,
    schemaName: 'question_decision_v1',
    schema: QUESTION_DECISION_JSON_SCHEMA
  });

  if (decision.refusal) {
    return {
      shouldRespond: false,
      editedQuestion: '',
      answer: null,
      ignoreReason: 'UNCLEAR',
      modelRefused: true
    };
  }

  if (!decision.content) {
    return {
      shouldRespond: false,
      editedQuestion: '',
      answer: null,
      ignoreReason: 'UNCLEAR'
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decision.content) as unknown;
  } catch {
    throw new Error('Question decision model returned invalid JSON.');
  }

  const strictParsed = QuestionDecisionSchema.safeParse(parsedJson);
  if (strictParsed.success) {
    return {
      ...strictParsed.data,
      editedQuestion: strictParsed.data.editedQuestion.trim()
    };
  }

  return normalizeDecisionPayload(parsedJson, transcript);
}

export function resolveAiConfigFromEnv(): AnalyzeClientConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL,
    questionModel: process.env.OPENAI_QUESTION_MODEL || DEFAULT_QUESTION_MODEL,
    transcriptionLanguage: process.env.OPENAI_TRANSCRIBE_LANGUAGE
  };
}
