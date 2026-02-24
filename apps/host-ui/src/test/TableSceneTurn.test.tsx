import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TableScene } from '../components/table/TableScene';
import { makeState } from './fixtures';

describe('TableScene turn highlighting', () => {
  it('shows turn badge for seat matching currentTurnSeatIndex', () => {
    const state = makeState();
    state.phase = 'INVESTIGATION';
    state.round.currentTurnSeatIndex = 1;

    render(<TableScene state={state} />);

    expect(screen.getAllByText('Your Turn')).toHaveLength(1);
    expect(screen.getByText('Bo')).toBeInTheDocument();
  });
});
