import { Platform, Text, TextInput, type TextInputProps, type TextStyle, View } from 'react-native';

import { useColors } from '@/lib/theme';

type TextFieldProps = TextInputProps & {
  label: string;
};

const webOutlineStyle: TextStyle | undefined =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : undefined;

export function TextField({ label, style, ...inputProps }: TextFieldProps) {
  const Colors = useColors();
  return (
    <View className="mb-4">
      <Text className="mb-1.5 text-sm text-lucrei-textMuted">{label}</Text>
      <TextInput
        placeholderTextColor={Colors.textMuted}
        className="rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-base text-lucrei-text"
        style={[webOutlineStyle, style]}
        importantForAutofill="no"
        {...inputProps}
      />
    </View>
  );
}
