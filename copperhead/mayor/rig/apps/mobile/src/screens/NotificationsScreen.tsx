import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import apiService from '../services/api.service';
import { useThemeStyles } from '../theme';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
}

const TYPE_ICON: Record<string, string> = {
  work_order: 'clipboard-outline',
  transfer: 'cube-outline',
  schedule: 'calendar-outline',
  system: 'information-circle-outline',
  alert: 'warning-outline',
};

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch { return '—'; }
}

export default function NotificationsScreen({ navigation }: { navigation: any }) {
  const { colors, isDark } = useThemeStyles();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiService.get('/notifications');
      const data = res?.data?.notifications || res?.data || [];
      setNotifications(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.log('[Notifications] fetch error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const onRefresh = () => { setRefreshing(true); fetchNotifications(); };

  const markAsRead = async (id: string) => {
    try {
      await apiService.patch(`/notifications/${id}/read`);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, read: true } : n)
      );
    } catch (err: any) {
      console.log('[Notifications] mark read error:', err.message);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (notifications.length === 0) {
    return (
      <SafeAreaView style={[styles.emptyContainer, { backgroundColor: colors.background }]}>
        <Ionicons name="notifications-off-outline" size={48} color={colors.textMuted} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No Notifications</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>You're all caught up. New notifications will appear here.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
    <FlatList
      style={[styles.container, { backgroundColor: colors.background }]}
      data={notifications}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      renderItem={({ item }) => {
        const icon = TYPE_ICON[item.type] || TYPE_ICON.system;
        const unreadBg = isDark ? colors.primaryDark + '30' : colors.infoBg;
        return (
          <TouchableOpacity
            style={[styles.notifRow, { backgroundColor: item.read ? colors.card : unreadBg }]}
            onPress={() => !item.read && markAsRead(item.id)}
            activeOpacity={item.read ? 1 : 0.7}
          >
            {!item.read && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
            <View style={styles.notifIcon}>
              <Ionicons name={icon as any} size={20} color={item.read ? colors.textMuted : colors.primary} />
            </View>
            <View style={styles.notifContent}>
              <Text style={[styles.notifTitle, { color: colors.text }, !item.read && { fontWeight: '600' }]}>
                {item.title}
              </Text>
              <Text style={[styles.notifMessage, { color: colors.textSecondary }]} numberOfLines={2}>{item.message}</Text>
              <Text style={[styles.notifTime, { color: colors.textMuted }]}>{timeAgo(item.created_at)}</Text>
            </View>
          </TouchableOpacity>
        );
      }}
      ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
    />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  notifRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    marginTop: 6, marginRight: 8,
  },
  notifIcon: { marginRight: 12, marginTop: 2 },
  notifContent: { flex: 1 },
  notifTitle: { fontSize: 15, fontWeight: '500' },
  notifMessage: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  notifTime: { fontSize: 12, marginTop: 4 },
  separator: { height: 1 },
});
