import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Alert, formatClock} from '@command-center/shared';
import {colors} from '../theme';
import {px} from '../scale';

export const AlertRow = ({alert, deviceLabel}: {alert: Alert; deviceLabel: string}) => (
  <View
    testID={`alert-${alert.id}`}
    style={[styles.row, {borderLeftColor: alert.severity === 'critical' ? colors.fault : colors.warning}]}>
    <Text style={styles.title} numberOfLines={1}>
      {deviceLabel} <Text style={styles.time}>{formatClock(alert.createdAt)}</Text>
    </Text>
    <Text style={styles.explanation} numberOfLines={3}>
      {alert.explanation}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  row: {
    borderLeftWidth: px(6),
    paddingLeft: px(12),
    paddingVertical: px(6),
    marginBottom: px(8),
  },
  title: {
    color: colors.text,
    fontSize: px(22),
    fontWeight: '700',
  },
  time: {
    color: colors.muted,
    fontSize: px(16),
    fontWeight: '400',
  },
  explanation: {
    color: colors.muted,
    fontSize: px(18),
    marginTop: px(2),
  },
});
