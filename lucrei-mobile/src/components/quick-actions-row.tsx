import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useColors } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

export type QuickAction = {
  key: string;
  label: string;
  icon: IconName;
  onPress: () => void;
  // Um atalho em destaque (anel dourado, ícone dourado) - igual o
  // "Movimentar" do Revolut fica mais aceso que os vizinhos.
  highlighted?: boolean;
  loading?: boolean;
};

// Fileira de atalhos redondos estilo Revolut (Depositar/Pix/Movimentar/Mais)
// - pedido explicitamente pelo usuário, com print de referência. No Lucrei
// viram atalho pras telas/ações mais usadas direto da Início, mesmo já
// dando pra chegar nelas pela barra de baixo (igual o próprio Revolut
// repete "Pix" no Home mesmo já tendo a aba "Pagar").
export function QuickActionsRow({ actions }: { actions: QuickAction[] }) {
  const Colors = useColors();

  return (
    <View className="mt-6 flex-row justify-between">
      {actions.map((action) => (
        <Pressable
          key={action.key}
          onPress={action.onPress}
          disabled={action.loading}
          className="items-center gap-2"
          style={{ opacity: action.loading ? 0.6 : 1 }}>
          <View
            className="h-14 w-14 items-center justify-center rounded-full"
            style={{
              // Fundo meio transparente nos dois casos (em vez de um cinza
              // sólido pros não-destacados) - pedido pelo usuário pra dar
              // uma cara mais "vidro" em vez de caixa opaca.
              backgroundColor: action.highlighted ? `${Colors.gold}26` : `${Colors.surfaceAlt}99`,
              borderWidth: action.highlighted ? 1.5 : 0,
              borderColor: Colors.gold,
              // Brilho (glow) só no destacado, pra chamar atenção de
              // verdade - igual o anel aceso do "Movimentar" no Revolut.
              ...(action.highlighted
                ? {
                    shadowColor: Colors.gold,
                    shadowOpacity: 0.9,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 8,
                  }
                : null),
            }}>
            {action.loading ? (
              <ActivityIndicator size="small" color={Colors.gold} />
            ) : (
              <Ionicons name={action.icon} size={22} color={action.highlighted ? Colors.gold : Colors.text} />
            )}
          </View>
          <Text className="text-xs font-medium text-lucrei-text">{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
