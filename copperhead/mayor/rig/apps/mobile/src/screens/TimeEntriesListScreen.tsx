import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import apiService from '../services/api.service';

interface TimeEntry {
  id: string;
  entry_type: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  work_order_id: string | null;
  notes: string | null;
}

interface Section {
  title: string;
  data: TimeEntry[];
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  work: { icon: 'hammer-outline', color: '#1e40af', label: 'Work' },
  travel: { icon: 'car-outline', color: '#7c3aed', label: 'Travel' },
  break: { icon: 'cafe-outline', color: '#d97706', label: 'Break' },
  overtime: { icon: 'time-outline', color: '#dc2626', label: 'Overtime' },
};

function formatDuration(minutes: number | null): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function groupByDate(entries: TimeEntry[]): Section[] {
  const groups: Record<string, TimeEntry[]> = {};
  for (const entry of entries) {
    const date = entry.start_time ? entry.start_time.split('T')[0] : 'Unknown';
    if (!groups[date]) groups[date] = [];
    groups[date].push(entry);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, data]) => ({
      title: new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
      data,
    }));
}

export default function TimeEntriesListScreen({ navigation }: { navigation: any }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await apiService.get('/time-entries');
      const data = res?.data?.time_entries || res?.data || [];
      setEntries(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.log('[TimeEntries] fetch error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const onRefresh = () => { setRefreshing(true); fetchEntries(); };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }

  if (entries.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="time-outline" size={48} color="#9ca3af" />
        <Text style={styles.emptyTitle}>No Time Entries</Text>
        <Text style={styles.emptySubtitle}>Your time entries will appear here after you clock in on a work order.</Text>
      </View>
    );
  }

  const sections = groupByDate(entries);

  return (
    <SectionList
      style={styles.container}
      sections={sections}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e40af" />}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) => {
        const config = TYPE_CONFIG[item.entry_type?.toLowerCase()] || TYPE_CONFIG.work;
        return (
          <View style={styles.entryRow}>
            <View style={[styles.typeIcon, { backgroundColor: config.color + '15' }]}>
              <Ionicons name={config.icon as any} size={18} color={config.color} />
            </View>
            <View style={styles.entryContent}>
              <Text style={styles.entryType}>{config.label}</Text>
              <Text style={styles.entryTime}>
                {formatTime(item.start_time)} – {formatTime(item.end_time)}
              </Text>
              {item.work_order_id && (
                <Text style={styles.entryWO}>WO: {item.work_order_id.slice(0, 8)}</Text>
              )}
            </View>
            <Text style={styles.entryDuration}>{formatDuration(item.duration_minutes)}</Text>
          </View>
        );
      }}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  sectionHeader: {
    backgroundColor: '#f3f4f6', paddingHorizontal: 16, paddingVertical: 10, paddingTop: 16,
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  entryRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff', paddingHorizontal: 16, paddingVertical: 14,
  },
  typeIcon: {
    width: 36, height: 36, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  entryContent: { flex: 1 },
  entryType: { fontSize: 15, fontWeight: '500', color: '#111827' },
  entryTime: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  entryWO: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  entryDuration: { fontSize: 15, fontWeight: '600', color: '#1e40af' },
  separator: { height: 1, backgroundColor: '#f3f4f6' },
});
