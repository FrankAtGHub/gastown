import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import apiService from '../services/api.service';
import { useThemeStyles } from '../theme';

export default function MyVehicleScreen({ navigation }: { navigation: any }) {
  const { colors, isDark } = useThemeStyles();
  const [vehicle, setVehicle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [noVehicle, setNoVehicle] = useState(false);

  const fetchVehicle = useCallback(async () => {
    try {
      const res = await apiService.get('/users/me');
      const u = res?.data?.user || res?.data;
      if (u?.vehicle || u?.vehicle_number) {
        setVehicle({
          number: u.vehicle_number || u.vehicle?.number || '—',
          make: u.vehicle?.make || '—',
          model: u.vehicle?.model || '—',
          year: u.vehicle?.year || '—',
          licensePlate: u.vehicle?.license_plate || u.vehicle?.licensePlate || '—',
          vin: u.vehicle?.vin || '—',
          mileage: u.vehicle?.mileage || u.vehicle?.current_mileage || '—',
          color: u.vehicle?.color || '—',
        });
        setNoVehicle(false);
      } else {
        setNoVehicle(true);
      }
    } catch (err: any) {
      console.log('[MyVehicle] fetch error:', err.message);
      setNoVehicle(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchVehicle(); }, [fetchVehicle]);

  const onRefresh = () => { setRefreshing(true); fetchVehicle(); };

  if (loading) {
    return (
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (noVehicle) {
    return (
      <SafeAreaView style={[styles.emptyContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
          <Ionicons name="car-outline" size={48} color={colors.textMuted} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No Vehicle Assigned</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Contact your dispatcher to get a vehicle assigned to your profile.
        </Text>
      </SafeAreaView>
    );
  }

  const rows = [
    { label: 'Vehicle #', value: vehicle.number, icon: 'pricetag-outline' },
    { label: 'Make', value: vehicle.make, icon: 'car-outline' },
    { label: 'Model', value: vehicle.model, icon: 'car-sport-outline' },
    { label: 'Year', value: vehicle.year, icon: 'calendar-outline' },
    { label: 'License Plate', value: vehicle.licensePlate, icon: 'document-text-outline' },
    { label: 'VIN', value: vehicle.vin, icon: 'barcode-outline' },
    { label: 'Mileage', value: typeof vehicle.mileage === 'number' ? vehicle.mileage.toLocaleString() + ' mi' : vehicle.mileage, icon: 'speedometer-outline' },
    { label: 'Color', value: vehicle.color, icon: 'color-palette-outline' },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={[styles.cardHeader, { borderBottomColor: colors.border }]}>
          <View style={[styles.cardIcon, { backgroundColor: isDark ? colors.primaryDark + '30' : colors.infoBg }]}>
            <Ionicons name="car" size={24} color={colors.primary} />
          </View>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Assigned Vehicle</Text>
        </View>

        {rows.map((row, i) => (
          <View key={row.label} style={[styles.row, { borderBottomColor: colors.border }, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
            <View style={styles.rowLeft}>
              <Ionicons name={row.icon as any} size={18} color={colors.textSecondary} />
              <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{row.label}</Text>
            </View>
            <Text style={[styles.rowValue, { color: colors.text }]}>{row.value}</Text>
          </View>
        ))}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  card: { margin: 16, borderRadius: 12, overflow: 'hidden' },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderBottomWidth: 1,
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 14, fontWeight: '500', maxWidth: '50%', textAlign: 'right' },
});
