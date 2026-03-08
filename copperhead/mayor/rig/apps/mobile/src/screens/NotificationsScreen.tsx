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
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1e40af" />
      </SafeAreaView>
    );
  }

  if (notifications.length === 0) {
    return (
      <SafeAreaView style={styles.emptyContainer}>
        <Ionicons name="notifications-off-outline" size={48} color="#9ca3af" />
        <Text style={styles.emptyTitle}>No Notifications</Text>
        <Text style={styles.emptySubtitle}>You're all caught up. New notifications will appear here.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
    <FlatList
      style={styles.container}
      data={notifications}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e40af" />}
      renderItem={({ item }) => {
        const icon = TYPE_ICON[item.type] || TYPE_ICON.system;
        return (
          <TouchableOpacity
            style={[styles.notifRow, !item.read && styles.unreadRow]}
            onPress={() => !item.read && markAsRead(item.id)}
            activeOpacity={item.read ? 1 : 0.7}
          >
            {!item.read && <View style={styles.unreadDot} />}
            <View style={styles.notifIcon}>
              <Ionicons name={icon as any} size={20} color={item.read ? '#9ca3af' : '#1e40af'} />
            </View>
            <View style={styles.notifContent}>
              <Text style={[styles.notifTitle, !item.read && styles.unreadText]}>
                {item.title}
              </Text>
              <Text style={styles.notifMessage} numberOfLines={2}>{item.message}</Text>
              <Text style={styles.notifTime}>{timeAgo(item.created_at)}</Text>
            </View>
          </TouchableOpacity>
        );
      }}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  notifRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#ffffff', paddingHorizontal: 16, paddingVertical: 14,
  },
  unreadRow: { backgroundColor: '#eff6ff' },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#1e40af', marginTop: 6, marginRight: 8,
  },
  notifIcon: { marginRight: 12, marginTop: 2 },
  notifContent: { flex: 1 },
  notifTitle: { fontSize: 15, fontWeight: '500', color: '#374151' },
  unreadText: { fontWeight: '600', color: '#111827' },
  notifMessage: { fontSize: 13, color: '#6b7280', marginTop: 2, lineHeight: 18 },
  notifTime: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  separator: { height: 1, backgroundColor: '#f3f4f6' },
});
