import { afterEach, expect, it, vi } from 'vite-plus/test';

import { httpClient } from '@/test/fakes/http';

import { createUsageRecorder, listenForDesktopActivity } from './telemetry';

afterEach(() => vi.useRealTimers());

function input(name: string, trusted = true) {
  const event = new Event(name);
  Object.defineProperty(event, 'isTrusted', { value: trusted });
  return event;
}

it('counts real foreground input across days without a heartbeat or collecting input data', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const record = vi.fn();
  const dispose = listenForDesktopActivity(record, 'documents');
  vi.advanceTimersByTime(86400_000);
  expect(record).not.toHaveBeenCalled();
  window.dispatchEvent(input('keydown', false));
  expect(record).not.toHaveBeenCalled();
  window.dispatchEvent(input('keydown'));
  window.dispatchEvent(input('wheel'));
  expect(record).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(86400_000);
  window.dispatchEvent(input('pointerdown'));
  expect(record).toHaveBeenCalledTimes(2);
  expect(record).toHaveBeenLastCalledWith({ event: 'app_active', mode: 'documents' });
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  vi.advanceTimersByTime(60_000);
  window.dispatchEvent(input('keydown'));
  expect(record).toHaveBeenCalledTimes(2);
  dispose();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  window.dispatchEvent(input('keydown'));
  expect(record).toHaveBeenCalledTimes(2);
});

it('coalesces editing bursts before HTTP and never accepts host-only account or billing facts', async () => {
  vi.useFakeTimers();
  const client = httpClient({ status: 'accepted' });
  const request = vi.spyOn(client, 'request');
  const record = createUsageRecorder(client);
  for (let index = 0; index < 50; index++)
    record({ event: 'document_engaged', activity: 'edit', format: 'md' });
  record({ event: 'account_login_result', outcome: 'success' });
  record({ event: 'subscription_observed', plan: 'pro', paid: true, cancel_at_period_end: false });
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0].body).toMatchObject({
    event: { event: 'document_engaged', activity: 'edit', format: 'md' },
  });
  vi.advanceTimersByTime(60_000);
  record({ event: 'document_engaged', activity: 'edit', format: 'md' });
  expect(request).toHaveBeenCalledTimes(2);
});

it('an immediate terminal outcome waits for its own start without delaying other turns', async () => {
  const client = httpClient({ status: 'accepted' });
  let release!: () => void;
  const request = vi.spyOn(client, 'request').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ body: { status: 'accepted' }, status: 200 });
      }),
  );
  const record = createUsageRecorder(client);
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  record({ event: 'agent_turn_started', runtime: 'codex', turn_id: first });
  record({
    event: 'agent_turn_finished',
    runtime: 'codex',
    turn_id: first,
    outcome: 'blocked',
    duration: 'under_10s',
  });
  record({ event: 'agent_turn_started', runtime: 'claude', turn_id: second });
  expect(request).toHaveBeenCalledTimes(2);
  release();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(request.mock.calls[2]?.[0].body).toMatchObject({
    event: { event: 'agent_turn_finished', turn_id: first },
  });
});

it('retries transport and admission failures with the original ID and occurrence time', async () => {
  vi.useFakeTimers();
  const client = httpClient({ status: 'accepted' });
  const request = vi
    .spyOn(client, 'request')
    .mockRejectedValueOnce(new Error('receipt lost'))
    .mockResolvedValueOnce({ status: 503, body: { status: 'retry' } });
  const record = createUsageRecorder(client);
  record({ event: 'app_opened' });
  const original = structuredClone(request.mock.calls[0]?.[0].body);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.runAllTimersAsync();
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls.map(([message]) => message.body)).toEqual([
    original,
    original,
    original,
  ]);
});

it('stops after a definitive receipt or refusal and bounds attempts without a valid receipt', async () => {
  vi.useFakeTimers();
  for (const status of ['accepted', 'duplicate', 'disabled', 'discarded']) {
    const client = httpClient({ status });
    createUsageRecorder(client)({ event: 'app_opened' });
    await vi.runAllTimersAsync();
    expect(client.request).toHaveBeenCalledTimes(1);
  }
  for (const status of [400, 403]) {
    const client = httpClient(null, status);
    createUsageRecorder(client)({ event: 'app_opened' });
    await vi.runAllTimersAsync();
    expect(client.request).toHaveBeenCalledTimes(1);
  }
  for (const status of [200, 503]) {
    const client = httpClient(null, status);
    createUsageRecorder(client)({ event: 'app_opened' });
    await vi.runAllTimersAsync();
    expect(client.request).toHaveBeenCalledTimes(3);
  }
});

it('checkpoints generated, coalesced and exhausted reports without counting retries as new activity', async () => {
  vi.useFakeTimers();
  const client = httpClient(null, 503);
  const request = vi.spyOn(client, 'request');
  const record = createUsageRecorder(client);
  record({ event: 'document_engaged', activity: 'edit', format: 'md' });
  record({ event: 'document_engaged', activity: 'edit', format: 'md' });
  const first = structuredClone(request.mock.calls[0]?.[0].body);
  await vi.runAllTimersAsync();
  expect(request.mock.calls.map(([value]) => value.body)).toEqual([first, first, first]);
  request.mockResolvedValue({ status: 200, body: { status: 'accepted' } });
  record({ event: 'agent_turn_started', runtime: 'codex' });
  expect(request.mock.calls.at(-1)?.[0].body).toMatchObject({
    delivery: { counters: { generated: 3, coalesced: 1, exhausted: 1, requests: 4 } },
  });
  await vi.runAllTimersAsync();
});

it('starts a fresh checkpoint when host admission retires the previous collection period', async () => {
  const client = httpClient({ status: 'accepted', reset_delivery: true });
  const request = vi.spyOn(client, 'request');
  const record = createUsageRecorder(client);
  record({ event: 'document_engaged', activity: 'read', format: 'html' });
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  request.mockResolvedValue({ status: 200, body: { status: 'accepted' } });
  record({ event: 'document_engaged', activity: 'read', format: 'html' });
  const snapshots = request.mock.calls.map(
    ([value]) => (value.body as { delivery: { series_id: string; counters: unknown } }).delivery,
  );
  expect(snapshots[1]?.series_id).not.toBe(snapshots[0]?.series_id);
  expect(snapshots[1]?.counters).toEqual({ generated: 1, requests: 1 });
});

it('holds only its own terminal behind start retries and bounds concurrent reports', async () => {
  vi.useFakeTimers();
  const client = httpClient({ status: 'accepted' });
  const request = vi.spyOn(client, 'request').mockRejectedValueOnce(new Error('offline'));
  const record = createUsageRecorder(client);
  const turn_id = crypto.randomUUID();
  record({ event: 'agent_turn_started', runtime: 'codex', turn_id });
  record({ event: 'agent_turn_finished', runtime: 'codex', turn_id, outcome: 'success' });
  record({ event: 'app_opened' });
  await vi.runAllTimersAsync();
  expect(
    request.mock.calls.map(
      ([message]) => (message.body as { event: { event: string } }).event.event,
    ),
  ).toEqual(['agent_turn_started', 'app_opened', 'agent_turn_started', 'agent_turn_finished']);
  request.mockClear();
  request.mockImplementation(() => new Promise(() => {}));
  for (let index = 0; index < 200; index++) record({ event: 'app_opened' });
  expect(request).toHaveBeenCalledTimes(100);
});
