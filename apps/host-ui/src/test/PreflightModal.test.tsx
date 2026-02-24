import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreflightModal } from '../components/overlays/PreflightModal';

describe('PreflightModal', () => {
  it('keeps confirm disabled until both checks are true', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(<PreflightModal open onClose={() => {}} onConfirm={onConfirm} />);

    const confirm = screen.getByRole('button', { name: 'Confirm Preflight' });
    expect(confirm).toBeDisabled();

    const checks = screen.getAllByRole('checkbox');
    fireEvent.click(checks[0]);
    expect(confirm).toBeDisabled();

    fireEvent.click(checks[1]);
    expect(confirm).toBeEnabled();
  });
});
