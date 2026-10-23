import 'react-native';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import * as React from 'react';
import type {ActivityEntry, Alert, CommandCenterApi, Device} from '@command-center/shared';

import {App} from '../src/App';

function makeDevice(id: string, name: string, state: Partial<Device['state']> = {}): Device {
  return {
    id,
    name,
    vendor: 'Test',
    type: 'smart_plug',
    controlledVia: 'alexa',
    ratedWattage: 100,
    state: {power: 'off', responsive: true, wattage: 0, lastChangedAt: 0, turnedOnAt: null, ...state},
    health: {hoursOfOperation: 1.5, cumulativeEnergyWh: 150, lastAlertAt: null},
    custom: false,
  };
}

function makeApi(devices: Device[], alerts: Alert[] = [], activity: ActivityEntry[] = []): CommandCenterApi {
  return {
    getDevices: jest.fn().mockResolvedValue(devices),
    getAlerts: jest.fn().mockResolvedValue(alerts),
    getNotes: jest.fn().mockResolvedValue([]),
    createNote: jest.fn().mockResolvedValue({}),
    setPower: jest.fn().mockResolvedValue(devices[0]),
    runFor: jest.fn().mockResolvedValue({}),
    advanceClock: jest.fn().mockResolvedValue({now: 0, newAlerts: []}),
    resetDemo: jest.fn().mockResolvedValue({now: 0}),
    getHealth: jest.fn().mockResolvedValue({ok: true, simNow: Date.UTC(2026, 9, 3, 9, 5)}),
    getActivity: jest.fn().mockResolvedValue(activity),
    logActivity: jest.fn().mockResolvedValue({}),
  };
}

describe('App', () => {
  it('shows every device and a healthy summary when there are no alerts', async () => {
    const api = makeApi([makeDevice('a', 'Plug A'), makeDevice('b', 'Plug B', {power: 'on', wattage: 100})]);
    const screen = render(<App api={api} />);

    expect(await screen.findByTestId('device-a')).toBeTruthy();
    expect(screen.getByTestId('device-b')).toBeTruthy();
    expect(screen.getByTestId('no-alerts')).toBeTruthy();
    expect(screen.getByTestId('summary').props.children.join('')).toContain('2 devices');
  });

  it('surfaces a fault: shows the alert explanation and disables the timed run', async () => {
    const faulty = makeDevice('pump-plug', 'Pump Plug', {power: 'on', responsive: false});
    const alert: Alert = {
      id: 'al1',
      deviceId: 'pump-plug',
      pattern: 'drop_after_duration',
      severity: 'critical',
      message: 'went unresponsive',
      explanation: 'Stopped drawing power 10 minutes after being turned on.',
      createdAt: 0,
    };
    const screen = render(<App api={makeApi([faulty], [alert])} />);

    expect(await screen.findByTestId('alert-al1')).toBeTruthy();
    expect(screen.getByText('Stopped drawing power 10 minutes after being turned on.')).toBeTruthy();
    expect(screen.getByTestId('action-run').props.accessibilityState?.disabled ?? screen.getByTestId('action-run').props.disabled).toBeTruthy();
  });

  it('toggles power when a device is pressed', async () => {
    const api = makeApi([makeDevice('a', 'Plug A')]);
    const screen = render(<App api={api} />);

    fireEvent.press(await screen.findByTestId('device-a'));

    await waitFor(() => expect(api.setPower).toHaveBeenCalledWith('a', 'on'));
  });

  it('starts a timed run for the selected device', async () => {
    const api = makeApi([makeDevice('a', 'Plug A')]);
    const screen = render(<App api={api} />);

    await screen.findByTestId('device-a');
    fireEvent.press(screen.getByTestId('action-run'));

    await waitFor(() => expect(api.runFor).toHaveBeenCalledWith('a', 10));
  });

  it('resets the demo from the header button', async () => {
    const api = makeApi([makeDevice('a', 'Plug A')]);
    const screen = render(<App api={api} />);

    await screen.findByTestId('device-a');
    fireEvent.press(screen.getByTestId('reset-demo'));

    await waitFor(() => expect(api.resetDemo).toHaveBeenCalled());
  });

  it('shows the simulated time so a fast-forward is visible', async () => {
    const screen = render(<App api={makeApi([makeDevice('a', 'Plug A')])} />);
    await screen.findByTestId('device-a');
    await waitFor(() => expect(screen.getByTestId('summary').props.children.join('')).toContain('simulated time'));
  });

  it('shows a Tamil assistant request with its English, the tool used, and the reply', async () => {
    const entry: ActivityEntry = {
      id: 'x1',
      at: Date.UTC(2026, 9, 3, 9, 5),
      source: 'assistant',
      language: 'ta',
      input: 'பம்ப் பிளக் பழுதடைந்ததா?',
      inputEnglish: 'Is the pump plug faulty?',
      tool: 'get_device_status',
      toolInput: {device: 'pump plug'},
      reply: 'பம்ப் பிளக் பழுதடைந்துள்ளது.',
      replyEnglish: 'Pump Plug is faulty.',
      isError: false,
    };
    const screen = render(<App api={makeApi([makeDevice('a', 'Plug A')], [], [entry])} />);

    expect(await screen.findByTestId('activity-x1')).toBeTruthy();
    expect(screen.getByText('Is the pump plug faulty?')).toBeTruthy();
    expect(screen.getByText('பம்ப் பிளக் பழுதடைந்துள்ளது.')).toBeTruthy();
  });

  it('invites the user to try the assistant when nothing has been asked yet', async () => {
    const screen = render(<App api={makeApi([makeDevice('a', 'Plug A')])} />);
    expect(await screen.findByTestId('no-activity')).toBeTruthy();
  });

  it('labels real hardware as LIVE and everything else as SIMULATED', async () => {
    const motor: Device = {
      ...makeDevice('node-motor1', 'Water motor', {power: 'on'}),
      source: 'live',
      live: {running: true, vibration: 0.4, online: true, lastReportAt: 0},
    };
    const screen = render(<App api={makeApi([motor, makeDevice('a', 'Plug A')])} />);
    expect((await screen.findByTestId('source-node-motor1')).props.children).toBe('LIVE');
    expect(screen.getByTestId('source-a').props.children).toBe('SIMULATED');
  });

  it('tells the user when the backend is unreachable', async () => {
    const api = makeApi([]);
    (api.getDevices as jest.Mock).mockRejectedValue(new Error('network down'));
    const screen = render(<App api={api} />);

    expect(await screen.findByTestId('error')).toBeTruthy();
  });
});
