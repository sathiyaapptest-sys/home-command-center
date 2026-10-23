import React, {useCallback, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {
  CommandCenterApi,
  createApi,
  deviceName,
  deviceStatus,
  formatClock,
  summarizeFleet,
  useCommandCenter,
} from '@command-center/shared';
import {API_BASE_URL} from './config.local';
import {AlertRow} from './components/AlertRow';
import {AssistantRow} from './components/AssistantRow';
import {DeviceCard} from './components/DeviceCard';
import {FocusButton} from './components/FocusButton';
import {NoteRow} from './components/NoteRow';
import {colors} from './theme';
import {px, scale, windowHeight, windowWidth} from './scale';

const RUN_MINUTES = 10;
const DEMO_FAST_FORWARD_MINUTES = 11;

export const App = ({api}: {api?: CommandCenterApi}) => {
  const client = useMemo(() => api ?? createApi(API_BASE_URL), [api]);
  const {devices, alerts, notes, activity, simNow, error, loaded, refresh} = useCommandCenter(client);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selected = devices.find((d) => d.id === selectedId) ?? devices[0];
  const summary = summarizeFleet(devices);

  const act = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        setActionError(null);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
      await refresh();
    },
    [refresh],
  );

  const toggle = (id: string) => {
    const device = devices.find((d) => d.id === id);
    if (!device) return;
    return act(() => client.setPower(id, device.state.power === 'on' ? 'off' : 'on'));
  };

  const problem = error ?? actionError;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Home Command Center</Text>
          <Text style={styles.summary} testID="summary">
            {summary.total} devices · {summary.on} on · {summary.off} off ·{' '}
            <Text style={summary.faults > 0 ? styles.summaryFault : undefined}>{summary.faults} faults</Text>
            {simNow !== null ? ` · simulated time ${formatClock(simNow)}` : ''}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <FocusButton
            testID="fast-forward"
            label={`Demo: skip ${DEMO_FAST_FORWARD_MINUTES} min`}
            onPress={() => act(() => client.advanceClock(DEMO_FAST_FORWARD_MINUTES))}
          />
          <FocusButton testID="reset-demo" label="Reset demo" onPress={() => act(() => client.resetDemo())} />
        </View>
      </View>

      {problem && (
        <Text style={styles.error} testID="error">
          Can't reach the Command Center: {problem}
        </Text>
      )}

      <View style={styles.body}>
        <View style={styles.devicesColumn}>
          <Text style={styles.sectionTitle}>Devices</Text>
          {!loaded && !error ? (
            <Text style={styles.muted}>Loading…</Text>
          ) : (
            <TVFocusGuideView style={styles.grid}>
              {devices.map((device, index) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  selected={selected?.id === device.id}
                  hasTVPreferredFocus={index === 0}
                  onFocus={() => setSelectedId(device.id)}
                  onPress={() => toggle(device.id)}
                />
              ))}
            </TVFocusGuideView>
          )}

          {selected && (
            <View style={styles.actions}>
              <Text style={styles.actionsLabel} numberOfLines={1}>
                {selected.name}
              </Text>
              <FocusButton
                testID="action-toggle"
                label={selected.state.power === 'on' ? 'Turn off' : 'Turn on'}
                onPress={() => toggle(selected.id)}
              />
              <FocusButton
                testID="action-run"
                label={`Run ${RUN_MINUTES} min`}
                disabled={deviceStatus(selected) === 'fault'}
                onPress={() => act(() => client.runFor(selected.id, RUN_MINUTES))}
              />
            </View>
          )}
        </View>

        <View style={styles.sideColumn}>
          <View style={[styles.panel, styles.assistantPanel]}>
            <Text style={styles.sectionTitle}>Assistant</Text>
            {activity.length === 0 ? (
              <Text style={styles.muted} testID="no-activity">
                Ask the assistant in Tamil or English and it shows up here.
              </Text>
            ) : (
              activity.slice(0, 2).map((entry) => <AssistantRow key={entry.id} entry={entry} />)
            )}
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Alerts</Text>
            {alerts.length === 0 ? (
              <Text style={styles.muted} testID="no-alerts">
                All devices healthy
              </Text>
            ) : (
              <ScrollView>
                {alerts.slice(0, 3).map((alert) => (
                  <AlertRow key={alert.id} alert={alert} deviceLabel={deviceName(devices, alert)} />
                ))}
              </ScrollView>
            )}
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Notes</Text>
            {notes.length === 0 ? (
              <Text style={styles.muted}>No notes yet</Text>
            ) : (
              notes.slice(0, 2).map((note) => <NoteRow key={note.id} note={note} />)
            )}
          </View>
        </View>
      </View>
      <Text style={styles.debug} testID="display-info">
        display {Math.round(windowWidth)}x{Math.round(windowHeight)} · scale {scale.toFixed(2)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: px(56),
    paddingVertical: px(28),
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: px(14),
  },
  headerActions: {
    flexDirection: 'row',
    gap: px(14),
  },
  title: {
    color: colors.text,
    fontSize: px(44),
    fontWeight: '700',
  },
  summary: {
    color: colors.muted,
    fontSize: px(22),
    marginTop: px(2),
  },
  summaryFault: {
    color: colors.fault,
    fontWeight: '700',
  },
  error: {
    color: colors.warning,
    fontSize: px(20),
    marginBottom: px(8),
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    gap: px(28),
  },
  devicesColumn: {
    flex: 3,
  },
  sideColumn: {
    flex: 2,
    gap: px(16),
  },
  panel: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: px(14),
    padding: px(16),
    overflow: 'hidden',
  },
  assistantPanel: {
    flex: 1.4,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: px(28),
    fontWeight: '700',
    marginBottom: px(10),
  },
  muted: {
    color: colors.muted,
    fontSize: px(20),
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: px(14),
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: px(14),
    marginTop: px(16),
  },
  actionsLabel: {
    color: colors.muted,
    fontSize: px(22),
    flexShrink: 1,
  },
  debug: {
    color: colors.muted,
    fontSize: px(14),
    marginTop: px(6),
  },
});
