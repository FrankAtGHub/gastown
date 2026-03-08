import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import apiService from '../services/api.service';

export default function PersonalInfoScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dirty, setDirty] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await apiService.get('/users/me');
      const u = res?.data?.user || res?.data;
      if (u) {
        setProfile(u);
        setFirstName(u.firstName || u.first_name || '');
        setLastName(u.lastName || u.last_name || '');
        setPhone(u.phone || '');
      }
    } catch (err: any) {
      console.log('[PersonalInfo] fetch error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const onRefresh = () => { setRefreshing(true); fetchProfile(); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiService.patch('/users/me', { firstName, lastName, phone });
      if (res?.success) {
        setDirty(false);
        Alert.alert('Saved', 'Your profile has been updated.');
      } else {
        Alert.alert('Error', res?.message || 'Failed to save profile.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const getInitials = () => {
    if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
    return (user?.name || 'U').slice(0, 2).toUpperCase();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1e40af" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e40af" />}
    >
      {/* Avatar */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials()}</Text>
        </View>
        <Text style={styles.roleLabel}>{profile?.role || user?.role || 'Technician'}</Text>
      </View>

      {/* Form */}
      <View style={styles.formSection}>
        <Text style={styles.sectionTitle}>Personal Details</Text>

        <View style={styles.field}>
          <Text style={styles.label}>First Name</Text>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={(v) => { setFirstName(v); setDirty(true); }}
            placeholder="First name"
            placeholderTextColor="#9ca3af"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Last Name</Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={(v) => { setLastName(v); setDirty(true); }}
            placeholder="Last name"
            placeholderTextColor="#9ca3af"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <View style={styles.readOnlyField}>
            <Ionicons name="lock-closed-outline" size={16} color="#9ca3af" />
            <Text style={styles.readOnlyText}>{profile?.email || user?.email || '—'}</Text>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(v) => { setPhone(v); setDirty(true); }}
            placeholder="Phone number"
            placeholderTextColor="#9ca3af"
            keyboardType="phone-pad"
          />
        </View>
      </View>

      {dirty && (
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },
  avatarSection: { alignItems: 'center', paddingVertical: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#1e40af', justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: 'bold', color: '#ffffff' },
  roleLabel: { marginTop: 8, fontSize: 14, color: '#6b7280', fontWeight: '500' },
  formSection: {
    backgroundColor: '#ffffff', marginHorizontal: 16, borderRadius: 12, padding: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 16 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '500', color: '#6b7280', marginBottom: 6 },
  input: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 8, padding: 12, fontSize: 15, color: '#111827',
  },
  readOnlyField: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f3f4f6', borderRadius: 8, padding: 12,
  },
  readOnlyText: { fontSize: 15, color: '#6b7280' },
  saveButton: {
    backgroundColor: '#1e40af', marginHorizontal: 16, marginTop: 16,
    borderRadius: 10, padding: 14, alignItems: 'center',
  },
  saveButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
