import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import apiService from '../services/api.service';
import { useThemeStyles } from '../theme';

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

const TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  work: { icon: 'hammer-outline', label: 'Work' },
  travel: { icon: 'car-outline', label: 'Travel' },
  break: { icon: 'cafe-outline', label: 'Break' },
  overtime: { icon: 'time-outline', label: 'Overtime' },
};

// Type accent colors — consistent across themes (status/accent colors)
const TYPE_ACCENT: Record<string, string> = {
  work: '#2563eb',
  travel: '#7c3aed',
  break: '#d97706',
  overtime: '#dc2626',
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
  const { colors, isDark } = useThemeStyles();
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
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (entries.length === 0) {
    return (
      <SafeAreaView style={[styles.emptyContainer, { backgroundColor: colors.background }]}>
        <Ionicons name="time-outline" size={48} color={colors.textMuted} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No Time Entries</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>Your time entries will appear here after you clock in on a work order.</Text>
      </SafeAreaView>
    );
  }

  const sections = groupByDate(entries);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
    <SectionList
      style={[styles.container, { backgroundColor: colors.background }]}
      sections={sections}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      renderSectionHeader={({ section }) => (
        <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) => {
        const cfg = TYPE_CONFIG[item.entry_type?.toLowerCase()] || TYPE_CONFIG.work;
        const accent = TYPE_ACCENT[item.entry_type?.toLowerCase()] || TYPE_ACCENT.work;
        return (
          <View style={[styles.entryRow, { backgroundColor: colors.card }]}>
            <View style={[styles.typeIcon, { backgroundColor: accent + '15' }]}>
              <Ionicons name={cfg.icon as any} size={18} color={accent} />
            </View>
            <View style={styles.entryContent}>
              <Text style={[styles.entryType, { color: colors.text }]}>{cfg.label}</Text>
              <Text style={[styles.entryTime, { color: colors.textSecondary }]}>
                {formatTime(item.start_time)} – {formatTime(item.end_time)}
              </Text>
              {item.work_order_id && (
                <Text style={[styles.entryWO, { color: colors.textMuted }]}>WO: {item.work_order_id.slice(0, 8)}</Text>
              )}
            </View>
            <Text style={[styles.entryDuration, { color: colors.primary }]}>{formatDuration(item.duration_minutes)}</Text>
          </View>
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
  sectionHeader: { paddingHorizontal: 16, paddingVertical: 10, paddingTop: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  entryRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  typeIcon: {
    width: 36, height: 36, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  entryContent: { flex: 1 },
  entryType: { fontSize: 15, fontWeight: '500' },
  entryTime: { fontSize: 13, marginTop: 2 },
  entryWO: { fontSize: 12, marginTop: 2 },
  entryDuration: { fontSize: 15, fontWeight: '600' },
  separator: { height: 1 },
});
