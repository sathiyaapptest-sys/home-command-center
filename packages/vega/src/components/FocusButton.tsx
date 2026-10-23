import React, {useState} from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {colors} from '../theme';
import {px} from '../scale';

export interface FocusButtonProps {
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
}

export const FocusButton = ({label, onPress, testID, disabled, hasTVPreferredFocus}: FocusButtonProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.button, focused && styles.focused, disabled && styles.disabled]}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: px(24),
    paddingVertical: px(12),
    borderRadius: px(12),
    backgroundColor: colors.panelRaised,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  focused: {
    borderColor: colors.focus,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    color: colors.text,
    fontSize: px(24),
    fontWeight: '600',
  },
});
