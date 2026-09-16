import { Platform, Text, TextInput, type TextInputProps, type TextStyle, View } from 'react-native';

import { useColors } from '@/lib/theme';

type TextFieldProps = TextInputProps & {
  label: string;
  // Só usado no login/cadastro numa janela larga de desktop - o padding
  // padrão é pensado pra toque no celular, fica exagerado com mouse.
  compact?: boolean;
};

const webOutlineStyle: TextStyle | undefined =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : undefined;

export function TextField({ label, style, compact, ...inputProps }: TextFieldProps) {
  const Colors = useColors();
  return (
    <View className="mb-4">
      <Text className="mb-1.5 text-sm text-lucrei-textMuted">{label}</Text>
      <TextInput
        placeholderTextColor={Colors.textMuted}
        className={`rounded-xl border border-lucrei-border bg-lucrei-surface px-4 text-lucrei-text ${compact ? 'py-2 text-sm' : 'py-3 text-base'}`}
        style={[webOutlineStyle, style]}
        importantForAutofill="no"
        {...inputProps}
      />
    </View>
  );
}
