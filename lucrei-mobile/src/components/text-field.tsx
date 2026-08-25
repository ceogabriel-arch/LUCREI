import { Text, TextInput, type TextInputProps, View } from 'react-native';

import { Colors } from '@/constants/theme';

type TextFieldProps = TextInputProps & {
  label: string;
};

export function TextField({ label, ...inputProps }: TextFieldProps) {
  return (
    <View className="mb-4">
      <Text className="mb-1.5 text-sm text-lucrei-textMuted">{label}</Text>
      <TextInput
        placeholderTextColor={Colors.textMuted}
        className="rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-base text-lucrei-text"
        {...inputProps}
      />
    </View>
  );
}
