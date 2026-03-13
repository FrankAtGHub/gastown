/**
 * Crew Clock-In Screen
 *
 * iPad-optimized crew management screen for lead technicians.
 * Shows crew members with clock-in/out status, verification photo flow,
 * and GPS capture.
 *
 * Navigation Flow:
 * - M3 (Work Order Detail) → CrewClockIn → Back to M3
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
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
  Dimensions,
} from 'react-native';
import { useThemeStyles } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  getWorkOrderCrew,
  crewClockIn,
  crewClockOut,
  createClockInSession,
  CrewMember,
} from '../services/api.service';
import { normalizeError } from '../utils/errorUtils';
import { useLocation } from '../hooks';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IS_TABLET = SCREEN_WIDTH >= 768;
const CARD_COLUMNS = IS_TABLET ? 2 : 1;

interface CrewClockInScreenProps {
  route: {
    params: {
      workOrderId: string;
      workOrderNumber?: string;
      workOrderTitle?: string;
    };
  };
  navigation: any;
}

export default function CrewClockInScreen({
  route,
  navigation,
}: CrewClockInScreenProps) {
  const { colors, isDark } = useThemeStyles();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { workOrderId, workOrderNumber, workOrderTitle } = route.params;

  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Photo preview modal state
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoTarget, setPhotoTarget] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null);

  // QR clock-in session state
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  // Location hook
  const { location, getCurrentLocation } = useLocation();

  // Set header title
  useEffect(() => {
    navigation.setOptions({
      headerTitle: workOrderNumber ? `Crew — ${workOrderNumber}` : 'Crew',
    });
  }, [navigation, workOrderNumber]);

  // Load crew data
  const loadCrew = useCallback(async () => {
    try {
      setError(null);
      const response = await getWorkOrderCrew(workOrderId);
      if (response.error) {
        setError(normalizeError(response.error, 'Failed to load crew'));
        return;
      }
      if (response.data?.crew) {
        setCrew(response.data.crew);
      }
    } catch (err) {
      console.error('Load crew error:', err);
      setError('Failed to load crew. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [workOrderId]);

  useEffect(() => {
    loadCrew();
    getCurrentLocation();
  }, [loadCrew, getCurrentLocation]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadCrew();
  }, [loadCrew]);

  // Clock-in flow: capture photo → preview → confirm → submit
  const handleClockIn = useCallback(async (technicianId: string) => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera access is needed for verification photos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        cameraType: ImagePicker.CameraType.front,
        quality: 0.7,
        base64: true,
        allowsEditing: false,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setPhotoPreview(asset.uri);
      setPhotoTarget(technicianId);

      // Store base64 in a ref-like pattern via closure in confirm handler
      // The confirm handler will be called from the modal
      (handleClockIn as any)._pendingBase64 = asset.base64;
    } catch (err) {
      console.error('Camera error:', err);
      Alert.alert('Error', 'Failed to open camera. Please try again.');
    }
  }, []);

  // Confirm clock-in with photo
  const handleConfirmClockIn = useCallback(async () => {
    if (!photoTarget) return;

    setIsSubmitting(photoTarget);
    setPhotoPreview(null);

    try {
      const locationData = location
        ? { latitude: location.latitude, longitude: location.longitude }
        : undefined;

      const base64 = (handleClockIn as any)._pendingBase64;

      const response = await crewClockIn(workOrderId, {
        technicianId: photoTarget,
        verificationPhotoBase64: base64 || undefined,
        location: locationData,
      });

      if (response.error) {
        Alert.alert('Error', normalizeError(response.error, 'Failed to clock in'));
        return;
      }

      // Reload crew to get updated status
      await loadCrew();
    } catch (err) {
      console.error('Clock in error:', err);
      Alert.alert('Error', 'Failed to clock in. Please try again.');
    } finally {
      setIsSubmitting(null);
      setPhotoTarget(null);
      (handleClockIn as any)._pendingBase64 = null;
    }
  }, [photoTarget, workOrderId, location, loadCrew, handleClockIn]);

  // Retake photo
  const handleRetake = useCallback(() => {
    if (!photoTarget) return;
    setPhotoPreview(null);
    handleClockIn(photoTarget);
  }, [photoTarget, handleClockIn]);

  // Cancel photo
  const handleCancelPhoto = useCallback(() => {
    setPhotoPreview(null);
    setPhotoTarget(null);
    (handleClockIn as any)._pendingBase64 = null;
  }, [handleClockIn]);

  // Clock-out flow
  const handleClockOut = useCallback(async (technicianId: string) => {
    Alert.alert(
      'Clock Out',
      'Are you sure you want to clock out this crew member?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clock Out',
          onPress: async () => {
            setIsSubmitting(technicianId);
            try {
              const locationData = location
                ? { latitude: location.latitude, longitude: location.longitude }
                : undefined;

              const response = await crewClockOut(workOrderId, {
                technicianId,
                location: locationData,
              });

              if (response.error) {
                Alert.alert('Error', normalizeError(response.error, 'Failed to clock out'));
                return;
              }

              await loadCrew();
            } catch (err) {
              console.error('Clock out error:', err);
              Alert.alert('Error', 'Failed to clock out. Please try again.');
            } finally {
              setIsSubmitting(null);
            }
          },
        },
      ]
    );
  }, [workOrderId, location, loadCrew]);

  // Derived counts
  const clockedInCount = crew.filter((m) => m.is_clocked_in).length;
  const totalCount = crew.length;

  // Role badge colors
  const roleBadge = (role: string) => {
    switch (role) {
      case 'lead':
        return { bg: colors.infoBg, text: colors.primary, label: 'Lead' };
      case 'apprentice':
        return { bg: colors.warningBg, text: colors.warning, label: 'Apprentice' };
      default:
        return { bg: colors.backgroundSecondary, text: colors.textSecondary, label: 'Crew' };
    }
  };

  // Format clock-in time
  const formatTime = (isoString?: string | null) => {
    if (!isoString) return null;
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  // Generate QR clock-in session
  const handleGenerateQr = useCallback(async () => {
    setIsGeneratingQr(true);
    try {
      const response = await createClockInSession(workOrderId);
      if (response.data?.success && response.data.session) {
        setQrUrl(response.data.session.qrUrl);
        setQrExpiresAt(response.data.session.expiresAt);
        setShowQrModal(true);
      } else {
        Alert.alert('Error', response.data?.error || 'Failed to create clock-in session');
      }
    } catch (err) {
      Alert.alert('Error', normalizeError(err));
    } finally {
      setIsGeneratingQr(false);
    }
  }, [workOrderId]);

  // Format hours
  const formatHours = (hours?: number) => {
    if (!hours) return '0h';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  // Render crew member card
  const renderCrewCard = (member: CrewMember) => {
    const badge = roleBadge(member.role);
    const isBusy = isSubmitting === member.technician_id;

    return (
      <View
        key={member.technician_id}
        style={[
          styles.crewCard,
          member.is_clocked_in && styles.crewCardClockedIn,
          CARD_COLUMNS === 2 && styles.crewCardHalf,
        ]}
      >
        {/* Header row: avatar + name + role */}
        <View style={styles.cardHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {member.first_name?.[0]}
              {member.last_name?.[0]}
            </Text>
          </View>
          <View style={styles.cardNameContainer}>
            <Text style={styles.cardName}>
              {member.first_name} {member.last_name}
            </Text>
            <View style={[styles.roleBadge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.roleBadgeText, { color: badge.text }]}>
                {badge.label}
              </Text>
            </View>
          </View>
        </View>

        {/* Status row */}
        <View style={styles.cardStatus}>
          {member.is_clocked_in ? (
            <>
              <View style={styles.statusDot} />
              <Text style={styles.statusTextIn}>
                IN @ {formatTime(member.clock_in_time)}
              </Text>
            </>
          ) : (
            <>
              <View style={[styles.statusDot, styles.statusDotOff]} />
              <Text style={styles.statusTextOut}>NOT CLOCKED IN</Text>
            </>
          )}
        </View>

        {/* Hours today */}
        {member.total_hours_today != null && member.total_hours_today > 0 && (
          <Text style={styles.hoursText}>
            Today: {formatHours(member.total_hours_today)}
          </Text>
        )}

        {/* Verification photo thumbnail */}
        {member.verification_photo_url && (
          <Image
            source={{ uri: member.verification_photo_url }}
            style={styles.verificationThumb}
          />
        )}

        {/* Action button */}
        <TouchableOpacity
          style={[
            styles.actionBtn,
            member.is_clocked_in ? styles.actionBtnOut : styles.actionBtnIn,
          ]}
          onPress={() =>
            member.is_clocked_in
              ? handleClockOut(member.technician_id)
              : handleClockIn(member.technician_id)
          }
          disabled={isBusy}
        >
          {isBusy ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <>
              <Ionicons
                name={member.is_clocked_in ? 'log-out-outline' : 'log-in-outline'}
                size={18}
                color={colors.textInverse}
              />
              <Text style={styles.actionBtnText}>
                {member.is_clocked_in ? 'Clock Out' : 'Clock In'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading crew...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error && crew.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadCrew}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Empty state
  if (crew.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>No crew assigned to this work order.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Status banner */}
      <View style={styles.banner}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Ionicons name="people" size={20} color={colors.primary} />
          <Text style={styles.bannerText}>
            {clockedInCount} of {totalCount} crew on site
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleGenerateQr}
          disabled={isGeneratingQr}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.primary,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 8,
          }}
        >
          <Ionicons name="qr-code-outline" size={16} color={colors.textInverse} />
          <Text style={{ color: colors.textInverse, fontSize: 13, fontWeight: '600', marginLeft: 6 }}>
            {isGeneratingQr ? 'Generating...' : 'QR Clock-In'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Crew grid */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.gridContainer}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.grid}>
          {crew.map(renderCrewCard)}
        </View>
      </ScrollView>

      {/* Photo preview modal */}
      <Modal
        visible={!!photoPreview}
        animationType="slide"
        transparent={true}
        onRequestClose={handleCancelPhoto}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Verification Photo</Text>
            {photoPreview && (
              <Image source={{ uri: photoPreview }} style={styles.photoPreview} />
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={handleRetake}
              >
                <Ionicons name="camera-reverse-outline" size={18} color={colors.text} />
                <Text style={styles.modalBtnSecondaryText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={handleConfirmClockIn}
              >
                <Ionicons name="checkmark" size={18} color={colors.textInverse} />
                <Text style={styles.modalBtnPrimaryText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* QR Clock-In Session Modal */}
      <Modal
        visible={showQrModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowQrModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { alignItems: 'center', paddingVertical: 32 }]}>
            <Ionicons name="qr-code" size={64} color={colors.primary} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 16 }}>
              QR Clock-In Ready
            </Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 8, textAlign: 'center', paddingHorizontal: 20 }}>
              Share this link with crew members. They can open it on their phone to clock in — no app required.
            </Text>
            {qrUrl && (
              <View style={{
                backgroundColor: colors.backgroundSecondary,
                borderRadius: 8,
                padding: 12,
                marginTop: 16,
                width: '100%',
              }}>
                <Text style={{ fontSize: 12, color: colors.primary, textAlign: 'center' }} selectable>
                  {qrUrl}
                </Text>
              </View>
            )}
            {qrExpiresAt && (
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>
                Expires: {new Date(qrExpiresAt).toLocaleTimeString()}
              </Text>
            )}
            <View style={{ flexDirection: 'row', marginTop: 24, gap: 12 }}>
              <TouchableOpacity
                style={{
                  backgroundColor: colors.primary,
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  borderRadius: 8,
                }}
                onPress={() => {
                  handleGenerateQr();
                }}
              >
                <Text style={{ color: colors.textInverse, fontWeight: '600' }}>Refresh</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  backgroundColor: colors.backgroundTertiary,
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  borderRadius: 8,
                }}
                onPress={() => setShowQrModal(false)}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.textSecondary,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },

  // Banner
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.infoBg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight,
  },
  bannerText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },

  // Grid
  scrollView: {
    flex: 1,
  },
  gridContainer: {
    padding: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },

  // Crew card
  crewCard: {
    flex: 1,
    minWidth: '100%',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  crewCardHalf: {
    minWidth: '48%',
    maxWidth: '49%',
  },
  crewCardClockedIn: {
    borderColor: colors.success,
    backgroundColor: colors.successBg,
  },

  // Card header
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.infoBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  cardNameContainer: {
    flex: 1,
    gap: 4,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Status
  cardStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  statusDotOff: {
    backgroundColor: colors.textMuted,
  },
  statusTextIn: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.success,
  },
  statusTextOut: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  hoursText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  verificationThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
    marginBottom: 8,
  },

  // Action button
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  actionBtnIn: {
    backgroundColor: colors.primary,
  },
  actionBtnOut: {
    backgroundColor: colors.error,
  },
  actionBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },

  // Photo preview modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  photoPreview: {
    width: 280,
    height: 280,
    borderRadius: 12,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
  },
  modalBtnSecondary: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  modalBtnSecondaryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  modalBtnPrimary: {
    backgroundColor: colors.primary,
  },
  modalBtnPrimaryText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },
});
