import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { type Announcement, getAnnouncements } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAppTheme } from '@/lib/theme';

// Carrossel de avisos (atualizações, eventos, blog) no topo da Início -
// cadastrado pelo fundador em /admin (ver AnnouncementForm lá), sem precisar
// de deploy pra cada novo aviso.
export function AnnouncementsBanner() {
  const { state } = useAuth();
  const { colors: Colors } = useAppTheme();
  const token = state.status === 'authenticated' ? state.token : null;
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!token) return;
    getAnnouncements(token)
      .then(setAnnouncements)
      .catch(() => setAnnouncements([]));
  }, [token]);

  function handleLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  function handleScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!width) return;
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  if (announcements.length === 0) return null;

  return (
    <View className="mt-4" onLayout={handleLayout}>
      {width > 0 && (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScrollEnd}>
          {announcements.map((a) => (
            <View key={a.id} style={{ width }}>
              <GlassCard
                className="mr-0"
                onPress={a.linkUrl ? () => Linking.openURL(a.linkUrl!) : undefined}
                style={{ minHeight: 96 }}>
                <View className="flex-row items-center gap-3 p-4">
                  {a.imageUrl && (
                    <Image source={{ uri: a.imageUrl }} style={{ width: 56, height: 56, borderRadius: 12 }} contentFit="cover" />
                  )}
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-lucrei-text">{a.title}</Text>
                    <Text className="mt-1 text-xs text-lucrei-textMuted" numberOfLines={2}>
                      {a.body}
                    </Text>
                  </View>
                </View>
              </GlassCard>
            </View>
          ))}
        </ScrollView>
      )}

      {announcements.length > 1 && (
        <View className="mt-2 flex-row justify-center gap-1.5">
          {announcements.map((a, i) => (
            <View
              key={a.id}
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: i === page ? Colors.gold : Colors.surfaceAlt }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
