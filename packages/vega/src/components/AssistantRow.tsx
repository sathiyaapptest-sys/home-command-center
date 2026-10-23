import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {ActivityEntry, formatClock} from '@command-center/shared';
import {colors} from '../theme';
import {px} from '../scale';

/** One request: what was said (and its English), which tool ran, and the reply. */
export const AssistantRow = ({entry}: {entry: ActivityEntry}) => (
  <View testID={`activity-${entry.id}`} style={styles.row}>
    <Text style={styles.meta} numberOfLines={1}>
      {entry.source === 'alexa' ? 'Alexa+' : 'Voice assistant'} · {formatClock(entry.at)}
      {entry.tool ? ` · ${entry.tool}` : ''}
    </Text>
    {entry.input && (
      <Text style={styles.said} numberOfLines={2}>
        “{entry.input}”
      </Text>
    )}
    {entry.inputEnglish && (
      <Text style={styles.english} numberOfLines={1}>
        {entry.inputEnglish}
      </Text>
    )}
    <Text style={[styles.reply, entry.isError && styles.replyError]} numberOfLines={2}>
      {entry.reply}
    </Text>
    {entry.replyEnglish && (
      <Text style={styles.english} numberOfLines={1}>
        {entry.replyEnglish}
      </Text>
    )}
  </View>
);

const styles = StyleSheet.create({
  row: {
    marginBottom: px(10),
  },
  meta: {
    color: colors.muted,
    fontSize: px(15),
  },
  said: {
    color: colors.text,
    fontSize: px(20),
    fontWeight: '600',
    marginTop: px(2),
  },
  english: {
    color: colors.muted,
    fontSize: px(15),
  },
  reply: {
    color: colors.on,
    fontSize: px(19),
    marginTop: px(2),
  },
  replyError: {
    color: colors.warning,
  },
});
