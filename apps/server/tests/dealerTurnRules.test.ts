import { describe, expect, it } from 'vitest';
import { computeSeatAfter } from '../src/game/gameEngine.js';

describe('dealer and turn conventions', () => {
  it('always starts investigation at the seat clockwise from dealer position', () => {
    expect(computeSeatAfter(0, 8)).toBe(1);
    expect(computeSeatAfter(7, 8)).toBe(0);
    expect(computeSeatAfter(3, 8)).toBe(4);
  });
});
