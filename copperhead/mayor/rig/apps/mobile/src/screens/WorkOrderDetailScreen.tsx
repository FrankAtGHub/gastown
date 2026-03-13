/**
 * M3: Work Order Detail Screen
 *
 * Displays comprehensive work order details for technicians.
 * This screen is the central hub for all work order operations.
 *
 * Navigation Flow:
 * - M2 (Work Order List) → M3 (Work Order Detail) → M4, M8, M9 (future screens)
 *
 * Features:
 * - Full work order information display
 * - Status indicator with state machine awareness
 * - Customer contact information (call/navigate actions)
 * - Schedule information (scheduled and actual times)
 * - Quick action buttons (Photos, Notes, Time, Parts)
 * - Task checklist with completion tracking
 * - Offline banner
 * - Status update capabilities (placeholder for state machine integration)
 * - Equipment/asset display (when available)
 *
 * Uses shared-domain types:
 * - WorkOrder entity with nested Customer
 * - WorkOrderState enum for status values
 * - WorkOrderStateMachine for valid transitions (future)
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
  Linking,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WorkOrder } from '@field-ops/shared-domain';
import { WorkOrderState } from '@field-ops/shared-domain';
import { useThemeStyles } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import {
  getWorkOrderDetail,
  updateWorkOrderStatus,
  addNote,
  getUnreadCounts,
  createChangeOrderRequest,
  getWorkOrderDocuments,
  getWorkOrderCrew,
  selfClockIn,
  selfClockOut,
  TimeEntry,
  Note,
  Photo,
  WorkOrderFullDetail,
  WorkOrderDocument,
} from '../services/api.service';
import { normalizeError } from '../utils/errorUtils';

const GOOGLE_MAPS_API_KEY = 'AIzaSyBxxxyBk-c2U2WRPXmlYMgfi8m3fQX48LI';

// Status color mapping matching StatusIndicator component
const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  DRAFT: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  SCHEDULED: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  ACCEPTED: { bg: '#cffafe', text: '#155e75', border: '#67e8f9' },
  TRAVELING: { bg: '#e9d5ff', text: '#6b21a8', border: '#c084fc' },
  IN_PROGRESS: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  WAITING: { bg: '#fed7aa', text: '#9a3412', border: '#fdba74' },
  COMPLETED: { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
  URGENT: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  CANCELLED: { bg: '#f3f4f6', text: '#4b5563', border: '#d1d5db' },
};

const priorityColors: Record<string, string> = {
  low: '#6b7280',
  medium: '#2563eb',
  high: '#f59e0b',
  urgent: '#ef4444',
};

interface WorkOrderDetailScreenProps {
  route: {
    params?: {
      workOrder?: WorkOrder;
      workOrderId?: string;
    };
  };
  navigation: any;
}

export default function WorkOrderDetailScreen({
  route,
  navigation,
}: WorkOrderDetailScreenProps) {
  const { workOrder: initialWorkOrder, workOrderId } = route.params || {};
  const { colors, isDark } = useThemeStyles();
  const { user } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Create a minimal work order if none provided (e.g., deep linking)
  const defaultWorkOrder = {
    id: workOrderId || initialWorkOrder?.id || '',
    tenant_id: '',
    work_order_number: initialWorkOrder?.work_order_number || '',
    customer_id: '',
    assigned_to: '',
    created_by: '',
    title: initialWorkOrder?.title || 'Loading...',
    description: initialWorkOrder?.description || '',
    priority: initialWorkOrder?.priority || 'medium',
    status: initialWorkOrder?.status || 'SCHEDULED',
    work_type: initialWorkOrder?.work_type || '',
    scheduled_start: initialWorkOrder?.scheduled_start || new Date().toISOString(),
    scheduled_end: initialWorkOrder?.scheduled_end || null,
    service_address_line1: initialWorkOrder?.service_address_line1 || '',
    service_city: initialWorkOrder?.service_city || '',
    service_state: initialWorkOrder?.service_state || '',
    service_postal_code: initialWorkOrder?.service_postal_code || '',
  } as unknown as WorkOrder;

  const [workOrder, setWorkOrder] = useState<WorkOrder>(initialWorkOrder || defaultWorkOrder);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // API data state
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);

  // Status update state
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusButtonLoading, setStatusButtonLoading] = useState<string | null>(null);

  // Site access instructions expandable state
  const [showAccessInstructions, setShowAccessInstructions] = useState(false);

  // Add note modal state
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  // Change order request modal state
  const [showChangeOrderModal, setShowChangeOrderModal] = useState(false);
  const [changeOrderDescription, setChangeOrderDescription] = useState('');
  const [changeOrderUrgency, setChangeOrderUrgency] = useState<'normal' | 'urgent'>('normal');
  const [isSubmittingChangeOrder, setIsSubmittingChangeOrder] = useState(false);

  // Unread messages count
  const [unreadCount, setUnreadCount] = useState(0);

  // Documents state (files & drawings from source estimate)
  const [documents, setDocuments] = useState<{
    files: WorkOrderDocument[];
    drawings: WorkOrderDocument[];
  }>({ files: [], drawings: [] });
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [showDocumentsModal, setShowDocumentsModal] = useState(false);

  // Crew clock-in state
  const [crewClockedInCount, setCrewClockedInCount] = useState(0);
  const [crewSize, setCrewSize] = useState(0);

  // Self clock-in state (crew member on own device)
  const [isCrewMember, setIsCrewMember] = useState(false);
  const [isSelfClockedIn, setIsSelfClockedIn] = useState(false);
  const [isSelfClocking, setIsSelfClocking] = useState(false);

  // Load full work order details from API when screen mounts
  const workOrderIdToLoad = workOrderId || initialWorkOrder?.id || workOrder.id;
  useEffect(() => {
    if (workOrderIdToLoad) {
      loadWorkOrderDetails();
      // Load unread message count
      loadUnreadCount();
      // Load crew clock-in count for badge
      loadCrewStatus();
    }
  }, [workOrderIdToLoad]);

  // Load unread message count
  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await getUnreadCounts();
      if (response.data && workOrderIdToLoad) {
        setUnreadCount(response.data[workOrderIdToLoad] || 0);
      }
    } catch (err) {
      console.error('Failed to load unread counts:', err);
    }
  }, [workOrderIdToLoad]);

  // Load crew status for badge count + self-clock state
  const loadCrewStatus = useCallback(async () => {
    const idToLoad = workOrderId || initialWorkOrder?.id || workOrder.id;
    if (!idToLoad) return;
    try {
      const response = await getWorkOrderCrew(idToLoad);
      if (response.data?.crew) {
        const crew = response.data.crew;
        setCrewSize(crew.length);
        setCrewClockedInCount(crew.filter((m: any) => m.is_clocked_in).length);

        // Check if current user is in the crew list
        if (user?.id) {
          const myEntry = crew.find((m: any) => m.technician_id === user.id);
          setIsCrewMember(!!myEntry);
          setIsSelfClockedIn(!!myEntry?.is_clocked_in);
        }
      }
    } catch (err) {
      // Silent fail — badge is optional
    }
  }, [workOrderId, initialWorkOrder?.id, workOrder.id, user?.id]);

  // Load documents (files & drawings from source estimate)
  const loadDocuments = useCallback(async () => {
    const idToLoad = workOrderId || initialWorkOrder?.id || workOrder.id;
    if (!idToLoad) return;

    setIsLoadingDocuments(true);
    try {
      const response = await getWorkOrderDocuments(idToLoad);
      if (response.data) {
        setDocuments({
          files: response.data.files || [],
          drawings: response.data.drawings || [],
        });
      }
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [workOrderId, initialWorkOrder?.id, workOrder.id]);

  // Open document in external app (PDF viewer, image viewer, etc.)
  const openDocument = useCallback(async (doc: WorkOrderDocument) => {
    try {
      // Construct full URL for the document
      const baseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001/api';
      const fullUrl = `${baseUrl.replace('/api', '')}${doc.downloadUrl}`;

      const canOpen = await Linking.canOpenURL(fullUrl);
      if (canOpen) {
        await Linking.openURL(fullUrl);
      } else {
        Alert.alert(
          'Cannot Open',
          `Unable to open this file type (${doc.mimeType}). Try downloading to device first.`
        );
      }
    } catch (err) {
      console.error('Error opening document:', err);
      Alert.alert('Error', 'Failed to open document');
    }
  }, []);

  // Handle documents button press
  const handleViewDocuments = useCallback(() => {
    setShowDocumentsModal(true);
    if (documents.files.length === 0 && documents.drawings.length === 0) {
      loadDocuments();
    }
  }, [documents.files.length, documents.drawings.length, loadDocuments]);

  const loadWorkOrderDetails = useCallback(async (showRefreshing = false) => {
    const idToLoad = workOrderId || initialWorkOrder?.id || workOrder.id;
    if (!idToLoad) {
      setError('No work order ID provided');
      setIsLoading(false);
      return;
    }

    if (showRefreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await getWorkOrderDetail(idToLoad);

      if (response.error) {
        setError(normalizeError(response.error));
        setIsOffline(true);
        // Keep using initial work order data on error
        return;
      }

      // Handle both wrapped {data: {workOrder}} and flat {workOrder} response shapes
      const payload = response.data?.workOrder ? response.data : (response.data as any)?.data;
      if (payload?.workOrder) {
        // Map API response to local state
        const apiWo = payload.workOrder;

        // Update work order with API data while preserving domain structure
        setWorkOrder(prev => ({
          ...prev,
          title: apiWo.title,
          description: apiWo.description,
          status: apiWo.status?.toUpperCase() as any,
          priority: apiWo.priority as any,
          work_type: apiWo.work_type || prev.work_type,
          updated_at: apiWo.updated_at,
          // Service address (from WO, falls back to customer via COALESCE on server)
          service_address_line1: apiWo.service_address_line1 || apiWo.customer_address || prev.service_address_line1,
          service_city: apiWo.service_city || apiWo.customer_city || prev.service_city,
          service_state: apiWo.service_state || apiWo.customer_state || prev.service_state,
          service_postal_code: apiWo.service_postal_code || apiWo.customer_postal_code || prev.service_postal_code,
          // Customer info (flat fields from API)
          customer_name: apiWo.customer_name || (prev as any).customer_name,
          customer_phone: apiWo.customer_phone || (prev as any).customer_phone,
          customer_email: apiWo.customer_email || (prev as any).customer_email,
          customer_contact_name: apiWo.customer_contact_name || (prev as any).customer_contact_name,
          // Estimate-sourced fields
          estimated_hours: apiWo.estimated_hours || (prev as any).estimated_hours,
          actual_hours: apiWo.actual_hours || (prev as any).actual_hours,
          phase_type: apiWo.phase_type || (prev as any).phase_type,
          market: apiWo.market || (prev as any).market,
          reference_number: apiWo.reference_number || (prev as any).reference_number,
          parts_status: apiWo.parts_status || (prev as any).parts_status,
          waiting_reason: apiWo.waiting_reason || (prev as any).waiting_reason,
          notes: apiWo.notes || (prev as any).notes,
          internal_notes: apiWo.internal_notes || (prev as any).internal_notes,
          signature_url: apiWo.signature_url || (prev as any).signature_url,
          signature_name: apiWo.signature_name || (prev as any).signature_name,
          signature_date: apiWo.signature_date || (prev as any).signature_date,
          // Site fields (from sites JOIN)
          site_id: apiWo.site_id || (prev as any).site_id,
          site_name: apiWo.site_name || (prev as any).site_name,
          site_access_instructions: apiWo.site_access_instructions || (prev as any).site_access_instructions,
          site_latitude: apiWo.site_latitude ?? (prev as any).site_latitude,
          site_longitude: apiWo.site_longitude ?? (prev as any).site_longitude,
          site_street_view_url: apiWo.site_street_view_url || (prev as any).site_street_view_url,
          site_street_view_status: apiWo.site_street_view_status || (prev as any).site_street_view_status,
          // Tasks from detail response
          tasks: (payload as any).tasks || [],
          // Build nested customer for display components
          customer: {
            ...(prev.customer || {}),
            company_name: apiWo.customer_name,
            phone: apiWo.customer_phone,
            email: apiWo.customer_email,
            mobile: apiWo.customer_phone,
          },
        } as WorkOrder));

        // Set related data
        setTimeEntries(response.data.timeEntries || []);
        setNotes(response.data.notes || []);
        setPhotos(response.data.photos || []);
        setIsOffline(false);
      }
    } catch (err) {
      setError('Failed to load work order details');
      setIsOffline(true);
      console.error('Error loading work order:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [workOrderId, initialWorkOrder?.id, workOrder.id]);

  const onRefresh = useCallback(() => {
    loadWorkOrderDetails(true);
  }, [loadWorkOrderDetails]);

  // Format address for display
  const formatAddress = useCallback(() => {
    const parts = [
      workOrder.service_address_line1,
      workOrder.service_address_line2,
      workOrder.service_city,
      workOrder.service_state,
      workOrder.service_postal_code,
    ].filter(Boolean);
    return parts.join(', ');
  }, [workOrder]);

  // Format customer name — prefer flat API field, fall back to nested customer
  const getCustomerName = useCallback(() => {
    if ((workOrder as any).customer_name) return (workOrder as any).customer_name;
    if (!workOrder.customer) return 'Unknown Customer';
    if (workOrder.customer.company_name) {
      return workOrder.customer.company_name;
    }
    if (workOrder.customer.first_name || workOrder.customer.last_name) {
      return `${workOrder.customer.first_name || ''} ${workOrder.customer.last_name || ''}`.trim();
    }
    return 'Unknown Customer';
  }, [workOrder]);

  // Format date/time
  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Format time only
  const formatTime = (dateString: string | null) => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Handle phone call — check flat API fields first, then nested customer
  const handleCall = useCallback(() => {
    const phoneNumber = (workOrder as any).customer_phone || workOrder.customer?.phone || workOrder.customer?.mobile;
    if (!phoneNumber) {
      Alert.alert('No Phone Number', 'Customer phone number is not available.');
      return;
    }

    const phoneUrl = `tel:${phoneNumber}`;
    Linking.canOpenURL(phoneUrl).then((supported) => {
      if (supported) {
        Linking.openURL(phoneUrl);
      } else {
        Alert.alert('Error', 'Unable to make phone calls on this device.');
      }
    });
  }, [workOrder]);

  // Handle navigation to address — prefer site lat/lng for precise navigation
  const handleNavigate = useCallback(() => {
    const lat = (workOrder as any).site_latitude;
    const lng = (workOrder as any).site_longitude;
    const hasCoords = lat != null && lng != null;
    const address = formatAddress();

    if (!hasCoords && !address) {
      Alert.alert('No Address', 'Service address is not available.');
      return;
    }

    let url: string;
    if (hasCoords) {
      // Use precise coordinates from site
      if (Platform.OS === 'ios') {
        url = `maps:?ll=${lat},${lng}&q=${encodeURIComponent(address || 'Job Site')}`;
      } else if (Platform.OS === 'android') {
        url = `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(address || 'Job Site')})`;
      } else {
        url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      }
    } else {
      // Fallback to address string
      if (Platform.OS === 'ios') {
        url = `maps:?address=${encodeURIComponent(address)}`;
      } else if (Platform.OS === 'android') {
        url = `geo:0,0?q=${encodeURIComponent(address)}`;
      } else {
        url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
      }
    }

    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Unable to open maps on this device.');
    });
  }, [workOrder, formatAddress]);

  // Handle status update via API
  const handleStatusChange = useCallback(async (newStatus: string) => {
    setStatusButtonLoading(newStatus);
    setIsUpdatingStatus(true);

    try {
      const response = await updateWorkOrderStatus(workOrder.id, newStatus);

      if (response.error) {
        Alert.alert('Error', normalizeError(response.error, 'Failed to update status'));
        return;
      }

      if (response.data) {
        // Update local state with new status
        setWorkOrder(prev => ({
          ...prev,
          status: response.data!.workOrder.status.toUpperCase() as any,
        }));

        // Reload full details to get updated data
        loadWorkOrderDetails(true);
      }
    } catch (err) {
      console.error('Status update error:', err);
      Alert.alert('Error', 'Failed to update status. Please try again.');
    } finally {
      setStatusButtonLoading(null);
      setIsUpdatingStatus(false);
    }
  }, [workOrder.id, loadWorkOrderDetails]);

  // En Route button handler
  const handleEnRoute = useCallback(() => {
    Alert.alert(
      'Start Travel',
      'Mark yourself as en route to this job?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'En Route', onPress: () => handleStatusChange('traveling') },
      ]
    );
  }, [handleStatusChange]);

  // Start Job button handler
  const handleStartJob = useCallback(() => {
    Alert.alert(
      'Start Work',
      'Before starting work, complete the safety checklist or start directly.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Safety Checklist',
          onPress: () => {
            navigation.navigate('WorkOrderSafety', {
              workOrderId: workOrder.id,
              workOrderNumber: workOrder.work_order_number,
              workOrderState: workOrder.status,
              workType: workOrder.work_type,
            });
          },
        },
        { text: 'Start Now', onPress: () => handleStatusChange('in_progress') },
      ]
    );
  }, [workOrder.id, workOrder.work_order_number, workOrder.status, workOrder.work_type, navigation, handleStatusChange]);

  // Complete button handler (goes to signature screen)
  const handleComplete = useCallback(() => {
    navigation.navigate('WorkOrderSignature', {
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.work_order_number,
    });
  }, [navigation, workOrder.id, workOrder.work_order_number]);

  // Handle status update (legacy - shows menu)
  const handleStatusUpdate = useCallback(() => {
    const currentStatus = workOrder.status.toUpperCase();

    // Show options based on current status
    if (currentStatus === 'SCHEDULED' || currentStatus === 'ACCEPTED') {
      handleEnRoute();
    } else if (currentStatus === 'TRAVELING') {
      handleStartJob();
    } else if (currentStatus === 'IN_PROGRESS') {
      handleComplete();
    }
  }, [workOrder.status, handleEnRoute, handleStartJob, handleComplete]);

  // Add note handler
  const handleAddNoteSubmit = useCallback(async () => {
    if (!noteText.trim()) {
      Alert.alert('Error', 'Please enter a note.');
      return;
    }

    setIsAddingNote(true);

    try {
      const response = await addNote(workOrder.id, noteText.trim(), false);

      if (response.error) {
        Alert.alert('Error', normalizeError(response.error, 'Failed to add note'));
        return;
      }

      if (response.data) {
        // Create a proper Note object from the response
        const newNote: Note = {
          id: `note-${Date.now()}`,
          content: typeof response.data.note === 'string' ? response.data.note : noteText.trim(),
          created_at: response.data.addedAt || new Date().toISOString(),
          user_name: 'You',
          is_internal: false,
        };
        setNotes(prev => [newNote, ...prev]);
        setNoteText('');
        setShowNoteModal(false);
        Alert.alert('Success', 'Note added successfully.');
      }
    } catch (err) {
      console.error('Add note error:', err);
      Alert.alert('Error', 'Failed to add note. Please try again.');
    } finally {
      setIsAddingNote(false);
    }
  }, [workOrder.id, noteText]);

  // Handle change order request submission
  const handleSubmitChangeOrder = useCallback(async () => {
    if (!changeOrderDescription.trim() || changeOrderDescription.trim().length < 10) {
      Alert.alert('Error', 'Please provide a description of at least 10 characters.');
      return;
    }

    setIsSubmittingChangeOrder(true);

    try {
      const response = await createChangeOrderRequest(workOrder.id, {
        description: changeOrderDescription.trim(),
        urgency: changeOrderUrgency,
      });

      if (response.error) {
        Alert.alert('Error', normalizeError(response.error, 'Failed to submit change order request'));
        return;
      }

      if (response.data) {
        setChangeOrderDescription('');
        setChangeOrderUrgency('normal');
        setShowChangeOrderModal(false);
        Alert.alert(
          'Request Submitted',
          'Your change order request has been sent to dispatch. They will contact you shortly.'
        );
      }
    } catch (err) {
      console.error('Change order request error:', err);
      Alert.alert('Error', 'Failed to submit change order request. Please try again.');
    } finally {
      setIsSubmittingChangeOrder(false);
    }
  }, [workOrder.id, changeOrderDescription, changeOrderUrgency]);

  // Handle quick action for change order
  const handleRequestChangeOrder = useCallback(() => {
    setShowChangeOrderModal(true);
  }, []);

  // Handle quick action navigations (placeholders)
  const handleViewPhotos = useCallback(() => {
    // Navigate to M8 (Photo Capture Screen)
    navigation.navigate('PhotoCapture', {
      workOrderId: workOrder.id,
      returnTo: 'WorkOrderDetail',
    });
  }, [navigation, workOrder.id]);

  const handleAddPhoto = useCallback(() => {
    // Navigate to M8 (Photo Capture Screen) - same as handleViewPhotos
    navigation.navigate('PhotoCapture', {
      workOrderId: workOrder.id,
      returnTo: 'WorkOrderDetail',
    });
  }, [navigation, workOrder.id]);

  const handleViewNotes = useCallback(() => {
    // Scroll to notes section or show modal
    setShowNoteModal(true);
  }, []);

  const handleAddNote = useCallback(() => {
    setShowNoteModal(true);
  }, []);

  const handleViewActivities = useCallback(() => {
    // Navigate to M7 (Activities & Checklist Screen)
    navigation.navigate('WorkOrderActivities', {
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.work_order_number,
      workOrderTitle: workOrder.title,
    });
  }, [navigation, workOrder]);

  const handleViewTaskChecklist = useCallback(() => {
    // Navigate to M13 (Task Checklist Screen)
    navigation.navigate('WorkOrderTaskChecklist', {
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.work_order_number,
      workOrderTitle: workOrder.title,
    });
  }, [navigation, workOrder]);

  const handleViewTimeEntries = useCallback(() => {
    // Navigate to M4 (Time Entry Screen)
    navigation.navigate('TimeEntry', {
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.work_order_number,
      workOrderTitle: workOrder.title,
    });
  }, [navigation, workOrder]);

  const handleAddTimeEntry = useCallback(() => {
    // Navigate to M4 (Time Entry Screen) - same as view
    navigation.navigate('TimeEntry', {
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.work_order_number,
      workOrderTitle: workOrder.title,
    });
  }, [navigation, workOrder]);

  const handleViewCrew = useCallback(() => {
    navigation.navigate('CrewClockIn', {
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.work_order_number,
      workOrderTitle: workOrder.title,
    });
  }, [navigation, workOrder]);

  const handleSelfClockIn = useCallback(async () => {
    setIsSelfClocking(true);
    try {
      const response = await selfClockIn(workOrder.id, {
        location: undefined, // GPS captured by API if available
      });
      if (response.data?.success) {
        setIsSelfClockedIn(true);
        Alert.alert('Clocked In', 'You are now clocked in to this work order.');
        loadCrewStatus();
      } else {
        Alert.alert('Error', response.data?.error || 'Failed to clock in');
      }
    } catch (err) {
      Alert.alert('Error', normalizeError(err));
    } finally {
      setIsSelfClocking(false);
    }
  }, [workOrder.id, loadCrewStatus]);

  const handleSelfClockOut = useCallback(async () => {
    Alert.alert('Clock Out', 'Are you sure you want to clock out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clock Out',
        style: 'destructive',
        onPress: async () => {
          setIsSelfClocking(true);
          try {
            const response = await selfClockOut(workOrder.id, {
              location: undefined,
            });
            if (response.data?.success) {
              setIsSelfClockedIn(false);
              Alert.alert('Clocked Out', 'You have been clocked out.');
              loadCrewStatus();
            } else {
              Alert.alert('Error', response.data?.error || 'Failed to clock out');
            }
          } catch (err) {
            Alert.alert('Error', normalizeError(err));
          } finally {
            setIsSelfClocking(false);
          }
        },
      },
    ]);
  }, [workOrder.id, loadCrewStatus]);

  const handleViewParts = useCallback(() => {
    // Navigate to M5 (Parts & Materials Screen)
    navigation.navigate('WorkOrderParts', {
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.work_order_number,
      workOrderTitle: workOrder.title,
    });
  }, [navigation, workOrder]);

  const handleViewMessages = useCallback(() => {
    // Navigate to Messages Screen
    navigation.navigate('WorkOrderMessages', {
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.work_order_number,
    });
    // Clear unread count when navigating to messages
    setUnreadCount(0);
  }, [navigation, workOrder]);

  const handleIssuePartsQuick = useCallback(() => {
    // Quick action: Issue parts to this WO
    Alert.alert(
      'Issue Parts',
      'This will allow you to quickly issue parts from your truck to this work order.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Issue Parts',
          onPress: () => {
            navigation.navigate('WorkOrderParts', {
              workOrderId: workOrder.id,
              workOrderNumber: workOrder.work_order_number,
              workOrderTitle: workOrder.title,
              autoOpenIssue: true,
            });
          },
        },
      ]
    );
  }, [navigation, workOrder]);

  const handleMarkAssetLeftOnSite = useCallback(() => {
    // Quick action: Mark asset as left on site
    Alert.alert(
      'Leave Asset on Site',
      'Mark an asset (tool, equipment) as left at this job site.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Asset',
          onPress: () => {
            // Navigate to asset custody screen or show modal
            // For now, just show placeholder
            Alert.alert('Feature Coming Soon', 'Asset custody tracking will be available soon.');
          },
        },
      ]
    );
  }, [workOrder]);

  const handleViewTruckStock = useCallback(() => {
    // Navigate to Truck Inventory Screen
    navigation.navigate('TruckInventory', {
      fromWorkOrder: workOrder.id,
    });
  }, [navigation, workOrder.id]);

  const handleCloseOut = useCallback(() => {
    // Navigate to M6 (Work Order Close-Out Screen)
    navigation.navigate('WorkOrderCloseOut', {
      workOrderId: workOrder.id,
      workOrder: workOrder,
    });
  }, [navigation, workOrder]);

  const handleCompleteJob = useCallback(() => {
    // Navigate to M10 (Customer Signature & Job Completion)
    navigation.navigate('WorkOrderSignature', {
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.work_order_number,
    });
  }, [navigation, workOrder.id, workOrder.work_order_number]);

  const statusColor = statusColors[workOrder.status] || statusColors.DRAFT;
  const priorityColor = priorityColors[workOrder.priority] || priorityColors.medium;

  // Determine if status can be updated (placeholder logic)
  // TODO: Replace with actual state machine validation
  const canUpdateStatus = ![WorkOrderState.COMPLETED, WorkOrderState.CANCELLED].includes(
    workOrder.status as WorkOrderState
  );

  if (isLoading && !isRefreshing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading work order...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#ef4444" />
          <Text style={styles.errorTitle}>Error Loading Work Order</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadWorkOrderDetails()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Offline Banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline" size={20} color={colors.textInverse} />
          <Text style={styles.offlineBannerText}>Offline Mode - Changes will sync later</Text>
        </View>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {/* Hero Image — Street View → Static Map → Icon fallback */}
        {workOrder.site_street_view_url && workOrder.site_street_view_status === 'available' ? (
          <Image
            source={{ uri: workOrder.site_street_view_url }}
            style={styles.heroImage}
            resizeMode="cover"
          />
        ) : workOrder.site_latitude != null && workOrder.site_longitude != null ? (
          <Image
            source={{
              uri: `https://maps.googleapis.com/maps/api/staticmap?center=${workOrder.site_latitude},${workOrder.site_longitude}&zoom=16&size=600x300&maptype=roadmap&markers=color:red%7C${workOrder.site_latitude},${workOrder.site_longitude}&key=${GOOGLE_MAPS_API_KEY}`,
            }}
            style={styles.heroImage}
            resizeMode="cover"
          />
        ) : workOrder.site_name ? (
          <View style={styles.heroPlaceholder}>
            <Ionicons name="business-outline" size={48} color={colors.textMuted} />
            <Text style={styles.heroPlaceholderText}>{workOrder.site_name}</Text>
          </View>
        ) : null}

        {/* Status Banner */}
        <View style={[styles.statusBanner, { backgroundColor: statusColor.bg }]}>
          <View style={styles.statusBannerContent}>
            <Text style={[styles.statusText, { color: statusColor.text }]}>
              {workOrder.status.replace(/_/g, ' ')}
            </Text>
            {canUpdateStatus && (
              <TouchableOpacity
                style={[styles.updateStatusButton, { borderColor: statusColor.border }]}
                onPress={handleStatusUpdate}
                disabled={isUpdatingStatus}
              >
                {isUpdatingStatus ? (
                  <ActivityIndicator size="small" color={statusColor.text} />
                ) : (
                  <Text style={[styles.updateStatusButtonText, { color: statusColor.text }]}>
                    Update Status
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Status Action Buttons */}
        {canUpdateStatus && (
          <View style={styles.statusActionsSection}>
            {/* En Route button - visible when scheduled or accepted */}
            {(workOrder.status === WorkOrderState.SCHEDULED ||
              workOrder.status === WorkOrderState.ACCEPTED) && (
              <TouchableOpacity
                style={styles.statusActionButton}
                onPress={handleEnRoute}
                disabled={isUpdatingStatus}
              >
                {statusButtonLoading === 'traveling' ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <>
                    <Ionicons name="car-outline" size={20} color={colors.textInverse} />
                    <Text style={styles.statusActionButtonText}>En Route</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Start Job button - visible when traveling */}
            {workOrder.status === WorkOrderState.TRAVELING && (
              <TouchableOpacity
                style={[styles.statusActionButton, { backgroundColor: '#f59e0b' }]}
                onPress={handleStartJob}
                disabled={isUpdatingStatus}
              >
                {statusButtonLoading === 'in_progress' ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <>
                    <Ionicons name="play-outline" size={20} color={colors.textInverse} />
                    <Text style={styles.statusActionButtonText}>Start Job</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Complete button - visible when in_progress */}
            {workOrder.status === WorkOrderState.IN_PROGRESS && (
              <TouchableOpacity
                style={[styles.statusActionButton, { backgroundColor: '#10b981' }]}
                onPress={handleComplete}
                disabled={isUpdatingStatus}
              >
                <Ionicons name="checkmark-done-outline" size={20} color={colors.textInverse} />
                <Text style={styles.statusActionButtonText}>Complete Job</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Work Order Header */}
        <View style={styles.section}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.workOrderNumber}>{workOrder.work_order_number}</Text>
              <Text style={styles.workOrderTitle}>{workOrder.title || 'Untitled Work Order'}</Text>
            </View>
            <View style={styles.priorityContainer}>
              <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
              <Text style={[styles.priorityText, { color: priorityColor }]}>
                {workOrder.priority.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {/* Customer Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer</Text>
          <Text style={styles.customerName}>{getCustomerName()}</Text>

          {/* Job Site Name */}
          {(workOrder as any).site_name && (
            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => {
                if ((workOrder as any).site_id) {
                  navigation.navigate('SiteEquipment', {
                    siteId: (workOrder as any).site_id,
                    siteName: (workOrder as any).site_name,
                    workOrderId: workOrder.id,
                  });
                }
              }}
              disabled={!(workOrder as any).site_id}
            >
              <Ionicons name="business-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.infoText}>
                Job Site: {(workOrder as any).site_name}
              </Text>
              {(workOrder as any).site_id && (
                <Ionicons name="chevron-forward" size={20} color={colors.primary} />
              )}
            </TouchableOpacity>
          )}

          {/* Address with Navigate */}
          {workOrder.service_address_line1 && (
            <TouchableOpacity style={styles.infoRow} onPress={handleNavigate}>
              <Ionicons name="location-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.infoText} numberOfLines={2}>
                {formatAddress()}
              </Text>
              <Ionicons name="navigate-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}

          {/* Site Access Instructions (expandable) */}
          {(workOrder as any).site_access_instructions && (
            <>
              <TouchableOpacity
                style={styles.infoRow}
                onPress={() => setShowAccessInstructions(!showAccessInstructions)}
              >
                <Ionicons name="key-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.infoText}>Access Instructions</Text>
                <Ionicons
                  name={showAccessInstructions ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
              {showAccessInstructions && (
                <View style={styles.accessInstructionsBox}>
                  <Text style={styles.accessInstructionsText}>
                    {(workOrder as any).site_access_instructions}
                  </Text>
                </View>
              )}
            </>
          )}

          {/* Phone with Call */}
          {((workOrder as any).customer_phone || workOrder.customer?.phone || workOrder.customer?.mobile) && (
            <TouchableOpacity style={styles.infoRow} onPress={handleCall}>
              <Ionicons name="call-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.infoText}>
                {(workOrder as any).customer_contact_name ? `${(workOrder as any).customer_contact_name}: ` : ''}
                {(workOrder as any).customer_phone || workOrder.customer?.phone || workOrder.customer?.mobile}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Schedule Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule</Text>
          <View style={styles.detailGrid}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Scheduled Start</Text>
              <Text style={styles.detailValue}>
                {formatDateTime(workOrder.scheduled_start)}
              </Text>
            </View>
            {workOrder.scheduled_end && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Scheduled End</Text>
                <Text style={styles.detailValue}>
                  {formatDateTime(workOrder.scheduled_end)}
                </Text>
              </View>
            )}
            {workOrder.actual_start && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Actual Start</Text>
                <Text style={styles.detailValue}>
                  {formatDateTime(workOrder.actual_start)}
                </Text>
              </View>
            )}
            {workOrder.actual_end && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Actual End</Text>
                <Text style={styles.detailValue}>
                  {formatDateTime(workOrder.actual_end)}
                </Text>
              </View>
            )}
            {(workOrder.estimated_hours || (workOrder as any).estimated_hours) && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Estimated Hours</Text>
                <Text style={styles.detailValue}>{workOrder.estimated_hours || (workOrder as any).estimated_hours}h</Text>
              </View>
            )}
            {(workOrder.actual_hours || (workOrder as any).actual_hours) && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Actual Hours</Text>
                <Text style={styles.detailValue}>{workOrder.actual_hours || (workOrder as any).actual_hours}h</Text>
              </View>
            )}
          </View>
        </View>

        {/* Work Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Work Details</Text>
          <View style={styles.detailGrid}>
            {workOrder.work_type && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Work Type</Text>
                <Text style={styles.detailValue}>{workOrder.work_type}</Text>
              </View>
            )}
            {(workOrder as any).phase_type && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Work Phase</Text>
                <Text style={styles.detailValue}>{(workOrder as any).phase_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</Text>
              </View>
            )}
            {(workOrder as any).market && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Market</Text>
                <Text style={styles.detailValue}>{(workOrder as any).market}</Text>
              </View>
            )}
            {(workOrder as any).reference_number && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Reference</Text>
                <Text style={styles.detailValue}>{(workOrder as any).reference_number}</Text>
              </View>
            )}
            {(workOrder as any).parts_status && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Parts Status</Text>
                <Text style={styles.detailValue}>{(workOrder as any).parts_status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</Text>
              </View>
            )}
          </View>

          {/* Description */}
          {workOrder.description && (
            <>
              <Text style={styles.subsectionTitle}>Description</Text>
              <Text style={styles.description}>{workOrder.description}</Text>
            </>
          )}

          {/* Waiting Reason (if in WAITING state) */}
          {workOrder.status === WorkOrderState.WAITING && workOrder.waiting_reason && (
            <>
              <Text style={styles.subsectionTitle}>Waiting Reason</Text>
              <View style={styles.waitingReasonContainer}>
                <Ionicons name="time-outline" size={20} color="#f59e0b" />
                <Text style={styles.waitingReasonText}>{workOrder.waiting_reason}</Text>
              </View>
            </>
          )}
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            <TouchableOpacity style={styles.actionButton} onPress={handleViewTaskChecklist}>
              <View style={styles.actionIconContainer}>
                <Ionicons name="checkbox-outline" size={28} color={colors.primary} />
                {workOrder.tasks && workOrder.tasks.length > 0 && (
                  <View style={styles.actionBadge}>
                    <Text style={styles.actionBadgeText}>
                      {workOrder.tasks.filter((t) => t.is_completed).length}/{workOrder.tasks.length}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.actionLabel}>Tasks</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton} onPress={handleViewActivities}>
              <View style={styles.actionIconContainer}>
                <Ionicons name="clipboard-outline" size={28} color={colors.primary} />
              </View>
              <Text style={styles.actionLabel}>Activities</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton} onPress={handleViewTimeEntries}>
              <View style={styles.actionIconContainer}>
                <Ionicons name="time-outline" size={28} color={colors.primary} />
              </View>
              <Text style={styles.actionLabel}>Time</Text>
            </TouchableOpacity>

            {crewSize > 1 && (
              <TouchableOpacity style={styles.actionButton} onPress={handleViewCrew}>
                <View style={styles.actionIconContainer}>
                  <Ionicons name="people-outline" size={28} color={colors.primary} />
                  {crewClockedInCount > 0 && (
                    <View style={styles.actionBadge}>
                      <Text style={styles.actionBadgeText}>{crewClockedInCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.actionLabel}>Crew</Text>
              </TouchableOpacity>
            )}

            {isCrewMember && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={isSelfClockedIn ? handleSelfClockOut : handleSelfClockIn}
                disabled={isSelfClocking}
              >
                <View style={styles.actionIconContainer}>
                  <Ionicons
                    name={isSelfClockedIn ? 'log-out-outline' : 'log-in-outline'}
                    size={28}
                    color={isSelfClockedIn ? colors.error : colors.success}
                  />
                </View>
                <Text style={styles.actionLabel}>
                  {isSelfClocking ? '...' : isSelfClockedIn ? 'Clock Out' : 'Clock In'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.actionButton} onPress={handleViewParts}>
              <View style={styles.actionIconContainer}>
                <Ionicons name="cube-outline" size={28} color={colors.primary} />
                {workOrder.parts_used && workOrder.parts_used.length > 0 && (
                  <View style={styles.actionBadge}>
                    <Text style={styles.actionBadgeText}>{workOrder.parts_used.length}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.actionLabel}>Parts</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton} onPress={handleViewPhotos}>
              <View style={styles.actionIconContainer}>
                <Ionicons name="camera-outline" size={28} color={colors.primary} />
                {photos.length > 0 && (
                  <View style={styles.actionBadge}>
                    <Text style={styles.actionBadgeText}>{photos.length}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.actionLabel}>Photos</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton} onPress={handleViewNotes}>
              <View style={styles.actionIconContainer}>
                <Ionicons name="document-text-outline" size={28} color={colors.primary} />
                {notes.length > 0 && (
                  <View style={styles.actionBadge}>
                    <Text style={styles.actionBadgeText}>{notes.length}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.actionLabel}>Notes</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton} onPress={handleViewMessages}>
              <View style={styles.actionIconContainer}>
                <Ionicons name="chatbubbles-outline" size={28} color={colors.primary} />
                {unreadCount > 0 && (
                  <View style={[styles.actionBadge, styles.unreadBadge]}>
                    <Text style={styles.actionBadgeText}>{unreadCount}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.actionLabel}>Messages</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton} onPress={handleViewTruckStock}>
              <View style={styles.actionIconContainer}>
                <Ionicons name="car-outline" size={28} color={colors.primary} />
              </View>
              <Text style={styles.actionLabel}>Truck Stock</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton} onPress={handleViewDocuments}>
              <View style={styles.actionIconContainer}>
                <Ionicons name="folder-open-outline" size={28} color={colors.primary} />
                {(documents.files.length + documents.drawings.length) > 0 && (
                  <View style={styles.actionBadge}>
                    <Text style={styles.actionBadgeText}>
                      {documents.files.length + documents.drawings.length}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.actionLabel}>Docs</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* WMS Quick Actions - only visible when IN_PROGRESS */}
        {workOrder.status === WorkOrderState.IN_PROGRESS && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Inventory Quick Actions</Text>
            <View style={styles.quickActionsRow}>
              <TouchableOpacity
                style={styles.quickActionButton}
                onPress={handleIssuePartsQuick}
              >
                <Ionicons name="cube" size={20} color={colors.textInverse} />
                <Text style={styles.quickActionText}>Issue Parts</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickActionButton, { backgroundColor: '#7c3aed' }]}
                onPress={handleMarkAssetLeftOnSite}
              >
                <Ionicons name="construct" size={20} color={colors.textInverse} />
                <Text style={styles.quickActionText}>Leave Asset on Site</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Change Order Request - visible when work is in progress or traveling */}
        {(workOrder.status === WorkOrderState.IN_PROGRESS ||
          workOrder.status === WorkOrderState.TRAVELING ||
          workOrder.status === WorkOrderState.WAITING) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Work</Text>
            <TouchableOpacity
              style={styles.changeOrderButton}
              onPress={handleRequestChangeOrder}
            >
              <Ionicons name="document-text-outline" size={20} color={colors.textInverse} />
              <Text style={styles.changeOrderButtonText}>Request Change Order</Text>
            </TouchableOpacity>
            <Text style={styles.changeOrderHelperText}>
              Discovered additional work? Request approval from dispatch before proceeding.
            </Text>
          </View>
        )}

        {/* Time Entries Section */}
        {timeEntries.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Time Entries ({timeEntries.length})</Text>
              <TouchableOpacity onPress={handleViewTimeEntries}>
                <Text style={styles.sectionLink}>Add Time</Text>
              </TouchableOpacity>
            </View>
            {timeEntries.slice(0, 3).map((entry) => (
              <View key={entry.id} style={styles.timeEntryItem}>
                <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
                <View style={styles.timeEntryContent}>
                  <Text style={styles.timeEntryText}>
                    {new Date(entry.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - {new Date(entry.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  <Text style={styles.timeEntryMeta}>
                    {entry.entry_type || 'Work'} {entry.notes ? `- ${entry.notes}` : ''}
                  </Text>
                </View>
              </View>
            ))}
            {timeEntries.length > 3 && (
              <TouchableOpacity style={styles.viewAllButton} onPress={handleViewTimeEntries}>
                <Text style={styles.viewAllText}>View all {timeEntries.length} entries</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Notes Section */}
        {notes.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Notes ({notes.length})</Text>
              <TouchableOpacity onPress={handleAddNote}>
                <Text style={styles.sectionLink}>Add Note</Text>
              </TouchableOpacity>
            </View>
            {notes.slice(0, 3).map((note) => (
              <View key={note.id} style={styles.noteItem}>
                <View style={styles.noteHeader}>
                  <Text style={styles.noteAuthor}>
                    {note.first_name} {note.last_name}
                  </Text>
                  <Text style={styles.noteDate}>
                    {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
                <Text style={styles.noteContent} numberOfLines={2}>{note.content}</Text>
              </View>
            ))}
            {notes.length > 3 && (
              <TouchableOpacity style={styles.viewAllButton} onPress={handleViewNotes}>
                <Text style={styles.viewAllText}>View all {notes.length} notes</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Photos Section */}
        {photos.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Photos ({photos.length})</Text>
              <TouchableOpacity onPress={handleAddPhoto}>
                <Text style={styles.sectionLink}>Add Photo</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.photosGrid}>
              {photos.slice(0, 4).map((photo) => (
                <TouchableOpacity key={photo.id} style={styles.photoThumbnail} onPress={handleViewPhotos}>
                  <Image
                    source={{ uri: photo.url }}
                    style={styles.photoImage}
                    resizeMode="cover"
                  />
                  {photo.caption && (
                    <Text style={styles.photoCaption} numberOfLines={1}>{photo.caption}</Text>
                  )}
                </TouchableOpacity>
              ))}
              {photos.length > 4 && (
                <TouchableOpacity style={styles.photoMoreOverlay} onPress={handleViewPhotos}>
                  <Text style={styles.photoMoreText}>+{photos.length - 4}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Tasks Checklist (if tasks exist) */}
        {workOrder.tasks && workOrder.tasks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Tasks ({workOrder.tasks.filter((t) => t.is_completed).length}/{workOrder.tasks.length} Completed)
              </Text>
              <TouchableOpacity onPress={handleViewTaskChecklist}>
                <Text style={styles.sectionLink}>View All</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.taskList}>
              {workOrder.tasks.map((task, index) => (
                <View key={task.id} style={styles.taskItem}>
                  <Ionicons
                    name={task.is_completed ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={task.is_completed ? '#10b981' : '#9ca3af'}
                  />
                  <View style={styles.taskContent}>
                    <Text
                      style={[
                        styles.taskText,
                        task.is_completed && styles.taskTextCompleted,
                      ]}
                    >
                      {task.description}
                    </Text>
                    {task.estimated_hours && (
                      <Text style={styles.taskMeta}>Est. {task.estimated_hours}h</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Placeholder Tasks (if no tasks exist) */}
        {(!workOrder.tasks || workOrder.tasks.length === 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tasks</Text>
              <TouchableOpacity onPress={handleViewTaskChecklist}>
                <Text style={styles.sectionLink}>View Checklist</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.emptyState}>
              <Ionicons name="list-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyStateText}>No tasks defined for this work order</Text>
            </View>
          </View>
        )}

        {/* Signature Status (if completed) */}
        {workOrder.status === WorkOrderState.COMPLETED && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Completion</Text>
            {workOrder.signature_url ? (
              <View style={styles.signatureContainer}>
                <Ionicons name="checkmark-circle" size={24} color="#10b981" />
                <View style={styles.signatureInfo}>
                  <Text style={styles.signatureText}>
                    Signed by {workOrder.signature_name || 'Customer'}
                  </Text>
                  <Text style={styles.signatureMeta}>
                    {formatDateTime(workOrder.signature_date)}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.signatureContainer}>
                <Ionicons name="alert-circle-outline" size={24} color="#f59e0b" />
                <Text style={styles.signatureText}>No signature captured</Text>
              </View>
            )}
            {workOrder.completed_at && (
              <Text style={styles.completedAtText}>
                Completed on {formatDateTime(workOrder.completed_at)}
              </Text>
            )}
          </View>
        )}

        {/* Notes (if exist) */}
        {workOrder.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notesText}>{workOrder.notes}</Text>
          </View>
        )}

        {/* Internal Notes (if exist - for display only) */}
        {workOrder.internal_notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Internal Notes (Dispatch)</Text>
            <Text style={styles.internalNotesText}>{workOrder.internal_notes}</Text>
          </View>
        )}

        {/* Complete Job Action (for IN_PROGRESS or WAITING states) */}
        {(workOrder.status === WorkOrderState.IN_PROGRESS ||
          workOrder.status === WorkOrderState.WAITING) && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.closeOutButton}
              onPress={handleCompleteJob}
            >
              <Ionicons name="checkmark-done-outline" size={24} color={colors.textInverse} />
              <Text style={styles.closeOutButtonText}>Complete Job</Text>
            </TouchableOpacity>
            <Text style={styles.closeOutHelperText}>
              Review work summary and collect customer signature
            </Text>
          </View>
        )}

        {/* Bottom Padding for scroll */}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add Note Modal */}
      <Modal
        visible={showNoteModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowNoteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Note</Text>
              <TouchableOpacity onPress={() => setShowNoteModal(false)} disabled={isAddingNote}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.noteInput}
              placeholder="Enter your note..."
              placeholderTextColor={colors.textMuted}
              value={noteText}
              onChangeText={setNoteText}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              editable={!isAddingNote}
            />
            <TouchableOpacity
              style={[styles.modalButton, isAddingNote && styles.modalButtonDisabled]}
              onPress={handleAddNoteSubmit}
              disabled={isAddingNote}
            >
              {isAddingNote ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <Text style={styles.modalButtonText}>Save Note</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Change Order Request Modal */}
      <Modal
        visible={showChangeOrderModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowChangeOrderModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Request Change Order</Text>
              <TouchableOpacity
                onPress={() => setShowChangeOrderModal(false)}
                disabled={isSubmittingChangeOrder}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.changeOrderLabel}>Describe the additional work needed:</Text>
            <TextInput
              style={styles.changeOrderInput}
              placeholder="What work needs to be done? Be specific about scope, materials, and location..."
              placeholderTextColor={colors.textMuted}
              value={changeOrderDescription}
              onChangeText={setChangeOrderDescription}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              editable={!isSubmittingChangeOrder}
            />

            <Text style={styles.changeOrderLabel}>Urgency:</Text>
            <View style={styles.urgencySelector}>
              <TouchableOpacity
                style={[
                  styles.urgencyOption,
                  changeOrderUrgency === 'normal' && styles.urgencyOptionSelected,
                ]}
                onPress={() => setChangeOrderUrgency('normal')}
                disabled={isSubmittingChangeOrder}
              >
                <Text
                  style={[
                    styles.urgencyOptionText,
                    changeOrderUrgency === 'normal' && styles.urgencyOptionTextSelected,
                  ]}
                >
                  Normal
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.urgencyOption,
                  changeOrderUrgency === 'urgent' && styles.urgencyOptionSelectedUrgent,
                ]}
                onPress={() => setChangeOrderUrgency('urgent')}
                disabled={isSubmittingChangeOrder}
              >
                <Text
                  style={[
                    styles.urgencyOptionText,
                    changeOrderUrgency === 'urgent' && styles.urgencyOptionTextSelected,
                  ]}
                >
                  Urgent
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.changeOrderWarning}>
              Note: Tasks are for checklist items only. Additional work requires a change order
              approved by dispatch and the customer.
            </Text>

            <TouchableOpacity
              style={[
                styles.modalButton,
                { backgroundColor: '#f59e0b' },
                isSubmittingChangeOrder && styles.modalButtonDisabled,
              ]}
              onPress={handleSubmitChangeOrder}
              disabled={isSubmittingChangeOrder}
            >
              {isSubmittingChangeOrder ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <Text style={styles.modalButtonText}>Submit Request</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Documents Modal (Files & Drawings from Estimate) */}
      <Modal
        visible={showDocumentsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowDocumentsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Job Documents</Text>
              <TouchableOpacity onPress={() => setShowDocumentsModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {isLoadingDocuments ? (
              <View style={styles.documentsLoading}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.documentsLoadingText}>Loading documents...</Text>
              </View>
            ) : documents.files.length === 0 && documents.drawings.length === 0 ? (
              <View style={styles.documentsEmpty}>
                <Ionicons name="folder-open-outline" size={64} color="#d1d5db" />
                <Text style={styles.documentsEmptyTitle}>No Documents</Text>
                <Text style={styles.documentsEmptyText}>
                  No files or drawings are attached to this job.
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.documentsList}>
                {/* Files Section */}
                {documents.files.length > 0 && (
                  <View style={styles.documentsSection}>
                    <Text style={styles.documentsSectionTitle}>
                      <Ionicons name="document-outline" size={16} color={colors.textSecondary} /> Files ({documents.files.length})
                    </Text>
                    {documents.files.map((doc) => (
                      <TouchableOpacity
                        key={doc.id}
                        style={styles.documentItem}
                        onPress={() => openDocument(doc)}
                      >
                        <View style={styles.documentIcon}>
                          <Ionicons
                            name={
                              doc.mimeType?.includes('pdf') ? 'document-text' :
                              doc.mimeType?.includes('image') ? 'image' :
                              doc.mimeType?.includes('spreadsheet') || doc.mimeType?.includes('excel') ? 'grid' :
                              'document'
                            }
                            size={24}
                            color={colors.primary}
                          />
                        </View>
                        <View style={styles.documentInfo}>
                          <Text style={styles.documentName} numberOfLines={1}>{doc.name}</Text>
                          <Text style={styles.documentMeta}>
                            {doc.category || 'File'} • {Math.round((doc.size || 0) / 1024)} KB
                          </Text>
                        </View>
                        <Ionicons name="open-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Drawings Section */}
                {documents.drawings.length > 0 && (
                  <View style={styles.documentsSection}>
                    <Text style={styles.documentsSectionTitle}>
                      <Ionicons name="map-outline" size={16} color={colors.textSecondary} /> Drawings ({documents.drawings.length})
                    </Text>
                    {documents.drawings.map((doc) => (
                      <TouchableOpacity
                        key={doc.id}
                        style={styles.documentItem}
                        onPress={() => openDocument(doc)}
                      >
                        <View style={styles.documentIcon}>
                          <Ionicons
                            name={doc.mimeType?.includes('image') ? 'image' : 'map'}
                            size={24}
                            color="#7c3aed"
                          />
                        </View>
                        <View style={styles.documentInfo}>
                          <Text style={styles.documentName} numberOfLines={1}>{doc.name}</Text>
                          <Text style={styles.documentMeta}>
                            {doc.drawingType || 'Drawing'} • {Math.round((doc.size || 0) / 1024)} KB
                          </Text>
                        </View>
                        <Ionicons name="open-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <Text style={styles.documentsHelperText}>
                  Tap a document to open it in your device's viewer (PDF, image viewer, etc.)
                </Text>
              </ScrollView>
            )}

            <TouchableOpacity
              style={[styles.modalButton, { marginTop: 16 }]}
              onPress={() => {
                setShowDocumentsModal(false);
                loadDocuments(); // Refresh
              }}
            >
              <Text style={styles.modalButtonText}>Refresh Documents</Text>
            </TouchableOpacity>
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
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
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
    backgroundColor: '#f59e0b',
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
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  statusBanner: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  statusBannerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  updateStatusButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  updateStatusButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    backgroundColor: colors.card,
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  subsectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flex: 1,
  },
  workOrderNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 6,
  },
  workOrderTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  priorityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: colors.background,
  },
  priorityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  priorityText: {
    fontSize: 12,
    fontWeight: '600',
  },
  customerName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  accessInstructionsBox: {
    backgroundColor: colors.warningBg,
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
    marginBottom: 4,
  },
  accessInstructionsText: {
    fontSize: 14,
    color: colors.warning,
    lineHeight: 20,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
  },
  detailItem: {
    width: '50%',
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  description: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
  },
  waitingReasonContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    backgroundColor: colors.warningBg,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  waitingReasonText: {
    flex: 1,
    fontSize: 14,
    color: colors.warning,
    lineHeight: 20,
  },
  actionsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
  },
  actionButton: {
    alignItems: 'center',
    padding: 12,
  },
  actionIconContainer: {
    position: 'relative',
    marginBottom: 6,
  },
  actionBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  actionBadgeText: {
    color: colors.textInverse,
    fontSize: 11,
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: '#10b981',
  },
  actionLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  taskList: {
    gap: 4,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  taskContent: {
    flex: 1,
  },
  taskText: {
    fontSize: 14,
    color: colors.text,
    marginBottom: 2,
  },
  taskTextCompleted: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  taskMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyStateText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 12,
  },
  signatureContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: colors.background,
    borderRadius: 8,
  },
  signatureInfo: {
    flex: 1,
  },
  signatureText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  signatureMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  completedAtText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 12,
  },
  notesText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
  },
  internalNotesText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    fontStyle: 'italic',
    backgroundColor: colors.warningBg,
    padding: 12,
    borderRadius: 8,
  },
  closeOutButton: {
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 8,
    gap: 10,
    marginBottom: 12,
  },
  closeOutButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
  closeOutHelperText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  // Status Action Buttons
  statusActionsSection: {
    backgroundColor: colors.card,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 1,
  },
  statusActionButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
  },
  statusActionButtonText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '600',
  },
  // Section Header with Link
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLink: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  // Time Entry Items
  timeEntryItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  timeEntryContent: {
    flex: 1,
  },
  timeEntryText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  timeEntryMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // Note Items
  noteItem: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  noteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  noteAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  noteDate: {
    fontSize: 12,
    color: colors.textMuted,
  },
  noteContent: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  // View All Button
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 4,
  },
  viewAllText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  // Photos Grid
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  photoThumbnail: {
    width: '23%',
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoCaption: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    color: colors.textInverse,
    fontSize: 10,
    padding: 4,
  },
  photoMoreOverlay: {
    width: '23%',
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: colors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoMoreText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  noteInput: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.text,
    minHeight: 120,
    marginBottom: 16,
  },
  modalButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonDisabled: {
    opacity: 0.7,
  },
  modalButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
  // WMS Quick Actions
  quickActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  quickActionButton: {
    flex: 1,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  quickActionText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },
  // Change Order Request Styles
  changeOrderButton: {
    backgroundColor: '#f59e0b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    gap: 10,
    marginBottom: 8,
  },
  changeOrderButtonText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '600',
  },
  changeOrderHelperText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  changeOrderLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  changeOrderInput: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: colors.text,
    minHeight: 140,
    marginBottom: 16,
    textAlignVertical: 'top',
  },
  urgencySelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  urgencyOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
  },
  urgencyOptionSelected: {
    borderColor: '#1e40af',
    backgroundColor: colors.infoBg,
  },
  urgencyOptionSelectedUrgent: {
    borderColor: '#ef4444',
    backgroundColor: colors.errorBg,
  },
  urgencyOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  urgencyOptionTextSelected: {
    color: colors.text,
  },
  changeOrderWarning: {
    fontSize: 12,
    color: colors.warning,
    backgroundColor: colors.warningBg,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    lineHeight: 18,
  },
  // Documents Modal Styles
  documentsLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  documentsLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textSecondary,
  },
  documentsEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  documentsEmptyTitle: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  documentsEmptyText: {
    marginTop: 8,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  documentsList: {
    maxHeight: 400,
  },
  documentsSection: {
    marginBottom: 20,
  },
  documentsSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    borderRadius: 8,
    marginBottom: 8,
    gap: 12,
  },
  documentIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.infoBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentInfo: {
    flex: 1,
  },
  documentName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  documentMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  documentsHelperText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
  // Hero image styles
  heroImage: {
    width: '100%',
    height: 200,
    backgroundColor: colors.backgroundTertiary,
  },
  heroPlaceholder: {
    width: '100%',
    height: 160,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heroPlaceholderText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
