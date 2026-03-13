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
import { useThemeStyles } from '../theme';

export default function PersonalInfoScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const { colors, isDark } = useThemeStyles();
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
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Avatar */}
      <View style={styles.avatarSection}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>{getInitials()}</Text>
        </View>
        <Text style={[styles.roleLabel, { color: colors.textSecondary }]}>{profile?.role || user?.role || 'Technician'}</Text>
      </View>

      {/* Form */}
      <View style={[styles.formSection, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Personal Details</Text>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>First Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.inputText }]}
            value={firstName}
            onChangeText={(v) => { setFirstName(v); setDirty(true); }}
            placeholder="First name"
            placeholderTextColor={colors.placeholder}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Last Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.inputText }]}
            value={lastName}
            onChangeText={(v) => { setLastName(v); setDirty(true); }}
            placeholder="Last name"
            placeholderTextColor={colors.placeholder}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
          <View style={[styles.readOnlyField, { backgroundColor: colors.backgroundSecondary }]}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
            <Text style={[styles.readOnlyText, { color: colors.textSecondary }]}>{profile?.email || user?.email || '—'}</Text>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Phone</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.inputText }]}
            value={phone}
            onChangeText={(v) => { setPhone(v); setDirty(true); }}
            placeholder="Phone number"
            placeholderTextColor={colors.placeholder}
            keyboardType="phone-pad"
          />
        </View>
      </View>

      {dirty && (
        <TouchableOpacity style={[styles.saveButton, { backgroundColor: colors.primary }]} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
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
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  avatarSection: { alignItems: 'center', paddingVertical: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  roleLabel: { marginTop: 8, fontSize: 14, fontWeight: '500' },
  formSection: {
    marginHorizontal: 16, borderRadius: 12, padding: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 16 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '500', marginBottom: 6 },
  input: {
    borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 15,
  },
  readOnlyField: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 8, padding: 12,
  },
  readOnlyText: { fontSize: 15 },
  saveButton: {
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 10, padding: 14, alignItems: 'center',
  },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
