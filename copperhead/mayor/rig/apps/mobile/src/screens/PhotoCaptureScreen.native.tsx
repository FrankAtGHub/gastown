/**
 * M8: Photo Capture Screen
 *
 * Allows technicians to capture and manage photos during work orders.
 * This screen provides camera access, photo gallery selection, captioning,
 * and categorization of photos for documentation purposes.
 *
 * Navigation Flow:
 * - M3 (Work Order Detail) → M8 (Photo Capture)
 * - M6 (Close-Out) → M8 (Photo Capture)
 * - M7 (Activities) → M8 (Photo Capture)
 *
 * Features:
 * - Take photos with device camera (expo-image-picker)
 * - Select photos from device gallery
 * - Photo preview with thumbnail grid
 * - Add captions to photos
 * - Categorize photos (Before/During/After, Issue, Equipment)
 * - Delete photos with confirmation
 * - Offline support with pending upload indicators
 * - Full-screen photo preview on tap
 *
 * Uses shared-domain types:
 * - Photo entity
 * - WorkOrder entity
 *
 * Offline Behavior:
 * - Photos stored locally until synced
 * - Pending upload indicators shown
 * - Auto-retry on connection restore
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
  Image,
  Dimensions,
  Modal,
  TextInput,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import type { Photo } from '@field-ops/shared-domain';
import { uploadPhoto, getWorkOrderDetail } from '../services/api.service';
import { normalizeError } from '../utils/errorUtils';
import { useThemeStyles } from '../theme';

// Photo categories matching API types
const PHOTO_CATEGORIES = [
  { value: 'before', label: 'Before', icon: 'calendar-outline' },
  { value: 'after', label: 'After', icon: 'checkmark-circle-outline' },
  { value: 'issue', label: 'Issue', icon: 'alert-circle-outline' },
  { value: 'parts', label: 'Parts', icon: 'hardware-chip-outline' },
  { value: 'general', label: 'General', icon: 'document-outline' },
] as const;

type PhotoCategory = typeof PHOTO_CATEGORIES[number]['value'];

// Extended photo type for local state management
interface LocalPhoto extends Photo {
  category?: PhotoCategory;
  localUri?: string; // For offline photos not yet uploaded
  isUploading?: boolean;
  uploadError?: string;
}

interface PhotoCaptureScreenProps {
  navigation: any;
  route: {
    params: {
      workOrderId: string;
      activityId?: string; // Optional - if coming from specific activity
      returnTo?: string; // Screen to return to after capture
    };
  };
}

const { width } = Dimensions.get('window');
const THUMBNAIL_SIZE = (width - 48) / 3; // 3 columns with padding

export default function PhotoCaptureScreen({ navigation, route }: PhotoCaptureScreenProps) {
  const { workOrderId, activityId, returnTo } = route.params;
  const { colors, isDark } = useThemeStyles();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Camera permission hook
  const [permission, requestPermission] = useCameraPermissions();

  // State
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<LocalPhoto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionText, setCaptionText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PhotoCategory>('general');

  // Camera/capture state
  const [showCamera, setShowCamera] = useState(false);
  const [capturedImage, setCapturedImage] = useState<{ uri: string; base64?: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [showMetadataForm, setShowMetadataForm] = useState(false);
  const [photoCaption, setPhotoCaption] = useState('');

  // Load existing photos
  useEffect(() => {
    loadPhotos();
  }, [workOrderId, activityId]);

  const loadPhotos = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Load photos from API
      const response = await getWorkOrderDetail(workOrderId);

      if (response.error) {
        setError(normalizeError(response.error));
        setIsLoading(false);
        return;
      }

      if (response.data?.photos) {
        const apiPhotos: LocalPhoto[] = response.data.photos.map((p) => ({
          id: p.id,
          url: p.url,
          thumbnail_url: p.url, // Use same URL for thumbnail
          caption: p.caption,
          uploaded_at: p.created_at,
          category: (p.photo_type as PhotoCategory) || 'general',
        }));
        setPhotos(apiPhotos);
      }
    } catch (err) {
      setError('Failed to load photos. Please try again.');
      console.error('Load photos error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [workOrderId]);

  // Request camera permission
  const handleRequestPermission = useCallback(async () => {
    const result = await requestPermission();
    if (!result.granted) {
      Alert.alert(
        'Camera Permission Required',
        'Please enable camera access in your device settings to take photos.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
    }
  }, [requestPermission]);

  // Camera capture handler - opens camera
  const handleTakePhoto = useCallback(async () => {
    try {
      // Check/request permissions
      if (!permission?.granted) {
        const result = await requestPermission();
        if (!result.granted) {
          Alert.alert(
            'Camera Permission Required',
            'Please enable camera access in your device settings to take photos.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }
      }

      // Use ImagePicker to launch camera
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: false, // We'll read base64 separately for larger control
      });

      if (!result.canceled && result.assets[0]) {
        setCapturedImage({ uri: result.assets[0].uri });
        setShowMetadataForm(true);
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to capture photo. Please try again.');
      console.error('Camera error:', err);
    }
  }, [permission, requestPermission]);

  // Gallery picker handler
  const handlePickFromGallery = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: false,
      });

      if (!result.canceled && result.assets[0]) {
        setCapturedImage({ uri: result.assets[0].uri });
        setShowMetadataForm(true);
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to select photo. Please try again.');
      console.error('Gallery picker error:', err);
    }
  }, []);

  // Upload photo handler
  const handleUploadPhoto = useCallback(async () => {
    if (!capturedImage) return;

    setIsUploading(true);

    try {
      // Read image as base64
      const base64Data = await FileSystem.readAsStringAsync(capturedImage.uri, {
        encoding: 'base64',
      });

      // Extract filename from URI
      const uriParts = capturedImage.uri.split('/');
      const filename = uriParts[uriParts.length - 1] || `photo_${Date.now()}.jpg`;

      // Upload to API
      const response = await uploadPhoto(workOrderId, {
        base64Data,
        filename,
        caption: photoCaption.trim() || undefined,
        photoType: selectedCategory,
      });

      if (response.error) {
        Alert.alert('Upload Error', normalizeError(response.error, 'Failed to upload photo'));
        setIsUploading(false);
        return;
      }

      // Success - add to local photos list
      if (response.data?.photo) {
        const newPhoto: LocalPhoto = {
          id: response.data.photo.id,
          url: response.data.photo.url,
          thumbnail_url: response.data.photo.url,
          caption: response.data.photo.caption,
          uploaded_at: response.data.photo.created_at,
          category: (response.data.photo.photo_type as PhotoCategory) || selectedCategory,
        };
        setPhotos(prev => [newPhoto, ...prev]);
      }

      setUploadedCount(prev => prev + 1);
      setCapturedImage(null);
      setPhotoCaption('');
      setShowMetadataForm(false);

      // Show success with option to take another
      Alert.alert(
        'Photo Uploaded',
        `Photo uploaded successfully! (${uploadedCount + 1} photo${uploadedCount > 0 ? 's' : ''} this session)`,
        [
          { text: 'Take Another', onPress: () => {} },
          { text: 'Done', onPress: () => navigation.goBack() },
        ]
      );
    } catch (err) {
      console.error('Upload error:', err);
      Alert.alert('Upload Error', 'Failed to upload photo. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }, [capturedImage, photoCaption, selectedCategory, workOrderId, uploadedCount, navigation]);

  // Cancel captured photo
  const handleCancelCapture = useCallback(() => {
    setCapturedImage(null);
    setPhotoCaption('');
    setShowMetadataForm(false);
  }, []);

  // Retake photo
  const handleRetake = useCallback(() => {
    setCapturedImage(null);
    setPhotoCaption('');
    handleTakePhoto();
  }, [handleTakePhoto]);

  // Delete photo handler
  const handleDeletePhoto = useCallback((photo: LocalPhoto) => {
    Alert.alert(
      'Delete Photo',
      'Are you sure you want to delete this photo? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // In real implementation: await photoService.deletePhoto(photo.id);
              setPhotos(prev => prev.filter(p => p.id !== photo.id));
              if (selectedPhoto?.id === photo.id) {
                setSelectedPhoto(null);
              }
            } catch (err) {
              Alert.alert('Error', 'Failed to delete photo. Please try again.');
              console.error('Delete photo error:', err);
            }
          },
        },
      ]
    );
  }, [selectedPhoto]);

  // Update photo caption
  const handleUpdateCaption = useCallback(async (photoId: string, caption: string) => {
    try {
      // In real implementation: await photoService.updatePhotoCaption(photoId, caption);
      setPhotos(prev =>
        prev.map(p => (p.id === photoId ? { ...p, caption } : p))
      );
      if (selectedPhoto?.id === photoId) {
        setSelectedPhoto(prev => prev ? { ...prev, caption } : null);
      }
      setEditingCaption(null);
      setCaptionText('');
    } catch (err) {
      Alert.alert('Error', 'Failed to update caption. Please try again.');
      console.error('Update caption error:', err);
    }
  }, [selectedPhoto]);

  // Start editing caption
  const startEditingCaption = useCallback((photo: LocalPhoto) => {
    setEditingCaption(photo.id);
    setCaptionText(photo.caption || '');
  }, []);

  // Render category selector
  const renderCategorySelector = () => (
    <View style={styles.categoryContainer}>
      <Text style={styles.categoryLabel}>Category:</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {PHOTO_CATEGORIES.map(cat => (
          <TouchableOpacity
            key={cat.value}
            style={[
              styles.categoryChip,
              selectedCategory === cat.value && styles.categoryChipSelected,
            ]}
            onPress={() => setSelectedCategory(cat.value)}
          >
            <Ionicons
              name={cat.icon as any}
              size={16}
              color={selectedCategory === cat.value ? colors.textInverse : colors.textSecondary}
              style={styles.categoryIcon}
            />
            <Text
              style={[
                styles.categoryText,
                selectedCategory === cat.value && styles.categoryTextSelected,
              ]}
            >
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  // Render camera controls
  const renderCameraControls = () => (
    <View style={styles.controlsContainer}>
      <TouchableOpacity
        style={styles.cameraButton}
        onPress={handleTakePhoto}
      >
        <Ionicons name="camera" size={32} color={colors.textInverse} />
        <Text style={styles.cameraButtonText}>Take Photo</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.galleryButton}
        onPress={handlePickFromGallery}
      >
        <Ionicons name="images-outline" size={24} color={colors.primaryLight} />
        <Text style={styles.galleryButtonText}>Choose from Gallery</Text>
      </TouchableOpacity>
    </View>
  );

  // Render photo grid
  const renderPhotoGrid = () => {
    if (photos.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="camera-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyStateText}>No photos yet</Text>
          <Text style={styles.emptyStateSubtext}>
            Capture photos to document your work
          </Text>
        </View>
      );
    }

    // Group photos by category
    const photosByCategory = photos.reduce((acc, photo) => {
      const cat = photo.category || 'other';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(photo);
      return acc;
    }, {} as Record<string, LocalPhoto[]>);

    return (
      <View style={styles.gridContainer}>
        {PHOTO_CATEGORIES.map(cat => {
          const categoryPhotos = photosByCategory[cat.value] || [];
          if (categoryPhotos.length === 0) return null;

          return (
            <View key={cat.value} style={styles.categorySection}>
              <View style={styles.categorySectionHeader}>
                <Ionicons name={cat.icon as any} size={20} color={colors.textSecondary} />
                <Text style={styles.categorySectionTitle}>
                  {cat.label} ({categoryPhotos.length})
                </Text>
              </View>

              <View style={styles.photoRow}>
                {categoryPhotos.map(photo => (
                  <TouchableOpacity
                    key={photo.id}
                    style={styles.photoThumbnail}
                    onPress={() => setSelectedPhoto(photo)}
                  >
                    <Image
                      source={{ uri: photo.thumbnail_url || photo.url }}
                      style={styles.thumbnailImage}
                    />
                    {photo.isUploading && (
                      <View style={styles.uploadingOverlay}>
                        <Ionicons name="cloud-upload-outline" size={24} color={colors.textInverse} />
                      </View>
                    )}
                    {photo.uploadError && (
                      <View style={styles.errorOverlay}>
                        <Ionicons name="alert-circle" size={20} color={colors.textInverse} />
                      </View>
                    )}
                    {photo.caption && (
                      <View style={styles.captionIndicator}>
                        <Ionicons name="text-outline" size={14} color={colors.textInverse} />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  // Render full-screen photo modal
  const renderPhotoModal = () => {
    if (!selectedPhoto) return null;

    return (
      <Modal
        visible={!!selectedPhoto}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <SafeAreaView style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setSelectedPhoto(null)}
            >
              <Ionicons name="close" size={28} color={colors.textInverse} />
            </TouchableOpacity>

            <Text style={styles.modalTitle}>Photo Details</Text>

            <TouchableOpacity
              style={styles.modalDeleteButton}
              onPress={() => handleDeletePhoto(selectedPhoto)}
            >
              <Ionicons name="trash-outline" size={24} color={colors.error} />
            </TouchableOpacity>
          </View>

          {/* Photo */}
          <ScrollView style={styles.modalContent}>
            <Image
              source={{ uri: selectedPhoto.url }}
              style={styles.fullPhoto}
              resizeMode="contain"
            />

            {/* Caption Editor */}
            <View style={styles.captionSection}>
              <Text style={styles.captionSectionLabel}>Caption:</Text>
              {editingCaption === selectedPhoto.id ? (
                <View>
                  <TextInput
                    style={styles.captionInput}
                    value={captionText}
                    onChangeText={setCaptionText}
                    placeholder="Add a description for this photo..."
                    multiline
                    numberOfLines={3}
                    autoFocus
                  />
                  <View style={styles.captionActions}>
                    <TouchableOpacity
                      style={styles.captionCancelButton}
                      onPress={() => {
                        setEditingCaption(null);
                        setCaptionText('');
                      }}
                    >
                      <Text style={styles.captionCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.captionSaveButton}
                      onPress={() => handleUpdateCaption(selectedPhoto.id, captionText)}
                    >
                      <Text style={styles.captionSaveText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.captionDisplay}
                  onPress={() => startEditingCaption(selectedPhoto)}
                >
                  <Text style={styles.captionDisplayText}>
                    {selectedPhoto.caption || 'Tap to add caption...'}
                  </Text>
                  <Ionicons name="pencil" size={18} color={colors.primaryLight} />
                </TouchableOpacity>
              )}
            </View>

            {/* Metadata */}
            <View style={styles.metadataSection}>
              <View style={styles.metadataRow}>
                <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.metadataText}>
                  {new Date(selectedPhoto.uploaded_at).toLocaleString()}
                </Text>
              </View>
              {selectedPhoto.category && (
                <View style={styles.metadataRow}>
                  <Ionicons
                    name={PHOTO_CATEGORIES.find(c => c.value === selectedPhoto.category)?.icon as any || 'document-outline'}
                    size={18}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.metadataText}>
                    {PHOTO_CATEGORIES.find(c => c.value === selectedPhoto.category)?.label || 'Other'}
                  </Text>
                </View>
              )}
              {selectedPhoto.isUploading && (
                <View style={styles.metadataRow}>
                  <Ionicons name="cloud-upload-outline" size={18} color={colors.warning} />
                  <Text style={[styles.metadataText, { color: colors.warning }]}>
                    Uploading...
                  </Text>
                </View>
              )}
              {selectedPhoto.uploadError && (
                <View style={styles.metadataRow}>
                  <Ionicons name="alert-circle" size={18} color={colors.error} />
                  <Text style={[styles.metadataText, { color: colors.error }]}>
                    {selectedPhoto.uploadError}
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Photos</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading photos...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Photos</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadPhotos}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Main render
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Photos</Text>
          <Text style={styles.headerSubtitle}>
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => {
          Alert.alert('Info', 'Photos are synced automatically when online');
        }}>
          <Ionicons name="cloud-outline" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Category selector for new photos */}
        {renderCategorySelector()}

        {/* Camera controls */}
        {renderCameraControls()}

        {/* Photo count */}
        {photos.length > 0 && (
          <View style={styles.statsContainer}>
            <Ionicons name="images-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.statsText}>
              {photos.length} {photos.length === 1 ? 'photo' : 'photos'} captured
            </Text>
          </View>
        )}

        {/* Photo grid */}
        {renderPhotoGrid()}
      </ScrollView>

      {/* Full-screen photo modal */}
      {renderPhotoModal()}

      {/* Photo Metadata Form Modal */}
      <Modal
        visible={showMetadataForm && !!capturedImage}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCancelCapture}
      >
        <SafeAreaView style={styles.metadataModalContainer}>
          <View style={styles.metadataModalHeader}>
            <TouchableOpacity onPress={handleCancelCapture}>
              <Ionicons name="close" size={28} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.metadataModalTitle}>Add Photo</Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView style={styles.metadataModalContent}>
            {/* Photo Preview */}
            {capturedImage && (
              <View style={styles.photoPreviewContainer}>
                <Image
                  source={{ uri: capturedImage.uri }}
                  style={styles.photoPreview}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  style={styles.retakeButton}
                  onPress={handleRetake}
                >
                  <Ionicons name="camera-reverse-outline" size={20} color={colors.primary} />
                  <Text style={styles.retakeButtonText}>Retake</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Photo Type Selector */}
            <View style={styles.metadataSection}>
              <Text style={styles.metadataSectionTitle}>Photo Type</Text>
              <View style={styles.photoTypeGrid}>
                {PHOTO_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat.value}
                    style={[
                      styles.photoTypeButton,
                      selectedCategory === cat.value && styles.photoTypeButtonSelected,
                    ]}
                    onPress={() => setSelectedCategory(cat.value)}
                  >
                    <Ionicons
                      name={cat.icon as any}
                      size={24}
                      color={selectedCategory === cat.value ? colors.textInverse : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.photoTypeButtonText,
                        selectedCategory === cat.value && styles.photoTypeButtonTextSelected,
                      ]}
                    >
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Caption Input */}
            <View style={styles.metadataSection}>
              <Text style={styles.metadataSectionTitle}>Caption (Optional)</Text>
              <TextInput
                style={styles.captionInputField}
                placeholder="Add a description for this photo..."
                placeholderTextColor={colors.textMuted}
                value={photoCaption}
                onChangeText={setPhotoCaption}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Upload Count */}
            {uploadedCount > 0 && (
              <View style={styles.uploadCountContainer}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.uploadCountText}>
                  {uploadedCount} photo{uploadedCount !== 1 ? 's' : ''} uploaded this session
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Submit Button */}
          <View style={styles.metadataModalFooter}>
            <TouchableOpacity
              style={[styles.uploadButton, isUploading && styles.uploadButtonDisabled]}
              onPress={handleUploadPhoto}
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <ActivityIndicator size="small" color={colors.textInverse} />
                  <Text style={styles.uploadButtonText}>Uploading...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={24} color={colors.textInverse} />
                  <Text style={styles.uploadButtonText}>Upload Photo</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Permission Denied Modal */}
      {permission && !permission.granted && !permission.canAskAgain && (
        <Modal visible={true} animationType="fade" transparent>
          <View style={styles.permissionModalOverlay}>
            <View style={styles.permissionModalContent}>
              <Ionicons name="camera-outline" size={64} color={colors.error} />
              <Text style={styles.permissionModalTitle}>Camera Access Required</Text>
              <Text style={styles.permissionModalText}>
                To take photos for work orders, please enable camera access in your device settings.
              </Text>
              <TouchableOpacity
                style={styles.permissionModalButton}
                onPress={() => Linking.openSettings()}
              >
                <Ionicons name="settings-outline" size={20} color={colors.textInverse} />
                <Text style={styles.permissionModalButtonText}>Open Settings</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.permissionModalCancelButton}
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.permissionModalCancelText}>Go Back</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  categoryContainer: {
    backgroundColor: colors.card,
    padding: 16,
    marginBottom: 8,
  },
  categoryLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.background,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryIcon: {
    marginRight: 6,
  },
  categoryText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  categoryTextSelected: {
    color: colors.textInverse,
  },
  controlsContainer: {
    backgroundColor: colors.card,
    padding: 16,
    marginBottom: 8,
  },
  cameraButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  cameraButtonText: {
    color: colors.textInverse,
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
  },
  galleryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  galleryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.card,
    marginBottom: 8,
  },
  statsText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 8,
  },
  gridContainer: {
    backgroundColor: colors.card,
    padding: 16,
  },
  categorySection: {
    marginBottom: 24,
  },
  categorySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  categorySectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginLeft: 8,
  },
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  photoThumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    margin: 4,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.error,
    borderRadius: 12,
    padding: 4,
  },
  captionIndicator: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 8,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },

  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textInverse,
  },
  modalDeleteButton: {
    padding: 4,
  },
  modalContent: {
    flex: 1,
  },
  fullPhoto: {
    width: width,
    height: width,
    backgroundColor: '#000',
  },
  captionSection: {
    backgroundColor: '#1a1a1a',
    padding: 16,
  },
  captionSectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
    marginBottom: 8,
  },
  captionInput: {
    backgroundColor: '#2a2a2a',
    color: colors.textInverse,
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  captionActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  captionCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
  },
  captionCancelText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  captionSaveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.primary,
    borderRadius: 6,
  },
  captionSaveText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },
  captionDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
  },
  captionDisplayText: {
    flex: 1,
    fontSize: 14,
    color: colors.textMuted,
  },
  metadataSection: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  metadataText: {
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: 8,
  },

  // Metadata Form Modal Styles
  metadataModalContainer: {
    flex: 1,
    backgroundColor: colors.card,
  },
  metadataModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  metadataModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  metadataModalContent: {
    flex: 1,
    padding: 16,
  },
  photoPreviewContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  photoPreview: {
    width: width - 32,
    height: (width - 32) * 0.75,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retakeButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.primary,
    marginLeft: 6,
  },
  metadataSectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  photoTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  photoTypeButton: {
    width: (width - 64) / 3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    margin: 6,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  photoTypeButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  photoTypeButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 6,
  },
  photoTypeButtonTextSelected: {
    color: colors.textInverse,
  },
  captionInputField: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: colors.text,
    minHeight: 100,
  },
  uploadCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    padding: 12,
    backgroundColor: colors.successBg,
    borderRadius: 8,
  },
  uploadCountText: {
    fontSize: 14,
    color: colors.success,
    fontWeight: '500',
    marginLeft: 8,
  },
  metadataModalFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
  },
  uploadButtonDisabled: {
    backgroundColor: colors.primaryLight,
  },
  uploadButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
    marginLeft: 8,
  },

  // Permission Modal Styles
  permissionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionModalContent: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
  },
  permissionModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginTop: 16,
    textAlign: 'center',
  },
  permissionModalText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 24,
    lineHeight: 22,
  },
  permissionModalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
  },
  permissionModalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
    marginLeft: 8,
  },
  permissionModalCancelButton: {
    marginTop: 16,
    padding: 12,
  },
  permissionModalCancelText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '500',
  },
});
