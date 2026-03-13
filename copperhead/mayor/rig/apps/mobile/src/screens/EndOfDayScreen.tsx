/**
 * M11: Technician Day Summary & End-of-Day Workflow Screen
 *
 * Provides technicians with a comprehensive end-of-day checklist and workflow
 * to ensure all data is synced and they're prepared for tomorrow.
 *
 * Features:
 * - Pending time entries review and submission
 * - Pending parts/materials sync status
 * - Pending photos/documents upload status
 * - Today's completed work orders summary
 * - Tomorrow's schedule preview
 * - "Complete Day" action with validation
 * - Offline support with sync queue
 *
 * Uses shared-domain types:
 * - WorkOrder entity
 * - TimeEntry entity
 * - PartUsed entity
 * - Photo entity
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WorkOrder, TimeEntry, PartUsed, Photo } from '@field-ops/shared-domain';
import {
  getWorkOrders,
  submitSingleTimeEntry,
  processOfflineQueue,
  completeDay,
} from '../services/api.service';
import { useThemeStyles } from '../theme';
import { useAuth } from '../contexts/AuthContext';

// Extended types for pending items (local offline queue)
interface PendingTimeEntry extends TimeEntry {
  isPending: boolean;
  workOrderNumber?: string;
  duration_hours: number; // Computed from duration_minutes for display
}

interface PendingPart extends PartUsed {
  id: string;
  isPending: boolean;
  workOrderNumber?: string;
  work_order_id: string;
}

interface PendingPhoto extends Photo {
  isPending: boolean;
  workOrderNumber?: string;
  localUri?: string;
  work_order_id: string;
  category?: string;
}

interface DaySummary {
  date: string;
  completedWorkOrders: WorkOrder[];
  totalHoursWorked: number;
  totalWorkOrdersCompleted: number;
  pendingTimeEntries: PendingTimeEntry[];
  pendingParts: PendingPart[];
  pendingPhotos: PendingPhoto[];
  tomorrowSchedule: WorkOrder[];
}

interface EndOfDayScreenProps {
  navigation: any;
  route?: {
    params?: {
      technicianId?: string;
    };
  };
}

export default function EndOfDayScreen({ navigation, route }: EndOfDayScreenProps) {
  const { user } = useAuth();
  const technicianId = route?.params?.technicianId || user?.id;
  const { colors, isDark } = useThemeStyles();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    pendingTime: true,
    pendingParts: true,
    pendingPhotos: true,
    completed: true,
    tomorrow: true,
  });

  // Load day summary on mount
  useEffect(() => {
    loadDaySummary();
  }, []);

  const loadDaySummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch completed work orders from API
      const completedResponse = await getWorkOrders(undefined, 'COMPLETED');
      const scheduledResponse = await getWorkOrders();

      // Filter completed work orders from today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let completedWorkOrders: WorkOrder[] = [];
      let tomorrowSchedule: WorkOrder[] = [];
      let totalHoursWorked = 0;

      if (completedResponse.data?.workOrders) {
        completedWorkOrders = completedResponse.data.workOrders
          .filter((wo: any) => {
            if (!wo.completed_at) return false;
            const completedDate = new Date(wo.completed_at);
            completedDate.setHours(0, 0, 0, 0);
            return completedDate.getTime() === today.getTime();
          })
          .map((wo: any) => ({
            id: wo.id,
            work_order_number: wo.work_order_number,
            title: wo.title,
            status: wo.status,
            priority: wo.priority,
            completed_at: wo.completed_at,
            actual_hours: wo.actual_hours || 0,
          } as WorkOrder));

        totalHoursWorked = completedWorkOrders.reduce(
          (sum, wo: any) => sum + (wo.actual_hours || 0),
          0
        );
      }

      if (scheduledResponse.data?.workOrders) {
        // Get tomorrow's date
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        tomorrowSchedule = scheduledResponse.data.workOrders
          .filter((wo: any) => {
            if (!wo.scheduled_start) return false;
            const scheduledDate = new Date(wo.scheduled_start);
            scheduledDate.setHours(0, 0, 0, 0);
            return scheduledDate.getTime() === tomorrow.getTime();
          })
          .map((wo: any) => ({
            id: wo.id,
            work_order_number: wo.work_order_number,
            title: wo.title,
            status: wo.status,
            priority: wo.priority,
            scheduled_start: wo.scheduled_start,
          } as WorkOrder));
      }

      const apiSummary: DaySummary = {
        date: new Date().toISOString(),
        totalHoursWorked,
        totalWorkOrdersCompleted: completedWorkOrders.length,
        completedWorkOrders,
        pendingTimeEntries: [], // Would come from local offline queue
        pendingParts: [], // Would come from local offline queue
        pendingPhotos: [], // Would come from local offline queue
        tomorrowSchedule,
      };

      setSummary(apiSummary);
      setIsOffline(false);
    } catch (err) {
      console.error('Error loading day summary:', err);
      setError('Failed to load day summary');
      setIsOffline(true);

      // Fallback to mock data if API fails
      const mockSummary: DaySummary = {
        date: new Date().toISOString(),
        totalHoursWorked: 0,
        totalWorkOrdersCompleted: 0,
        completedWorkOrders: [],
        pendingTimeEntries: [],
        pendingParts: [],
        pendingPhotos: [],
        tomorrowSchedule: [],
      };
      setSummary(mockSummary);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [technicianId]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadDaySummary();
  }, [loadDaySummary]);

  const toggleSection = useCallback((section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  const handleSubmitTimeEntry = useCallback((entry: PendingTimeEntry) => {
    Alert.alert(
      'Submit Time Entry',
      `Submit time entry for ${entry.workOrderNumber}?\n${entry.duration_hours} hours`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            try {
              const response = await submitSingleTimeEntry(entry.id);

              if (response.error) {
                Alert.alert('Error', response.error);
                return;
              }

              // Remove from pending list
              setSummary((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  pendingTimeEntries: prev.pendingTimeEntries.filter((e) => e.id !== entry.id),
                };
              });

              Alert.alert('Success', 'Time entry submitted successfully');
            } catch (err) {
              Alert.alert('Error', 'Failed to submit time entry');
            }
          },
        },
      ]
    );
  }, []);

  const handleSyncPendingParts = useCallback(() => {
    if (!summary?.pendingParts.length) return;

    Alert.alert(
      'Sync Parts',
      `Sync ${summary.pendingParts.length} pending parts/materials?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sync',
          onPress: async () => {
            try {
              // Build offline queue actions for each pending part
              const actions = summary.pendingParts.map((part) => ({
                id: part.id,
                type: 'ADD_PART_TO_WORK_ORDER',
                payload: {
                  workOrderId: part.work_order_id,
                  inventoryItemId: part.inventory_item_id,
                  sku: part.sku,
                  name: part.name,
                  quantity: part.quantity,
                },
                timestamp: new Date().toISOString(),
              }));

              const response = await processOfflineQueue(actions);

              if (response.error) {
                Alert.alert('Error', response.error);
                return;
              }

              const { processed, failed } = response.data || { processed: 0, failed: 0 };

              setSummary((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  pendingParts: [],
                };
              });

              if (failed > 0) {
                Alert.alert(
                  'Partial Sync',
                  `${processed} parts synced successfully. ${failed} failed - please try again.`
                );
              } else {
                Alert.alert('Success', `${processed} parts synced successfully`);
              }
            } catch (err) {
              Alert.alert('Error', 'Failed to sync parts');
            }
          },
        },
      ]
    );
  }, [summary?.pendingParts]);

  const handleSyncPendingPhotos = useCallback(() => {
    if (!summary?.pendingPhotos.length) return;

    Alert.alert(
      'Upload Photos',
      `Upload ${summary.pendingPhotos.length} pending photos?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Upload',
          onPress: async () => {
            try {
              // Build offline queue actions for each pending photo
              const actions = summary.pendingPhotos.map((photo) => ({
                id: photo.id,
                type: 'UPLOAD_PHOTO',
                payload: {
                  workOrderId: photo.work_order_id,
                  localUri: (photo as PendingPhoto).localUri,
                  caption: photo.caption,
                  category: photo.category,
                },
                timestamp: new Date().toISOString(),
              }));

              const response = await processOfflineQueue(actions);

              if (response.error) {
                Alert.alert('Error', response.error);
                return;
              }

              const { processed, failed } = response.data || { processed: 0, failed: 0 };

              setSummary((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  pendingPhotos: [],
                };
              });

              if (failed > 0) {
                Alert.alert(
                  'Partial Upload',
                  `${processed} photos uploaded successfully. ${failed} failed - please try again.`
                );
              } else {
                Alert.alert('Success', `${processed} photos uploaded successfully`);
              }
            } catch (err) {
              Alert.alert('Error', 'Failed to upload photos');
            }
          },
        },
      ]
    );
  }, [summary?.pendingPhotos]);

  const handleCompleteDay = useCallback(() => {
    if (!summary) return;

    const hasPendingItems =
      summary.pendingTimeEntries.length > 0 ||
      summary.pendingParts.length > 0 ||
      summary.pendingPhotos.length > 0;

    if (hasPendingItems) {
      Alert.alert(
        'Pending Items',
        'You have unsynced items:\n\n' +
          (summary.pendingTimeEntries.length > 0
            ? `• ${summary.pendingTimeEntries.length} time entries\n`
            : '') +
          (summary.pendingParts.length > 0
            ? `• ${summary.pendingParts.length} parts/materials\n`
            : '') +
          (summary.pendingPhotos.length > 0
            ? `• ${summary.pendingPhotos.length} photos\n`
            : '') +
          '\nPlease sync or review these items before completing your day.',
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert(
      'Complete Day',
      'All items synced. Ready to complete your day?\n\n' +
        `Work Orders Completed: ${summary.totalWorkOrdersCompleted}\n` +
        `Total Hours: ${summary.totalHoursWorked}h\n` +
        `Tomorrow's Jobs: ${summary.tomorrowSchedule.length}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete Day',
          onPress: async () => {
            if (!technicianId) {
              Alert.alert('Error', 'Unable to identify technician. Please try logging in again.');
              return;
            }

            setIsSubmitting(true);
            try {
              const response = await completeDay(technicianId, {
                date: summary.date,
                totalHoursWorked: summary.totalHoursWorked,
                totalJobsCompleted: summary.totalWorkOrdersCompleted,
              });

              if (response.error) {
                Alert.alert('Error', response.error);
                return;
              }

              Alert.alert(
                'Day Complete',
                'Your day has been completed successfully. See you tomorrow!',
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      // Navigate back to dashboard
                      navigation.navigate('MainTabs', { screen: 'Dashboard' });
                    },
                  },
                ]
              );
            } catch (err) {
              Alert.alert('Error', 'Failed to complete day. Please try again.');
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ]
    );
  }, [summary, navigation, technicianId]);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const getTotalPendingCount = () => {
    if (!summary) return 0;
    return (
      summary.pendingTimeEntries.length +
      summary.pendingParts.length +
      summary.pendingPhotos.length
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="time-outline" size={64} color={colors.primary} />
          <Text style={styles.loadingText}>Loading day summary...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !summary) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
          <Text style={styles.errorTitle}>Error Loading Summary</Text>
          <Text style={styles.errorText}>{error || 'Failed to load data'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadDaySummary}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const totalPendingCount = getTotalPendingCount();
  const allSynced = totalPendingCount === 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Offline Banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline" size={20} color={colors.textInverse} />
          <Text style={styles.offlineBannerText}>
            Offline - Changes will sync when connected
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>End of Day</Text>
            <Text style={styles.headerSubtitle}>
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleRefresh} disabled={isRefreshing}>
          <Ionicons
            name="refresh"
            size={24}
            color={isRefreshing ? colors.textMuted : colors.primary}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Summary Cards */}
        <View style={styles.summaryCards}>
          <View style={styles.summaryCard}>
            <View style={styles.summaryCardIcon}>
              <Ionicons name="checkmark-done" size={24} color={colors.success} />
            </View>
            <Text style={styles.summaryCardValue}>
              {summary.totalWorkOrdersCompleted}
            </Text>
            <Text style={styles.summaryCardLabel}>Jobs Completed</Text>
          </View>

          <View style={styles.summaryCard}>
            <View style={styles.summaryCardIcon}>
              <Ionicons name="time" size={24} color={colors.primary} />
            </View>
            <Text style={styles.summaryCardValue}>{summary.totalHoursWorked}h</Text>
            <Text style={styles.summaryCardLabel}>Hours Worked</Text>
          </View>

          <View style={styles.summaryCard}>
            <View
              style={[
                styles.summaryCardIcon,
                { backgroundColor: allSynced ? colors.successBg : colors.errorBg },
              ]}
            >
              <Ionicons
                name={allSynced ? 'cloud-done' : 'warning'}
                size={24}
                color={allSynced ? colors.success : colors.error}
              />
            </View>
            <Text style={styles.summaryCardValue}>{totalPendingCount}</Text>
            <Text style={styles.summaryCardLabel}>Pending Items</Text>
          </View>
        </View>

        {/* Pending Time Entries */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('pendingTime')}
          >
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="time-outline" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>Pending Time Entries</Text>
              {summary.pendingTimeEntries.length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {summary.pendingTimeEntries.length}
                  </Text>
                </View>
              )}
            </View>
            <Ionicons
              name={expandedSections.pendingTime ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>

          {expandedSections.pendingTime && (
            <View style={styles.sectionContent}>
              {summary.pendingTimeEntries.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="checkmark-circle" size={48} color={colors.success} />
                  <Text style={styles.emptyStateText}>
                    All time entries submitted
                  </Text>
                </View>
              ) : (
                summary.pendingTimeEntries.map((entry) => (
                  <View key={entry.id} style={styles.pendingItem}>
                    <View style={styles.pendingItemLeft}>
                      <Text style={styles.pendingItemTitle}>
                        {entry.workOrderNumber}
                      </Text>
                      <Text style={styles.pendingItemMeta}>
                        {formatTime(entry.start_time)} - {formatTime(entry.end_time)} •{' '}
                        {entry.duration_hours}h
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.submitButton}
                      onPress={() => handleSubmitTimeEntry(entry)}
                    >
                      <Text style={styles.submitButtonText}>Submit</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          )}
        </View>

        {/* Pending Parts/Materials */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('pendingParts')}
          >
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="cube-outline" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>Pending Parts/Materials</Text>
              {summary.pendingParts.length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{summary.pendingParts.length}</Text>
                </View>
              )}
            </View>
            <Ionicons
              name={expandedSections.pendingParts ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>

          {expandedSections.pendingParts && (
            <View style={styles.sectionContent}>
              {summary.pendingParts.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="checkmark-circle" size={48} color={colors.success} />
                  <Text style={styles.emptyStateText}>All parts synced</Text>
                </View>
              ) : (
                <>
                  {summary.pendingParts.map((part) => (
                    <View key={part.id} style={styles.pendingItem}>
                      <View style={styles.pendingItemLeft}>
                        <Text style={styles.pendingItemTitle}>{part.name}</Text>
                        <Text style={styles.pendingItemMeta}>
                          {part.workOrderNumber} • Qty: {part.quantity} • SKU:{' '}
                          {part.sku}
                        </Text>
                      </View>
                      <View style={styles.statusBadge}>
                        <Ionicons name="cloud-upload-outline" size={16} color={colors.warning} />
                      </View>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={styles.syncAllButton}
                    onPress={handleSyncPendingParts}
                  >
                    <Ionicons name="sync" size={20} color={colors.textInverse} />
                    <Text style={styles.syncAllButtonText}>Sync All Parts</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>

        {/* Pending Photos */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('pendingPhotos')}
          >
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="camera-outline" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>Pending Photos</Text>
              {summary.pendingPhotos.length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{summary.pendingPhotos.length}</Text>
                </View>
              )}
            </View>
            <Ionicons
              name={expandedSections.pendingPhotos ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>

          {expandedSections.pendingPhotos && (
            <View style={styles.sectionContent}>
              {summary.pendingPhotos.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="checkmark-circle" size={48} color={colors.success} />
                  <Text style={styles.emptyStateText}>All photos uploaded</Text>
                </View>
              ) : (
                <>
                  {summary.pendingPhotos.map((photo) => (
                    <View key={photo.id} style={styles.pendingItem}>
                      <View style={styles.pendingItemLeft}>
                        <Text style={styles.pendingItemTitle}>
                          {photo.caption || 'Photo'}
                        </Text>
                        <Text style={styles.pendingItemMeta}>
                          {photo.workOrderNumber} • {photo.category}
                        </Text>
                      </View>
                      <View style={styles.statusBadge}>
                        <Ionicons name="cloud-upload-outline" size={16} color={colors.warning} />
                      </View>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={styles.syncAllButton}
                    onPress={handleSyncPendingPhotos}
                  >
                    <Ionicons name="cloud-upload" size={20} color={colors.textInverse} />
                    <Text style={styles.syncAllButtonText}>Upload All Photos</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>

        {/* Completed Work Orders */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('completed')}
          >
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="checkmark-done-outline" size={20} color={colors.success} />
              <Text style={styles.sectionTitle}>Today's Completed Jobs</Text>
            </View>
            <Ionicons
              name={expandedSections.completed ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>

          {expandedSections.completed && (
            <View style={styles.sectionContent}>
              {summary.completedWorkOrders.map((wo) => (
                <TouchableOpacity
                  key={wo.id}
                  style={styles.workOrderItem}
                  onPress={() => {
                    navigation.navigate('WorkOrderDetail', { workOrder: wo });
                  }}
                >
                  <View style={styles.workOrderItemLeft}>
                    <Text style={styles.workOrderNumber}>{wo.work_order_number}</Text>
                    <Text style={styles.workOrderTitle}>{wo.title}</Text>
                    <View style={styles.workOrderMeta}>
                      <Ionicons name="time" size={14} color={colors.textSecondary} />
                      <Text style={styles.workOrderMetaText}>
                        {wo.actual_hours}h
                      </Text>
                      <Ionicons
                        name="flag"
                        size={14}
                        color={
                          wo.priority === 'urgent'
                            ? colors.error
                            : wo.priority === 'high'
                            ? colors.warning
                            : colors.textMuted
                        }
                        style={{ marginLeft: 12 }}
                      />
                      <Text style={styles.workOrderMetaText}>
                        {wo.priority}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Tomorrow's Schedule */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('tomorrow')}
          >
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="calendar-outline" size={20} color={colors.info} />
              <Text style={styles.sectionTitle}>Tomorrow's Schedule</Text>
              {summary.tomorrowSchedule.length > 0 && (
                <View style={[styles.badge, { backgroundColor: colors.infoBg }]}>
                  <Text style={[styles.badgeText, { color: colors.info }]}>
                    {summary.tomorrowSchedule.length}
                  </Text>
                </View>
              )}
            </View>
            <Ionicons
              name={expandedSections.tomorrow ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>

          {expandedSections.tomorrow && (
            <View style={styles.sectionContent}>
              {summary.tomorrowSchedule.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="calendar-outline" size={48} color={colors.textMuted} />
                  <Text style={styles.emptyStateText}>No jobs scheduled</Text>
                </View>
              ) : (
                summary.tomorrowSchedule.map((wo) => (
                  <View key={wo.id} style={styles.scheduleItem}>
                    <View style={styles.scheduleTimeContainer}>
                      <Text style={styles.scheduleTime}>
                        {formatTime(wo.scheduled_start || '')}
                      </Text>
                      <Text style={styles.scheduleEstimate}>
                        {wo.estimated_hours}h est
                      </Text>
                    </View>
                    <View style={styles.scheduleDetails}>
                      <Text style={styles.scheduleNumber}>{wo.work_order_number}</Text>
                      <Text style={styles.scheduleTitle}>{wo.title}</Text>
                      {wo.service_address_line1 && (
                        <View style={styles.scheduleLocation}>
                          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
                          <Text style={styles.scheduleLocationText}>
                            {wo.service_address_line1}, {wo.service_city}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))
              )}
            </View>
          )}
        </View>

        {/* Bottom Padding */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Complete Day Button */}
      <View style={styles.footer}>
        {!allSynced && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning-outline" size={18} color={colors.warning} />
            <Text style={styles.warningText}>
              {totalPendingCount} pending {totalPendingCount === 1 ? 'item' : 'items'}{' '}
              - sync before completing day
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[
            styles.completeDayButton,
            (!allSynced || isSubmitting) && styles.completeDayButtonDisabled,
          ]}
          onPress={handleCompleteDay}
          disabled={!allSynced || isSubmitting}
        >
          <Ionicons name="checkmark-done" size={24} color={colors.textInverse} />
          <Text style={styles.completeDayButtonText}>
            {isSubmitting ? 'Completing...' : 'Complete Day'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  errorText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },
  offlineBanner: {
    backgroundColor: colors.warning,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  offlineBannerText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: '600',
  },
  header: {
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  summaryCards: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.infoBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryCardValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  summaryCardLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  section: {
    backgroundColor: colors.card,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  badge: {
    backgroundColor: colors.errorBg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.error,
  },
  sectionContent: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyStateText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  pendingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pendingItemLeft: {
    flex: 1,
    gap: 4,
  },
  pendingItemTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  pendingItemMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  submitButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  submitButtonText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: '600',
  },
  statusBadge: {
    padding: 8,
  },
  syncAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  syncAllButtonText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },
  workOrderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  workOrderItemLeft: {
    flex: 1,
    gap: 4,
  },
  workOrderNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  workOrderTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  workOrderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  workOrderMetaText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  scheduleItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 16,
  },
  scheduleTimeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 60,
  },
  scheduleTime: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  scheduleEstimate: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  scheduleDetails: {
    flex: 1,
    gap: 4,
  },
  scheduleNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.info,
  },
  scheduleTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  scheduleLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  scheduleLocationText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  footer: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warningBg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  warningText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.warning,
  },
  completeDayButton: {
    backgroundColor: colors.success,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 10,
  },
  completeDayButtonDisabled: {
    backgroundColor: colors.borderLight,
  },
  completeDayButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '700',
  },
});
