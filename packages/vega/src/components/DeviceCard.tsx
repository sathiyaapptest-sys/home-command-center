import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
  Device,
  deviceStatus,
  formatEnergy,
  formatHours,
  formatSchedule,
  formatWatts,
} from '@command-center/shared';
import {colors, statusColor, statusLabel} from '../theme';
import {px} from '../scale';

export interface DeviceCardProps {
  device: Device;
  selected: boolean;
  onFocus: () => void;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
}

const Metric = ({label, value}: {label: string; value: string}) => (
  <View style={styles.metric}>
    <Text style={styles.metricValue} numberOfLines={1}>
      {value}
    </Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>
);

export const DeviceCard = ({device, selected, onFocus, onPress, hasTVPreferredFocus}: DeviceCardProps) => {
  const [focused, setFocused] = useState(false);
  const status = deviceStatus(device);

  return (
    <Pressable
      testID={`device-${device.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${device.name}, ${statusLabel[status]}`}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.card,
        selected && styles.selected,
        status === 'fault' && styles.faultCard,
        focused && styles.focused,
      ]}>
      <View style={styles.headerRow}>
        <Text style={styles.name} numberOfLines={1}>
          {device.name}
        </Text>
        <View style={[styles.pill, {backgroundColor: statusColor[status]}]}>
          <Text style={styles.pillText}>{statusLabel[status]}</Text>
        </View>
      </View>
      <View style={styles.vendorRow}>
        <Text style={styles.vendor} numberOfLines={1}>
          {device.custom && device.source !== 'live' ? `${device.vendor} (custom)` : device.vendor}
        </Text>
        <Text testID={`source-${device.id}`} style={[styles.source, device.source === 'live' ? styles.live : styles.simulated]}>
          {device.source === 'live' ? (device.live?.online === false ? 'LIVE · OFFLINE' : 'LIVE') : 'SIMULATED'}
        </Text>
      </View>

      <View style={styles.metrics}>
        <Metric label="Power" value={formatWatts(device.state.wattage)} />
        <Metric label="Run time" value={formatHours(device.health.hoursOfOperation)} />
        <Metric label="Energy" value={formatEnergy(device.health.cumulativeEnergyWh)} />
      </View>

      <Text style={styles.schedule} numberOfLines={1}>
        Schedule: {formatSchedule(device)}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    flexBasis: '31%',
    flexGrow: 0,
    padding: px(16),
    borderRadius: px(14),
    backgroundColor: colors.panel,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  selected: {
    backgroundColor: colors.panelRaised,
  },
  faultCard: {
    borderColor: colors.fault,
  },
  focused: {
    borderColor: colors.focus,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    flex: 1,
    color: colors.text,
    fontSize: px(24),
    fontWeight: '700',
    marginRight: px(8),
  },
  pill: {
    borderRadius: px(8),
    paddingHorizontal: px(10),
    paddingVertical: px(3),
  },
  pillText: {
    color: '#0B1220',
    fontSize: px(16),
    fontWeight: '800',
  },
  vendorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: px(2),
  },
  vendor: {
    flex: 1,
    color: colors.muted,
    fontSize: px(18),
  },
  source: {
    fontSize: px(13),
    fontWeight: '700',
    marginLeft: px(8),
  },
  live: {
    color: colors.focus,
  },
  simulated: {
    color: colors.off,
  },
  metrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: px(12),
  },
  metric: {
    alignItems: 'flex-start',
  },
  metricValue: {
    color: colors.text,
    fontSize: px(22),
    fontWeight: '600',
  },
  metricLabel: {
    color: colors.muted,
    fontSize: px(15),
  },
  schedule: {
    color: colors.muted,
    fontSize: px(16),
    marginTop: px(10),
  },
});
