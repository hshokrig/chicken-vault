import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HostControls } from '../components/host/HostControls';
import { makeState } from './fixtures';

function noopAsync(): Promise<void> {
  return Promise.resolve();
}

describe('HostControls preflight gate', () => {
  it('disables initialize and start actions before preflight', () => {
    const state = makeState();

    render(
      <HostControls
        state={state}
        onAddPlayer={noopAsync}
        onUpdatePlayer={noopAsync}
        onRemovePlayer={noopAsync}
        onReorderPlayers={noopAsync}
        onConfigChange={noopAsync}
        onInitializeWorkbook={noopAsync}
        onStartGame={noopAsync}
        onOpenPreflight={vi.fn()}
        onOpenSecretCard={vi.fn()}
        onPickInsider={noopAsync}
        onStartInvestigation={noopAsync}
        onResolveQuestion={noopAsync}
        onCallVault={noopAsync}
        onNextRound={noopAsync}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(screen.getByRole('button', { name: 'Initialize Workbook Now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start Game' })).toBeDisabled();
  });
});
