import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '../theme';

export default function ProfileScreen({ user, onLogout, navigation }) {
  const { colors, isDark } = useThemeStyles();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Menu items with implemented flag
  const menuItems = [
    { icon: 'cube-outline', label: 'My Truck Inventory', screen: 'TruckInventory', implemented: true },
    { icon: 'settings-outline', label: 'Settings', screen: 'Settings', implemented: true },
    { icon: 'sync-outline', label: 'Sync Status', screen: 'Outbox', implemented: true },
    { icon: 'person-outline', label: 'Personal Information', screen: 'PersonalInfo', implemented: true },
    { icon: 'car-outline', label: 'My Vehicle', screen: 'Vehicle', implemented: true },
    { icon: 'time-outline', label: 'Time Entries', screen: 'TimeEntries', implemented: true },
    { icon: 'document-text-outline', label: 'Documents', screen: 'Documents', implemented: true },
    { icon: 'notifications-outline', label: 'Notifications', screen: 'Notifications', implemented: true },
    { icon: 'help-circle-outline', label: 'Help & Support', screen: 'Help', implemented: true },
  ];

  const handleMenuItemPress = (item) => {
    if (!item.implemented) {
      Alert.alert(
        'Coming Soon',
        `${item.label} will be available in a future update.`,
        [{ text: 'OK' }]
      );
      return;
    }
    navigation.navigate(item.screen);
  };

  // Get user initials
  const getInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user?.name) {
      const parts = user.name.split(' ');
      return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
    }
    return 'DT';
  };

  const getUserName = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    return user?.name || user?.email || 'Demo Technician';
  };

  const stats = [
    { label: 'Jobs Today', value: '-' },
    { label: 'This Week', value: '-' },
    { label: 'Hours', value: '-' },
  ];

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials()}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.name}>{getUserName()}</Text>
            <Text style={styles.role}>{user?.role || 'Field Technician'}</Text>
            <View style={styles.statusBadge}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>On Duty</Text>
            </View>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsContainer}>
          {stats.map((stat, index) => (
            <View key={index} style={styles.statItem}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Menu Items */}
      <View style={styles.menuSection}>
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.menuItem, !item.implemented && styles.menuItemDisabled]}
            onPress={() => handleMenuItemPress(item)}
          >
            <View style={styles.menuItemLeft}>
              <Ionicons name={item.icon} size={22} color={item.implemented ? colors.text : colors.textMuted} />
              <Text style={[styles.menuLabel, !item.implemented && styles.menuLabelDisabled]}>{item.label}</Text>
              {!item.implemented && (
                <View style={styles.comingSoonBadge}>
                  <Text style={styles.comingSoonText}>Soon</Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Logout Button */}
      <View style={styles.logoutSection}>
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={22} color="#ef4444" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.version}>Field Ops Mobile v1.0.0</Text>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.primary,
    paddingTop: 60,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textInverse,
  },
  profileInfo: {
    flex: 1,
  },
  name: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textInverse,
  },
  role: {
    fontSize: 14,
    color: '#93c5fd',
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#d1fae5',
    fontWeight: '500',
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textInverse,
  },
  statLabel: {
    fontSize: 12,
    color: '#93c5fd',
    marginTop: 4,
  },
  menuSection: {
    backgroundColor: colors.card,
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuLabel: {
    fontSize: 15,
    color: colors.text,
  },
  menuLabelDisabled: {
    color: colors.textMuted,
  },
  menuItemDisabled: {
    opacity: 0.7,
  },
  comingSoonBadge: {
    backgroundColor: colors.background,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  comingSoonText: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  logoutSection: {
    marginTop: 16,
    marginHorizontal: 16,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  logoutText: {
    fontSize: 15,
    color: '#ef4444',
    fontWeight: '500',
  },
  version: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 24,
  },
});
