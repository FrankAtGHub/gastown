import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useThemeStyles } from '../theme';

const FAQ = [
  {
    q: 'How do I clock in/out for a work order?',
    a: 'Open the work order from your dashboard, then tap the "Time Entry" button. You can start/stop time tracking, add break time, and log travel time.',
  },
  {
    q: 'How do I submit photos for a job?',
    a: 'On the work order detail screen, tap "Photos". You can take before, during, and after photos. All photos are geo-tagged and timestamped automatically.',
  },
  {
    q: 'What happens when I lose signal?',
    a: 'The app works fully offline. Your time entries, photos, notes, and signatures are saved locally and sync automatically when you regain connectivity. Check Sync Status in your profile to see pending items.',
  },
  {
    q: 'How do I accept a parts transfer?',
    a: 'Go to the Transfers tab. Pending transfers show a notification badge. Tap the transfer to view details, then Accept or Reject. You can also partially accept if counts differ.',
  },
  {
    q: 'How do I update my availability?',
    a: 'Go to Settings from your profile. Your dispatcher manages your schedule, but you can set your status and update personal information from the Personal Information screen.',
  },
];

export default function HelpScreen({ navigation }: { navigation: any }) {
  const { colors, isDark } = useThemeStyles();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const buildId = Constants.expoConfig?.extra?.eas?.projectId?.slice(0, 8) || '—';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* FAQ */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Frequently Asked Questions</Text>
        {FAQ.map((item, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.faqItem, { backgroundColor: colors.card }]}
            onPress={() => setExpandedIdx(expandedIdx === i ? null : i)}
            activeOpacity={0.7}
          >
            <View style={styles.faqHeader}>
              <Text style={[styles.faqQuestion, { color: colors.text }]}>{item.q}</Text>
              <Ionicons
                name={expandedIdx === i ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textSecondary}
              />
            </View>
            {expandedIdx === i && (
              <Text style={[styles.faqAnswer, { color: colors.textSecondary }]}>{item.a}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Support Contact */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Need More Help?</Text>
        <View style={[styles.supportCard, { backgroundColor: colors.card }]}>
          <TouchableOpacity
            style={[styles.supportRow, { borderBottomColor: colors.border }]}
            onPress={() => Linking.openURL('mailto:support@numeruspro.com')}
          >
            <View style={[styles.supportIcon, { backgroundColor: isDark ? colors.primaryDark + '30' : colors.infoBg }]}>
              <Ionicons name="mail-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.supportText}>
              <Text style={[styles.supportLabel, { color: colors.text }]}>Email Support</Text>
              <Text style={[styles.supportValue, { color: colors.textSecondary }]}>support@numeruspro.com</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.supportRow, { borderBottomWidth: 0 }]}
            onPress={() => Linking.openURL('tel:+18005551234')}
          >
            <View style={[styles.supportIcon, { backgroundColor: isDark ? colors.primaryDark + '30' : colors.infoBg }]}>
              <Ionicons name="call-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.supportText}>
              <Text style={[styles.supportLabel, { color: colors.text }]}>Phone Support</Text>
              <Text style={[styles.supportValue, { color: colors.textSecondary }]}>Mon–Fri, 8am–6pm CT</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Device Info */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>App Information</Text>
        <View style={[styles.infoCard, { backgroundColor: colors.card }]}>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>App Version</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>v{appVersion}</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Build</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{buildId}</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Platform</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{Platform.OS} {Platform.Version}</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Expo SDK</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{Constants.expoConfig?.sdkVersion || '—'}</Text>
          </View>
        </View>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { marginTop: 16, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  faqItem: { borderRadius: 10, marginBottom: 8, paddingHorizontal: 16, paddingVertical: 14 },
  faqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  faqQuestion: { fontSize: 15, fontWeight: '500', flex: 1, marginRight: 8 },
  faqAnswer: { fontSize: 14, lineHeight: 20, marginTop: 10 },
  supportCard: { borderRadius: 12, overflow: 'hidden' },
  supportRow: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderBottomWidth: 1,
  },
  supportIcon: {
    width: 40, height: 40, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  supportText: { flex: 1 },
  supportLabel: { fontSize: 15, fontWeight: '500' },
  supportValue: { fontSize: 13, marginTop: 2 },
  infoCard: { borderRadius: 12, overflow: 'hidden' },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  infoLabel: { fontSize: 14 },
  infoValue: { fontSize: 14, fontWeight: '500' },
});
