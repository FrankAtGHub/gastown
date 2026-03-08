import React from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const SECTIONS = [
  {
    title: 'Certifications',
    icon: 'ribbon-outline',
    data: [] as any[],
  },
  {
    title: 'Licenses',
    icon: 'card-outline',
    data: [] as any[],
  },
  {
    title: 'Safety Documents',
    icon: 'shield-checkmark-outline',
    data: [] as any[],
  },
];

export default function DocumentsScreen({ navigation }: { navigation: any }) {
  const hasDocuments = SECTIONS.some(s => s.data.length > 0);

  if (!hasDocuments) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconWrap}>
          <Ionicons name="document-text-outline" size={48} color="#9ca3af" />
        </View>
        <Text style={styles.emptyTitle}>No Documents Available</Text>
        <Text style={styles.emptySubtitle}>
          Your certifications, licenses, and safety documents will appear here once uploaded by your administrator.
        </Text>

        <View style={styles.categoryList}>
          {SECTIONS.map(s => (
            <View key={s.title} style={styles.categoryRow}>
              <View style={styles.categoryIcon}>
                <Ionicons name={s.icon as any} size={20} color="#6b7280" />
              </View>
              <View style={styles.categoryText}>
                <Text style={styles.categoryTitle}>{s.title}</Text>
                <Text style={styles.categoryCount}>0 documents</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <SectionList
      style={styles.container}
      sections={SECTIONS}
      keyExtractor={(item, index) => item.id || String(index)}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Ionicons name={section.icon as any} size={16} color="#6b7280" />
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={styles.docRow}>
          <Text style={styles.docName}>{item.name}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  emptyContainer: { flex: 1, backgroundColor: '#f3f4f6', alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#e5e7eb',
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginTop: 20 },
  emptySubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  categoryList: {
    width: '100%', marginTop: 32,
    backgroundColor: '#ffffff', borderRadius: 12, overflow: 'hidden',
  },
  categoryRow: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  categoryIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  categoryText: { flex: 1 },
  categoryTitle: { fontSize: 15, fontWeight: '500', color: '#374151' },
  categoryCount: { fontSize: 13, color: '#9ca3af', marginTop: 2 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f3f4f6', paddingHorizontal: 16, paddingVertical: 10, paddingTop: 16,
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  docRow: {
    backgroundColor: '#ffffff', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  docName: { fontSize: 15, color: '#111827' },
});
