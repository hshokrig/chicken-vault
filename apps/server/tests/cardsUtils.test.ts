import { describe, expect, it } from 'vitest';
import { composeBoldGuess, parseCardCode, validateGuess } from '../src/utils/cards.js';

describe('cards utils', () => {
  it('accepts 10-form rank inputs and normalizes to T internally', () => {
    expect(parseCardCode('10d')).toEqual({ rank: 'T', suit: 'D' });
    expect(validateGuess('BOLD', '10S')).toBe(true);
  });

  it('builds bold guesses from rank + suit columns', () => {
    expect(composeBoldGuess({ rank: 'A', suit: 'S' })).toBe('AS');
    expect(composeBoldGuess({ rank: '10', suit: 'd' })).toBe('TD');
    expect(composeBoldGuess({ rank: '11', suit: 'S' })).toBeNull();
    expect(composeBoldGuess({ rank: 'Q', suit: '' })).toBeNull();
  });
});
