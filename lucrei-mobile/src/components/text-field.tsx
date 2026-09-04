import { Platform, Text, TextInput, type TextInputProps, type TextStyle, View } from 'react-native';

import { Colors } from '@/constants/theme';

type TextFieldProps = TextInputProps & {
  label: string;
};

const webOutlineStyle: TextStyle | undefined =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : undefined;

export function TextField({ label, style, ...inputProps }: TextFieldProps) {
  return (
    <View className="mb-4">
      <Text className="mb-1.5 text-sm text-lucrei-textMuted">{label}</Text>
      <TextInput
        placeholderTextColor={Colors.textMuted}
        className="rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-base text-lucrei-text"
        style={[webOutlineStyle, style]}
        {...inputProps}
      />
    </View>
  );
}
