import { describe, expect, it } from 'vitest';
import { computeDealerSeatIndex, computeSeatAfter } from '../src/game/gameEngine.js';

describe('dealer and turn conventions', () => {
  it('uses seat0 as round 1 dealer by default', () => {
    expect(computeDealerSeatIndex(0, 1, 8)).toBe(0);
  });

  it('rotates dealer clockwise by round', () => {
    expect(computeDealerSeatIndex(0, 1, 5)).toBe(0);
    expect(computeDealerSeatIndex(0, 2, 5)).toBe(1);
    expect(computeDealerSeatIndex(0, 3, 5)).toBe(2);
    expect(computeDealerSeatIndex(0, 6, 5)).toBe(0);
  });

  it('always starts investigation at seat after dealer', () => {
    expect(computeSeatAfter(0, 8)).toBe(1);
    expect(computeSeatAfter(7, 8)).toBe(0);
    expect(computeSeatAfter(3, 8)).toBe(4);
  });
});
