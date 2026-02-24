import { SubmissionLevel, Suit } from '@chicken-vault/shared';

const BOLD_CARD_RE = /^(A|[2-9]|10|T|J|Q|K)([SHDC])$/;
const RANK_RE = /^(A|[2-9]|10|T|J|Q|K)$/;
const SUIT_RE = /^[SHDC]$/;
const SAFE_RE = /^(RED|BLACK)$/;

export interface ParsedCard {
  rank: string;
  suit: Suit;
}

function normalizeRankToken(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  if (!RANK_RE.test(value)) {
    return null;
  }
  return value === '10' ? 'T' : value;
}

export function parseCardCode(raw: string): ParsedCard | null {
  const value = raw.trim().toUpperCase();
  const match = value.match(BOLD_CARD_RE);
  if (!match) {
    return null;
  }
  const rank = normalizeRankToken(match[1]);
  if (!rank) {
    return null;
  }
  return { rank, suit: match[2] as Suit };
}

export function getColorFromSuit(suit: Suit): 'RED' | 'BLACK' {
  return suit === 'H' || suit === 'D' ? 'RED' : 'BLACK';
}

export function composeBoldGuess(params: { rank: string; suit: string }): string | null {
  const rank = normalizeRankToken(params.rank);
  const suit = params.suit.trim().toUpperCase();
  if (!rank || !SUIT_RE.test(suit)) {
    return null;
  }
  return `${rank}${suit}`;
}

export function rankToWorkbookValue(rank: string): string {
  return rank === 'T' ? '10' : rank;
}

export function validateGuess(level: SubmissionLevel, guess: string): boolean {
  const value = guess.trim().toUpperCase();
  if (!value) {
    return false;
  }

  if (level === 'SAFE') {
    return SAFE_RE.test(value);
  }
  if (level === 'MEDIUM') {
    return SUIT_RE.test(value);
  }
  return Boolean(parseCardCode(value));
}

export function normalizeGuess(guess: string): string {
  return guess.trim().toUpperCase();
}

export function calculateGuessPoints(params: {
  level: SubmissionLevel;
  guess: string;
  secretCard: string;
  vaultValue: number;
}): number {
  const { level, guess, secretCard, vaultValue } = params;
  const normalizedGuess = normalizeGuess(guess);
  const parsed = parseCardCode(secretCard);
  if (!parsed) {
    throw new Error(`Invalid secret card: ${secretCard}`);
  }

  if (level === 'SAFE') {
    return normalizedGuess === getColorFromSuit(parsed.suit) ? Math.floor(vaultValue / 4) : 0;
  }

  if (level === 'MEDIUM') {
    return normalizedGuess === parsed.suit ? Math.floor(vaultValue / 2) : -1;
  }

  const parsedGuess = parseCardCode(normalizedGuess);
  if (!parsedGuess) {
    return -3;
  }
  return parsedGuess.rank === parsed.rank && parsedGuess.suit === parsed.suit ? vaultValue : -3;
}

export function isSubmissionLevel(raw: string): raw is SubmissionLevel {
  return raw === 'SAFE' || raw === 'MEDIUM' || raw === 'BOLD';
}
