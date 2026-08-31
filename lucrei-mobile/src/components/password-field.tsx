import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Colors } from '@/constants/theme';

type PasswordFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  autoComplete?: 'password' | 'password-new';
  placeholder?: string;
};

export function PasswordField({ label, value, onChangeText, autoComplete, placeholder }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <View className="mb-4">
      <Text className="mb-1.5 text-sm text-lucrei-textMuted">{label}</Text>
      <View className="flex-row items-center overflow-hidden rounded-xl border border-lucrei-border bg-lucrei-surface px-4">
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoComplete={autoComplete}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          className="flex-1 py-3 text-base text-lucrei-text"
        />
        <Pressable onPress={() => setVisible((v) => !v)} hitSlop={8}>
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}
