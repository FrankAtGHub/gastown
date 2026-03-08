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
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1e40af" />
      </SafeAreaView>
    );
  }

  const sections = buildSections(documents);
  const hasDocuments = documents.length > 0;

  if (!hasDocuments) {
    return (
      <SafeAreaView style={styles.emptyContainer}>
        <View style={styles.emptyIconWrap}>
          <Ionicons name="document-text-outline" size={48} color="#9ca3af" />
        </View>
        <Text style={styles.emptyTitle}>No Documents Available</Text>
        <Text style={styles.emptySubtitle}>
          Your certifications, licenses, and safety documents will appear here once uploaded by your administrator.
        </Text>

        <View style={styles.categoryList}>
          {sections.map(s => (
            <View key={s.key} style={styles.categoryRow}>
              <View style={styles.categoryIcon}>
                <Ionicons name={s.icon as any} size={20} color="#6b7280" />
              </View>
              <View style={styles.categoryText}>
                <Text style={styles.categoryTitle}>{s.title}</Text>
                <Text style={styles.categoryCount}>{s.data.length} documents</Text>
              </View>
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
    <SectionList
      style={styles.container}
      sections={sections}
      keyExtractor={(item, index) => item.id || String(index)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e40af" />}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Ionicons name={section.icon as any} size={16} color="#6b7280" />
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={styles.docRow}>
          <Text style={styles.docName}>{item.name}</Text>
          {item.expiration_date && (
            <Text style={styles.docExpiry}>Expires: {item.expiration_date}</Text>
          )}
        </View>
      )}
    />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },
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
  docExpiry: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
});
