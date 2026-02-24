import { SubmissionLevel, Suit } from '@chicken-vault/shared';

const BOLD_CARD_RE = /^([A2-9TJQK])([SHDC])$/;
const SUIT_RE = /^[SHDC]$/;
const SAFE_RE = /^(RED|BLACK)$/;

export interface ParsedCard {
  rank: string;
  suit: Suit;
}

export function parseCardCode(raw: string): ParsedCard | null {
  const value = raw.trim().toUpperCase();
  const match = value.match(BOLD_CARD_RE);
  if (!match) {
    return null;
  }
  return { rank: match[1], suit: match[2] as Suit };
}

export function getColorFromSuit(suit: Suit): 'RED' | 'BLACK' {
  return suit === 'H' || suit === 'D' ? 'RED' : 'BLACK';
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
  return BOLD_CARD_RE.test(value);
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

  return normalizedGuess === `${parsed.rank}${parsed.suit}` ? vaultValue : -3;
}

export function isSubmissionLevel(raw: string): raw is SubmissionLevel {
  return raw === 'SAFE' || raw === 'MEDIUM' || raw === 'BOLD';
}
