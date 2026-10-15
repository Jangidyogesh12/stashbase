import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { IDLE_ALLOWANCE } from '@/test/fakes/settings';

import { AllowanceRow } from './allowance-row';

afterEach(cleanup);

describe('AllowanceRow', () => {
  it('says the window has not started when the server reports no end date', () => {
    render(<AllowanceRow allowance={IDLE_ALLOWANCE} />);

    expect(screen.getByText('100% available · Refills 7 days after first use')).not.toBeNull();
  });

  it('clamps a nonsensical percentage into the bar it can actually draw', () => {
    render(<AllowanceRow allowance={{ ...IDLE_ALLOWANCE, remainingPercent: 148.6 }} />);

    expect(screen.getByText(/^100% available/u)).not.toBeNull();
  });

  it('shows small pending reservations without rounding them to zero', () => {
    render(
      <AllowanceRow
        allowance={{ ...IDLE_ALLOWANCE, remainingPercent: 15, reservedPercent: 0.25 }}
      />,
    );
    expect(screen.getByText(/15% available · <1% temporarily reserved/u)).not.toBeNull();
  });

  it('names the refill moment once the window has one', () => {
    render(
      <AllowanceRow allowance={{ ...IDLE_ALLOWANCE, windowEndsAt: '2026-09-08T00:00:00.000Z' }} />,
    );

    expect(screen.getByText(/Refills /u)).not.toBeNull();
  });
});
