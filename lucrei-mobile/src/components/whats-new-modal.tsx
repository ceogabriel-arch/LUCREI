import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { CHANGELOG, type ChangelogEntry } from '@/lib/changelog';
import { getLastSeenChangelogVersion, setLastSeenChangelogVersion } from '@/lib/changelog-storage';
import { useColors } from '@/lib/theme';

// Montado uma vez pra quem está logado (ver _layout.tsx) - compara a versão
// mais recente do CHANGELOG com a última vista salva no aparelho e mostra só
// as entradas novas, uma vez, na primeira abertura depois de cada update.
export function WhatsNewModal() {
  const Colors = useColors();
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);

  useEffect(() => {
    getLastSeenChangelogVersion().then((lastSeen) => {
      const unseen = CHANGELOG.filter((entry) => !lastSeen || entry.version > lastSeen);
      if (unseen.length > 0) setEntries(unseen);
    });
  }, []);

  function handleClose() {
    setEntries(null);
    setLastSeenChangelogVersion(CHANGELOG[0].version).catch(() => {});
  }

  return (
    <Modal visible={entries != null} transparent animationType="fade" onRequestClose={handleClose}>
      <View className="flex-1 items-center justify-center bg-black/70 px-6">
        {entries && (
          <View
            className="w-full max-w-sm rounded-2xl border border-lucrei-border p-5"
            style={{ backgroundColor: Colors.surface }}>
            <Text className="text-base font-semibold text-lucrei-text">Novidades no Lucrei</Text>

            {entries.map((entry) => (
              <View key={entry.version} className="mt-4">
                {entry.items.map((item, i) => (
                  <View key={i} className="mt-2 flex-row gap-2">
                    <Text className="text-sm text-lucrei-gold">•</Text>
                    <Text className="flex-1 text-sm leading-5 text-lucrei-textMuted">{item}</Text>
                  </View>
                ))}
              </View>
            ))}

            <Pressable
              onPress={handleClose}
              className="mt-5 items-center rounded-xl py-2.5"
              style={{ backgroundColor: Colors.gold }}>
              <Text className="text-sm font-medium" style={{ color: Colors.onGold }}>
                Entendi
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}
