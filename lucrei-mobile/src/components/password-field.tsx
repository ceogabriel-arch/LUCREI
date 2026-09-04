import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, Pressable, Text, TextInput, type TextStyle, View } from 'react-native';

import { useColors } from '@/lib/theme';

// No nativo, overflow-hidden evita o input vazar pra fora do cantos
// arredondados. Na web, essa mesma propriedade some com o blur de fundo
// (BlurView) e cria uma borda clara indesejada — por isso só entra no nativo.
const containerClassName = Platform.select({
  web: 'flex-row items-center rounded-xl border border-lucrei-border bg-lucrei-surface px-4',
  default: 'flex-row items-center overflow-hidden rounded-xl border border-lucrei-border bg-lucrei-surface px-4',
});

type PasswordFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  autoComplete?: 'password' | 'password-new';
  placeholder?: string;
};

export function PasswordField({ label, value, onChangeText, autoComplete, placeholder }: PasswordFieldProps) {
  const Colors = useColors();
  const [visible, setVisible] = useState(false);

  return (
    <View className="mb-4">
      <Text className="mb-1.5 text-sm text-lucrei-textMuted">{label}</Text>
      <View className={containerClassName}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoComplete={autoComplete}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          className="flex-1 border-0 bg-transparent py-3 text-base text-lucrei-text"
          style={Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : undefined}
        />
        <Pressable onPress={() => setVisible((v) => !v)} hitSlop={8}>
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}
