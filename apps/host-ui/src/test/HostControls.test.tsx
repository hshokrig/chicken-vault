import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiQuestionOutcome } from '@chicken-vault/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostControls } from '../components/host/HostControls';
import { makeState } from './fixtures';

function noopAsync(): Promise<void> {
  return Promise.resolve();
}

const noopAnalyze = async (): Promise<AiQuestionOutcome> => ({
  status: 'RETRY',
  transcript: '',
  editedQuestion: null,
  answer: null,
  reason: 'NO_VALID_QUESTION',
  latencyMs: 0
});

describe('HostControls lobby actions', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps initialize/demo/start actions enabled in lobby', () => {
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
        onResetGame={noopAsync}
        onRunDemo={noopAsync}
        onOpenPreflight={vi.fn()}
        onStartInvestigation={noopAsync}
        onAnalyzeQuestionAudio={noopAnalyze}
        onAnalyzeQuestionText={async () => noopAnalyze()}
        onCallVault={noopAsync}
        onNextRound={noopAsync}
        onStartRealGame={noopAsync}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(screen.getByRole('button', { name: 'Initialize Workbook Now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Run Demo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Start Real Game' })).toBeEnabled();
  });

  it('initializes workbook immediately after saving config when players exist', async () => {
    const state = makeState();
    const onConfigChange = vi.fn(async () => {});
    const onInitializeWorkbook = vi.fn(async () => {});

    render(
      <HostControls
        state={state}
        onAddPlayer={noopAsync}
        onUpdatePlayer={noopAsync}
        onRemovePlayer={noopAsync}
        onReorderPlayers={noopAsync}
        onConfigChange={onConfigChange}
        onInitializeWorkbook={onInitializeWorkbook}
        onStartGame={noopAsync}
        onResetGame={noopAsync}
        onRunDemo={noopAsync}
        onOpenPreflight={vi.fn()}
        onStartInvestigation={noopAsync}
        onAnalyzeQuestionAudio={noopAnalyze}
        onAnalyzeQuestionText={async () => noopAnalyze()}
        onCallVault={noopAsync}
        onNextRound={noopAsync}
        onStartRealGame={noopAsync}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Config' }));

    await waitFor(() => {
      expect(onConfigChange).toHaveBeenCalledTimes(1);
      expect(onInitializeWorkbook).toHaveBeenCalledTimes(1);
    });
  });
});
