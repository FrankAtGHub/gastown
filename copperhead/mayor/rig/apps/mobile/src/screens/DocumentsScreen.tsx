import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import apiService from '../services/api.service';
import { useThemeStyles } from '../theme';

interface Document {
  id: string;
  name: string;
  type: string;
  category: string;
  expiration_date?: string;
}

const CATEGORY_CONFIG: Record<string, { icon: string; title: string }> = {
  certification: { icon: 'ribbon-outline', title: 'Certifications' },
  license: { icon: 'card-outline', title: 'Licenses' },
  safety: { icon: 'shield-checkmark-outline', title: 'Safety Documents' },
};

function buildSections(docs: Document[]) {
  const groups: Record<string, Document[]> = {
    certification: [],
    license: [],
    safety: [],
  };
  for (const doc of docs) {
    const cat = doc.category?.toLowerCase() || 'safety';
    if (groups[cat]) {
      groups[cat].push(doc);
    } else {
      groups.safety.push(doc);
    }
  }
  return Object.entries(groups).map(([key, data]) => ({
    key,
    title: CATEGORY_CONFIG[key]?.title || key,
    icon: CATEGORY_CONFIG[key]?.icon || 'document-outline',
    data,
  }));
}

export default function DocumentsScreen({ navigation }: { navigation: any }) {
  const { colors, isDark } = useThemeStyles();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await apiService.get('/users/me');
      const user = res?.data?.user || res?.data;
      const docs = user?.documents || [];
      setDocuments(Array.isArray(docs) ? docs : []);
    } catch (err: any) {
      console.log('[Documents] fetch error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  const onRefresh = () => { setRefreshing(true); fetchDocuments(); };

  if (loading) {
    return (
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  const sections = buildSections(documents);
  const hasDocuments = documents.length > 0;

  if (!hasDocuments) {
    return (
      <SafeAreaView style={[styles.emptyContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.emptyIconWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No Documents Available</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Your certifications, licenses, and safety documents will appear here once uploaded by your administrator.
        </Text>

        <View style={[styles.categoryList, { backgroundColor: colors.card }]}>
          {sections.map(s => (
            <View key={s.key} style={[styles.categoryRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.categoryIcon, { backgroundColor: colors.backgroundSecondary }]}>
                <Ionicons name={s.icon as any} size={20} color={colors.textSecondary} />
              </View>
              <View style={styles.categoryText}>
                <Text style={[styles.categoryTitle, { color: colors.text }]}>{s.title}</Text>
                <Text style={[styles.categoryCount, { color: colors.textMuted }]}>{s.data.length} documents</Text>
              </View>
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
    <SectionList
      style={[styles.container, { backgroundColor: colors.background }]}
      sections={sections}
      keyExtractor={(item, index) => item.id || String(index)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      renderSectionHeader={({ section }) => (
        <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
          <Ionicons name={section.icon as any} size={16} color={colors.textSecondary} />
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={[styles.docRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Text style={[styles.docName, { color: colors.text }]}>{item.name}</Text>
          {item.expiration_date && (
            <Text style={[styles.docExpiry, { color: colors.textMuted }]}>Expires: {item.expiration_date}</Text>
          )}
        </View>
      )}
    />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 20 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  categoryList: { width: '100%', marginTop: 32, borderRadius: 12, overflow: 'hidden' },
  categoryRow: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderBottomWidth: 1,
  },
  categoryIcon: {
    width: 40, height: 40, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  categoryText: { flex: 1 },
  categoryTitle: { fontSize: 15, fontWeight: '500' },
  categoryCount: { fontSize: 13, marginTop: 2 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, paddingTop: 16,
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  docRow: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  docName: { fontSize: 15 },
  docExpiry: { fontSize: 12, marginTop: 4 },
});
