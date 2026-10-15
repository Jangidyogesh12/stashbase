import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { ambient } from '@/lib/springs';

import { useRotatingPrompt } from './use-rotating-prompt';

const PROMPTS = ['Build a wiki for docs', "What's in docs?", 'Write a blog post about docs'];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useRotatingPrompt', () => {
  it('starts on the first prompt and advances at the ambient cadence, wrapping around', () => {
    const { result } = renderHook(() => useRotatingPrompt(PROMPTS, false));
    expect(result.current).toBe(PROMPTS[0]);

    act(() => vi.advanceTimersByTime(ambient.promptCycleMs));
    expect(result.current).toBe(PROMPTS[1]);
    act(() => vi.advanceTimersByTime(ambient.promptCycleMs * 2));
    expect(result.current).toBe(PROMPTS[0]);
  });

  it('holds still while paused and resumes from where it stopped', () => {
    let paused = false;
    const { rerender, result } = renderHook(() => useRotatingPrompt(PROMPTS, paused));
    act(() => vi.advanceTimersByTime(ambient.promptCycleMs));
    expect(result.current).toBe(PROMPTS[1]);

    paused = true;
    rerender();
    act(() => vi.advanceTimersByTime(ambient.promptCycleMs * 3));
    expect(result.current).toBe(PROMPTS[1]);

    paused = false;
    rerender();
    act(() => vi.advanceTimersByTime(ambient.promptCycleMs));
    expect(result.current).toBe(PROMPTS[2]);
  });

  it('shows nothing for no prompts and never cycles a single one', () => {
    expect(renderHook(() => useRotatingPrompt([], false)).result.current).toBeNull();
    const single = renderHook(() => useRotatingPrompt(['Only'], false));
    act(() => vi.advanceTimersByTime(ambient.promptCycleMs * 2));
    expect(single.result.current).toBe('Only');
  });
});
