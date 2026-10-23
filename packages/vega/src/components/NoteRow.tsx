import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Note} from '@command-center/shared';
import {colors} from '../theme';
import {px} from '../scale';

export const NoteRow = ({note}: {note: Note}) => (
  <View testID={`note-${note.id}`} style={styles.row}>
    <Text style={styles.text} numberOfLines={2}>
      {note.summary ?? note.textEnglish}
    </Text>
    {note.languageInput === 'ta' && (
      <Text style={styles.original} numberOfLines={1}>
        {note.textOriginal}
      </Text>
    )}
  </View>
);

const styles = StyleSheet.create({
  row: {
    marginBottom: px(8),
  },
  text: {
    color: colors.text,
    fontSize: px(20),
  },
  original: {
    color: colors.muted,
    fontSize: px(16),
    marginTop: px(2),
  },
});
