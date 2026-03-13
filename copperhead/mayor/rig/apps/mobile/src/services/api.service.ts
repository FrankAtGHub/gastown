/**
 * API Service for Field Ops Mobile
 *
 * Centralized HTTP client for all API calls.
 * Handles authentication, token refresh, and error handling.
 *
 * @module services/api
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Configuration
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001/api';

// ============================================
// Cross-platform Storage Wrapper
// Uses SecureStore on native, localStorage on web
// ============================================
const Storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async deleteItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

// Storage keys
const ACCESS_TOKEN_KEY = 'fieldops_access_token';
const REFRESH_TOKEN_KEY = 'fieldops_refresh_token';
const USER_DATA_KEY = 'fieldops_user_data';

// Types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
  tenantName: string;
}

// Token management
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

/**
 * Initialize API service - load tokens from secure storage
 */
export async function initializeApi(): Promise<User | null> {
  try {
    accessToken = await Storage.getItem(ACCESS_TOKEN_KEY);
    const userData = await Storage.getItem(USER_DATA_KEY);

    if (userData) {
      return JSON.parse(userData);
    }
    return null;
  } catch (error) {
    console.error('Failed to initialize API:', error);
    return null;
  }
}

/**
 * Store tokens securely
 */
async function storeTokens(tokens: TokenPair): Promise<void> {
  accessToken = tokens.accessToken;
  await Storage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  await Storage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

/**
 * Store user data
 */
async function storeUser(user: User): Promise<void> {
  await Storage.setItem(USER_DATA_KEY, JSON.stringify(user));
}

/**
 * Clear all stored data (logout)
 */
export async function clearStorage(): Promise<void> {
  accessToken = null;
  await Storage.deleteItem(ACCESS_TOKEN_KEY);
  await Storage.deleteItem(REFRESH_TOKEN_KEY);
  await Storage.deleteItem(USER_DATA_KEY);
}

/**
 * Refresh access token
 */
async function refreshAccessToken(): Promise<string | null> {
  try {
    const refreshToken = await Storage.getItem(REFRESH_TOKEN_KEY);

    if (!refreshToken) {
      return null;
    }

    const response = await fetch(`${API_BASE_URL}/mobile/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // Refresh token expired - need to re-login
      await clearStorage();
      return null;
    }

    const data = await response.json();
    accessToken = data.accessToken;
    await Storage.setItem(ACCESS_TOKEN_KEY, data.accessToken);

    return data.accessToken;
  } catch (error) {
    console.error('Token refresh failed:', error);
    return null;
  }
}

/**
 * Get valid access token (refreshes if needed)
 */
async function getValidToken(): Promise<string | null> {
  if (accessToken) {
    return accessToken;
  }

  // Prevent multiple simultaneous refresh calls
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = refreshAccessToken();
  const token = await refreshPromise;
  refreshPromise = null;

  return token;
}

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = await getValidToken();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    // Handle 401 - try refresh once
    if (response.status === 401 && token) {
      const newToken = await refreshAccessToken();

      if (newToken) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...options,
          headers,
        });

        const retryData = await retryResponse.json();
        return {
          data: retryData,
          status: retryResponse.status,
        };
      }

      return {
        error: 'Session expired. Please login again.',
        status: 401,
      };
    }

    const data = await response.json();

    if (!response.ok) {
      return {
        error: data.error || 'Request failed',
        status: response.status,
      };
    }

    return {
      data,
      status: response.status,
    };
  } catch (error) {
    console.error('API request failed:', error);
    return {
      error: 'Network error. Please check your connection.',
      status: 0,
    };
  }
}

// ============================================
// Auth API
// ============================================

export interface LoginResponse {
  user: User;
  tokens: TokenPair;
}

export interface SSOProvider {
  provider: string;
  name: string;
  is_enabled: boolean;
}

/**
 * Get enabled SSO providers for the current tenant
 */
export async function getSSOProviders(): Promise<ApiResponse<SSOProvider[]>> {
  try {
    const response = await fetch(`${API_BASE_URL}/sso/providers`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    return {
      data: data.data || [],
      status: response.status,
    };
  } catch (error) {
    console.error('Failed to get SSO providers:', error);
    return {
      data: [],
      status: 0,
    };
  }
}

/**
 * Get SSO authorization URL for mobile (returns URL to open in browser)
 */
export function getSSOAuthorizeUrl(provider: string): string {
  return `${API_BASE_URL}/sso/${provider}/authorize?platform=mobile`;
}

/**
 * Exchange SSO authorization code for tokens
 */
export async function exchangeSSOToken(
  code: string,
  state?: string
): Promise<ApiResponse<LoginResponse>> {
  try {
    const response = await fetch(`${API_BASE_URL}/sso/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        error: data.error || 'SSO login failed',
        status: response.status,
      };
    }

    // Store tokens and user
    if (data.tokens || data.data?.tokens) {
      const tokens = data.tokens || data.data.tokens;
      const user = data.user || data.data?.user;
      await storeTokens(tokens);
      if (user) {
        await storeUser(user);
      }
    }

    return {
      data: data.data || data,
      status: response.status,
    };
  } catch (error) {
    console.error('SSO token exchange failed:', error);
    return {
      error: 'Network error during SSO login.',
      status: 0,
    };
  }
}

export async function login(email: string, password: string): Promise<ApiResponse<LoginResponse>> {
  try {
    const response = await fetch(`${API_BASE_URL}/mobile/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        error: data.error || 'Login failed',
        status: response.status,
      };
    }

    // Store tokens and user
    await storeTokens(data.tokens);
    await storeUser(data.user);

    return {
      data,
      status: response.status,
    };
  } catch (error) {
    console.error('Login failed:', error);
    return {
      error: 'Network error. Please check your connection.',
      status: 0,
    };
  }
}

export async function logout(): Promise<void> {
  await clearStorage();
}

// ============================================
// Sync API
// ============================================

export interface BootstrapData {
  user: User;
  workOrders: WorkOrder[];
  settings: Record<string, string>;
  syncedAt: string;
}

export interface WorkOrder {
  id: string;
  work_order_number: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  work_type?: string;
  scheduled_start: string;
  scheduled_end: string;
  customer_id: string;
  customer_name: string;
  customer_address: string;
  customer_city?: string;
  customer_state?: string;
  customer_postal_code?: string;
  customer_contact_name?: string;
  customer_phone: string;
  customer_email: string;
  assigned_to: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  notes?: string | null;
  internal_notes?: string | null;
  signature_url?: string | null;
  signature_name?: string | null;
  signature_date?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  // Estimate-sourced fields
  phase_type?: string | null;
  market?: string | null;
  reference_number?: string | null;
  parts_status?: string | null;
  waiting_reason?: string | null;
  source_estimate_id?: string | null;
  project_id?: string | null;
  // Service address (from WO, may differ from customer address)
  service_address_line1?: string | null;
  service_city?: string | null;
  service_state?: string | null;
  service_postal_code?: string | null;
  // Site fields (joined from sites table in sync queries)
  site_id?: string | null;
  site_name?: string | null;
  site_access_instructions?: string | null;
  site_latitude?: number | null;
  site_longitude?: number | null;
}

export interface WorkOrderDetail extends WorkOrder {
  customer_notes?: string;
}

export interface TimeEntry {
  id: string;
  work_order_id: string;
  user_id: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  notes: string;
  entry_type: string;
}

export interface Note {
  id: string;
  work_order_id: string;
  content: string;
  is_internal: boolean;
  created_by: string;
  first_name: string;
  last_name: string;
  created_at: string;
}

export interface Photo {
  id: string;
  work_order_id: string;
  url: string;
  filename: string;
  caption: string;
  photo_type: string;
  created_at: string;
}

export interface PartUsedApi {
  inventory_item_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit_of_measure: string;
}

export interface WorkOrderTask {
  id: string;
  description: string;
  is_required: boolean;
  is_completed: boolean;
  estimated_hours?: number | null;
  completed_at?: string | null;
  completed_by?: string | null;
  sort_order?: number;
  task_notes?: string | null;
}

export interface WorkOrderFullDetail {
  workOrder: WorkOrderDetail;
  timeEntries: TimeEntry[];
  notes: Note[];
  photos: Photo[];
  parts: PartUsedApi[];
  tasks: WorkOrderTask[];
}

export function bootstrapSync(): Promise<ApiResponse<BootstrapData>> {
  return apiRequest<BootstrapData>('/mobile/sync/bootstrap');
}

export function getWorkOrders(since?: string, status?: string): Promise<ApiResponse<{ workOrders: WorkOrder[]; syncedAt: string }>> {
  const params = new URLSearchParams();
  if (since) params.append('since', since);
  if (status) params.append('status', status);

  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/mobile/sync/work-orders${query}`);
}

export function getWorkOrderDetail(id: string): Promise<ApiResponse<WorkOrderFullDetail>> {
  return apiRequest(`/mobile/sync/work-orders/${id}`);
}

// ============================================
// WORK ORDER DOCUMENTS (Files & Drawings from Estimate)
// ============================================

export interface WorkOrderDocument {
  id: string;
  name: string;
  filename: string;
  size: number;
  mimeType: string;
  category?: string;
  description?: string;
  drawingType?: string;
  pageNumber?: number;
  uploadedAt: string;
  url: string;
  downloadUrl: string;
  thumbnailUrl?: string;
}

export interface WorkOrderDocumentsResponse {
  workOrderId: string;
  workOrderNumber: string;
  sourceEstimate: {
    id: string;
    number: string;
  } | null;
  files: WorkOrderDocument[];
  drawings: WorkOrderDocument[];
  totalCount: number;
}

/**
 * Get files and drawings attached to the source estimate for a work order
 * Used by technicians to access manuals, blueprints, specs on the job site
 */
export function getWorkOrderDocuments(
  workOrderId: string
): Promise<ApiResponse<WorkOrderDocumentsResponse>> {
  return apiRequest<WorkOrderDocumentsResponse>(`/mobile/sync/work-orders/${workOrderId}/documents`);
}

export function updateWorkOrderStatus(
  id: string,
  status: string,
  notes?: string
): Promise<ApiResponse<{ workOrder: WorkOrder }>> {
  return apiRequest(`/mobile/sync/work-orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, notes }),
  });
}

export interface TimeEntryLocation {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export function submitTimeEntry(
  workOrderId: string,
  data: {
    startTime: string;
    endTime: string;
    breakMinutes?: number;
    notes?: string;
    type?: string;
    startLocation?: TimeEntryLocation;
    endLocation?: TimeEntryLocation;
  }
): Promise<ApiResponse<{ timeEntry: TimeEntry }>> {
  return apiRequest(`/mobile/sync/work-orders/${workOrderId}/time-entries`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function addNote(
  workOrderId: string,
  content: string,
  isInternal: boolean = false
): Promise<ApiResponse<{ note: Note }>> {
  return apiRequest(`/mobile/sync/work-orders/${workOrderId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ content, isInternal }),
  });
}

export function uploadPhoto(
  workOrderId: string,
  data: {
    base64Data: string;
    filename: string;
    caption?: string;
    photoType?: string;
  }
): Promise<ApiResponse<{ photo: Photo }>> {
  return apiRequest(`/mobile/sync/work-orders/${workOrderId}/photos`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function submitSignature(
  workOrderId: string,
  data: {
    signatureData: string;
    signerName: string;
    signerRelation?: string;
  }
): Promise<ApiResponse<any>> {
  return apiRequest(`/mobile/sync/work-orders/${workOrderId}/signature`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function completeWorkOrder(
  id: string,
  data: {
    completionNotes?: string;
    partsUsed?: any[];
    totalHours?: number;
    customerSatisfaction?: number;
    followUpRequired?: boolean;
    followUpNotes?: string;
  }
): Promise<ApiResponse<{ workOrder: WorkOrder }>> {
  return apiRequest(`/mobile/sync/work-orders/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function submitLocation(data: {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
}): Promise<ApiResponse<any>> {
  return apiRequest('/mobile/sync/location', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function clockInOut(
  action: 'in' | 'out',
  latitude?: number,
  longitude?: number
): Promise<ApiResponse<any>> {
  return apiRequest('/mobile/sync/clock', {
    method: 'POST',
    body: JSON.stringify({ action, latitude, longitude }),
  });
}

export function processOfflineQueue(
  actions: Array<{ id: string; type: string; payload: any; timestamp: string }>
): Promise<ApiResponse<{ processed: number; failed: number; results: any[]; errors: any[] }>> {
  return apiRequest('/mobile/sync/offline-queue', {
    method: 'POST',
    body: JSON.stringify({ actions }),
  });
}

export function getCustomers(): Promise<ApiResponse<{ customers: any[] }>> {
  return apiRequest('/mobile/sync/customers');
}

export function getInventory(): Promise<ApiResponse<{ inventory: any[] }>> {
  return apiRequest('/mobile/sync/inventory');
}

// ============================================
// END OF DAY API
// ============================================

export interface DaySummaryData {
  date: string;
  completedWorkOrders: WorkOrder[];
  totalHoursWorked: number;
  totalWorkOrdersCompleted: number;
  pendingTimeEntries: Array<{
    id: string;
    workOrderId: string;
    workOrderNumber: string;
    startTime: string;
    endTime: string;
    durationHours: number;
  }>;
  pendingParts: Array<{
    id: string;
    workOrderId: string;
    workOrderNumber: string;
    partName: string;
    sku: string;
    quantity: number;
  }>;
  pendingPhotos: Array<{
    id: string;
    workOrderId: string;
    workOrderNumber: string;
    caption: string;
    category: string;
  }>;
  tomorrowSchedule: WorkOrder[];
}

export interface PendingCountData {
  timeEntries: number;
  parts: number;
  photos: number;
  total: number;
}

/**
 * Get technician's day summary (completed WOs, pending items, tomorrow schedule)
 */
export function getDaySummary(
  technicianId: string,
  date?: string
): Promise<ApiResponse<DaySummaryData>> {
  const params = new URLSearchParams();
  if (date) params.append('date', date);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<DaySummaryData>(`/mobile/technicians/${technicianId}/day-summary${query}`);
}

/**
 * Get count of pending items (time entries, photos, parts)
 */
export function getPendingItemsCount(
  technicianId: string,
  date?: string
): Promise<ApiResponse<PendingCountData>> {
  const params = new URLSearchParams();
  if (date) params.append('date', date);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<PendingCountData>(`/mobile/technicians/${technicianId}/pending-count${query}`);
}

/**
 * Submit a single time entry
 */
export function submitSingleTimeEntry(
  timeEntryId: string
): Promise<ApiResponse<{ timeEntry: TimeEntry }>> {
  return apiRequest<{ timeEntry: TimeEntry }>(`/mobile/time-entries/${timeEntryId}/submit`, {
    method: 'PATCH',
  });
}

/**
 * Submit all pending time entries for technician
 */
export function submitAllTimeEntries(
  technicianId: string,
  date?: string
): Promise<ApiResponse<{ submitted: number; timeEntries: TimeEntry[] }>> {
  return apiRequest<{ submitted: number; timeEntries: TimeEntry[] }>(
    `/mobile/technicians/${technicianId}/time-entries/submit-all`,
    {
      method: 'POST',
      body: JSON.stringify({ date }),
    }
  );
}

/**
 * Complete technician's day (validates no pending items)
 */
export function completeDay(
  technicianId: string,
  data: {
    date?: string;
    totalHoursWorked?: number;
    totalJobsCompleted?: number;
    notes?: string;
  }
): Promise<ApiResponse<{ success: boolean; completedAt: string }>> {
  return apiRequest<{ success: boolean; completedAt: string }>(
    `/mobile/technicians/${technicianId}/complete-day`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
}

// ============================================
// TRANSFERS API
// ============================================

export interface Transfer {
  id: string;
  transfer_number: string;
  transfer_type: string;
  status: string;
  from_location_id: string;
  from_location_name: string;
  from_location_code: string;
  to_location_id: string;
  to_location_name: string;
  to_location_code: string;
  created_by_id: string;
  created_by_name: string;
  recipient_id: string | null;
  recipient_name: string | null;
  item_count: number;
  total_quantity: number;
  submitted_at: string | null;
  delivered_at: string | null;
  accepted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransferItem {
  id: string;
  item_id: string;
  item_name: string;
  sku: string;
  category: string | null;
  quantity_requested: number;
  quantity_shipped: number | null;
  quantity_accepted: number | null;
  status: string;
  rejection_reason: string | null;
}

export interface TransferDetail extends Transfer {
  items: TransferItem[];
}

export interface PartialAcceptItem {
  item_id: string;
  quantity_accepted: number;
  status: 'accepted' | 'rejected' | 'partial';
  rejection_reason?: string;
}

export function getMyPendingTransfers(status?: string): Promise<ApiResponse<{ transfers: Transfer[] }>> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/transfers/pending/my${query}`);
}

export function getTransferDetail(id: string): Promise<ApiResponse<{ transfer: TransferDetail }>> {
  return apiRequest(`/transfers/${id}`);
}

export function acceptTransfer(id: string, notes?: string): Promise<ApiResponse<{ transfer: Transfer }>> {
  return apiRequest(`/transfers/${id}/accept`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export function acceptPartialTransfer(
  id: string,
  items: PartialAcceptItem[],
  notes?: string
): Promise<ApiResponse<{ transfer: Transfer }>> {
  return apiRequest(`/transfers/${id}/accept-partial`, {
    method: 'POST',
    body: JSON.stringify({ items, notes }),
  });
}

export function rejectTransfer(id: string, reason: string): Promise<ApiResponse<{ transfer: Transfer }>> {
  return apiRequest(`/transfers/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function lookupTransferByCode(code: string): Promise<ApiResponse<{ transfer: TransferDetail }>> {
  return apiRequest(`/transfers/lookup/${encodeURIComponent(code)}`);
}

// ============================================
// TRUCK INVENTORY API
// ============================================

export interface InventoryItem {
  id: string;
  item_id: string;
  item_name: string;
  sku: string;
  category: string;
  description?: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  min_level: number | null;
  max_level: number | null;
  is_low: boolean;
  unit_price: number;
}

export interface TruckInfo {
  id: string;
  name: string;
  code: string;
}

export interface TruckInventory {
  truck: TruckInfo;
  stock: InventoryItem[];
}

export function getMyTruckInventory(): Promise<ApiResponse<TruckInventory>> {
  return apiRequest<TruckInventory>('/inventory/trucks/my');
}

export function searchInventoryItem(query: string): Promise<ApiResponse<{ items: InventoryItem[] }>> {
  return apiRequest<{ items: InventoryItem[] }>(`/inventory/stock/search?q=${encodeURIComponent(query)}`);
}

export function useItemFromTruck(
  itemId: string,
  quantity: number,
  workOrderId?: string,
  notes?: string
): Promise<ApiResponse<{ success: boolean; newQuantity: number }>> {
  return apiRequest('/inventory/stock/use', {
    method: 'POST',
    body: JSON.stringify({
      itemId,
      quantity,
      workOrderId,
      notes,
    }),
  });
}

export function reportInventoryIssue(
  itemId: string,
  issueType: 'damaged' | 'missing' | 'wrong_item',
  quantity: number,
  notes?: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiRequest('/inventory/stock/report-issue', {
    method: 'POST',
    body: JSON.stringify({
      itemId,
      issueType,
      quantity,
      notes,
    }),
  });
}

// Export default API object
export default {
  initializeApi,
  login,
  logout,
  clearStorage,
  // SSO
  getSSOProviders,
  getSSOAuthorizeUrl,
  exchangeSSOToken,
  bootstrapSync,
  getWorkOrders,
  getWorkOrderDetail,
  getWorkOrderDocuments,
  updateWorkOrderStatus,
  submitTimeEntry,
  addNote,
  uploadPhoto,
  submitSignature,
  completeWorkOrder,
  submitLocation,
  clockInOut,
  processOfflineQueue,
  getCustomers,
  getInventory,
  // End of Day
  getDaySummary,
  getPendingItemsCount,
  submitSingleTimeEntry,
  submitAllTimeEntries,
  completeDay,
  // Transfers
  getMyPendingTransfers,
  getTransferDetail,
  acceptTransfer,
  acceptPartialTransfer,
  rejectTransfer,
  lookupTransferByCode,
  // Truck Inventory
  getMyTruckInventory,
  searchInventoryItem,
  useItemFromTruck,
  reportInventoryIssue,
  // Safety Checklists
  getSafetyChecklist,
  submitSafetyChecklist,
  // Tasks
  getWorkOrderTasks,
  toggleWorkOrderTask,
  // Crew Clock-In/Out
  getWorkOrderCrew,
  crewClockIn,
  crewClockOut,
};

// ============================================================================
// SAFETY CHECKLIST API
// ============================================================================

export interface SafetyChecklistItem {
  id: string;
  item_order: number;
  description: string;
  is_required: boolean;
  is_completed: boolean;
  category: 'ppe' | 'hazard' | 'equipment' | 'procedure' | 'environment';
  notes?: string;
}

export interface SafetyChecklistTemplate {
  id: string;
  work_type: string;
  title: string;
  description?: string;
  requires_signature: boolean;
  is_mandatory: boolean;
}

export interface SafetyChecklistData {
  template: SafetyChecklistTemplate;
  items: SafetyChecklistItem[];
  submission?: {
    id: string;
    completed_at: string;
    signature_data?: string;
    signature_name?: string;
    is_synced: boolean;
  };
  is_completed: boolean;
}

export function getSafetyChecklist(workOrderId: string): Promise<ApiResponse<SafetyChecklistData>> {
  return apiRequest<SafetyChecklistData>(`/work-orders/${workOrderId}/safety-checklist`);
}

export function submitSafetyChecklist(
  workOrderId: string,
  data: {
    templateId: string;
    items: Array<{ id: string; is_completed: boolean; notes?: string }>;
    signatureData?: string;
    signatureName?: string;
  }
): Promise<ApiResponse<{ submissionId: string; completedAt: string }>> {
  return apiRequest(`/work-orders/${workOrderId}/safety-checklist`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============================================================================
// WORK ORDER PARTS API (Chain of Custody)
// ============================================================================

export interface WorkOrderPart {
  id: string;
  inventory_item_id: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  quantity: number;
  unit_of_measure: string;
  unit_cost: number | null;
  total_cost: number | null;
  status: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get tasks for a work order
 */
export function getWorkOrderTasks(
  workOrderId: string
): Promise<ApiResponse<WorkOrderTask[]>> {
  return apiRequest<WorkOrderTask[]>(`/work-orders/${workOrderId}/tasks`);
}

/**
 * Toggle task completion status
 */
export function toggleWorkOrderTask(
  workOrderId: string,
  taskId: string,
  isCompleted: boolean
): Promise<ApiResponse<WorkOrderTask>> {
  return apiRequest<WorkOrderTask>(`/work-orders/${workOrderId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_completed: isCompleted }),
  });
}

/**
 * Get all parts attached to a work order
 */
export function getWorkOrderParts(
  workOrderId: string
): Promise<ApiResponse<WorkOrderPart[]>> {
  return apiRequest<WorkOrderPart[]>(`/work-orders/${workOrderId}/parts`);
}

// Part source options
export type PartSource = 'truck' | 'warehouse' | 'purchased' | 'other_truck' | 'job_site' | 'other';

// Expense details for purchased parts
export interface FieldExpense {
  vendor_name: string;
  vendor_address?: string;
  amount: number;
  tax_amount?: number;
  receipt_photo_url?: string;
  receipt_number?: string;
  payment_method?: 'company_card' | 'personal_reimburse' | 'petty_cash';
  card_last_four?: string;
  notes?: string;
}

/**
 * Add a part to a work order (creates chain of custody record)
 * - source: where the part came from (truck, warehouse, purchased, etc.)
 * - expense: required if source is 'purchased' (creates expense record for reimbursement)
 */
export function addWorkOrderPart(
  workOrderId: string,
  data: {
    inventory_item_id: string;
    quantity: number;
    unit_of_measure?: string;
    notes?: string;
    source?: PartSource;
    expense?: FieldExpense;
  }
): Promise<ApiResponse<WorkOrderPart & { expense?: any }>> {
  return apiRequest<WorkOrderPart & { expense?: any }>(`/work-orders/${workOrderId}/parts`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Update part quantity on a work order
 */
export function updateWorkOrderPart(
  workOrderId: string,
  partId: string,
  data: {
    quantity?: number;
    status?: string;
    notes?: string;
  }
): Promise<ApiResponse<WorkOrderPart>> {
  return apiRequest<WorkOrderPart>(`/work-orders/${workOrderId}/parts/${partId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Remove a part from a work order
 */
export function removeWorkOrderPart(
  workOrderId: string,
  partId: string
): Promise<ApiResponse<{ message: string }>> {
  return apiRequest<{ message: string }>(`/work-orders/${workOrderId}/parts/${partId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// WORK ORDER MESSAGING API
// ============================================================================

export type MessageType = 'text' | 'part_request' | 'status_update' | 'photo' | 'system';
export type PartRequestUrgency = 'normal' | 'urgent' | 'critical';
export type PartRequestStatus = 'pending' | 'approved' | 'denied' | 'fulfilled';

export interface MessageSender {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
}

export interface PartRequestDetails {
  sku: string;
  name: string;
  quantity: number;
  urgency: PartRequestUrgency;
  notes?: string;
  status: PartRequestStatus;
  approved_by?: string;
  approved_at?: string;
  denied_by?: string;
  denied_at?: string;
  denial_reason?: string;
  fulfilled_by?: string;
  fulfilled_at?: string;
}

export interface Message {
  id: string;
  work_order_id: string;
  sender_id: string;
  sender: MessageSender;
  content: string;
  message_type: MessageType;
  parent_message_id?: string;
  part_request?: PartRequestDetails;
  is_read: boolean;
  read_at?: string;
  created_at: string;
  updated_at: string;
}

export interface MessagesResponse {
  messages: Message[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Get messages for a work order (paginated, cursor-based)
 */
export function getWorkOrderMessages(
  workOrderId: string,
  cursor?: string
): Promise<ApiResponse<MessagesResponse>> {
  const params = new URLSearchParams();
  if (cursor) params.append('cursor', cursor);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<MessagesResponse>(`/work-orders/${workOrderId}/messages${query}`);
}

/**
 * Send a text message to a work order
 */
export function sendMessage(
  workOrderId: string,
  data: { content: string; messageType?: MessageType; parentMessageId?: string }
): Promise<ApiResponse<Message>> {
  return apiRequest<Message>(`/work-orders/${workOrderId}/messages`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Create a part request message
 */
export function createPartRequest(
  workOrderId: string,
  data: {
    sku: string;
    name: string;
    quantity: number;
    urgency: PartRequestUrgency;
    notes?: string;
  }
): Promise<ApiResponse<Message>> {
  return apiRequest<Message>(`/work-orders/${workOrderId}/messages/part-request`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Mark messages as read up to a specific message ID
 */
export function markMessagesRead(
  workOrderId: string,
  upToMessageId: string
): Promise<ApiResponse<{ success: boolean }>> {
  return apiRequest<{ success: boolean }>(`/messages/${upToMessageId}/read`, {
    method: 'PATCH',
    body: JSON.stringify({ workOrderId }),
  });
}

/**
 * Update part request status (approve/deny/fulfill)
 */
export function updatePartRequestStatus(
  messageId: string,
  status: 'approved' | 'denied' | 'fulfilled',
  reason?: string
): Promise<ApiResponse<Message>> {
  return apiRequest<Message>(`/messages/${messageId}/part-request/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason }),
  });
}

/**
 * Get unread message counts for all work orders
 */
export function getUnreadCounts(): Promise<ApiResponse<{ [workOrderId: string]: number }>> {
  return apiRequest<{ [workOrderId: string]: number }>('/messages/unread-counts');
}

/**
 * Get messages mentioning the current user
 */
export function getMentions(
  cursor?: string
): Promise<ApiResponse<MessagesResponse>> {
  const params = new URLSearchParams();
  if (cursor) params.append('cursor', cursor);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<MessagesResponse>(`/messages/mentions${query}`);
}

// ============================================================================
// CHANGE ORDER REQUEST API
// ============================================================================

export interface ChangeOrderRequest {
  id: string;
  action_type: 'CHANGE_ORDER_REQUEST';
  title: string;
  description: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'BLOCKED' | 'RESOLVED' | 'DISMISSED';
  created_at: string;
  updated_at: string;
  metadata?: {
    source: string;
    work_order_number: string;
    work_order_title: string;
    requested_by_name: string;
    requested_at: string;
    estimated_cost?: number;
    estimated_hours?: number;
  };
}

/**
 * Create a change order request from the field
 * Used when tech discovers additional work needed on-site
 */
export function createChangeOrderRequest(
  workOrderId: string,
  data: {
    description: string;
    urgency?: 'normal' | 'urgent';
    estimatedCost?: number;
    estimatedHours?: number;
  }
): Promise<ApiResponse<{ action: ChangeOrderRequest; message: string }>> {
  return apiRequest<{ action: ChangeOrderRequest; message: string }>(
    `/work-orders/${workOrderId}/change-order-request`,
    {
      method: 'POST',
      body: JSON.stringify({
        description: data.description,
        urgency: data.urgency || 'normal',
        estimated_cost: data.estimatedCost,
        estimated_hours: data.estimatedHours,
      }),
    }
  );
}

/**
 * Get change order requests for a work order
 */
export function getChangeOrderRequests(
  workOrderId: string
): Promise<ApiResponse<{ requests: ChangeOrderRequest[] }>> {
  return apiRequest<{ requests: ChangeOrderRequest[] }>(
    `/work-orders/${workOrderId}/change-order-requests`
  );
}

// ============================================================================
// PHOTO-TO-QUOTE AI API
// ============================================================================

export interface EquipmentItem {
  type: string;
  brand?: string;
  model?: string;
  capacity?: string;
  condition: 'new' | 'good' | 'aging' | 'damaged' | 'code_violation';
  issues?: string[];
}

export interface WorkScopeItem {
  task: string;
  description: string;
  confidence: number;
  urgency: 'routine' | 'priority' | 'urgent';
}

export interface CostItemSuggestion {
  task: string;
  description?: string;
  urgency?: 'routine' | 'priority' | 'urgent';
  confidence: number;
  confidence_level: 'high' | 'medium' | 'low';
  cost_item_id?: string;
  name?: string;
  item_code?: string;
  category?: string;
  quantity: number;
  unit_price?: number;
  labor_hours?: number;
  unit_of_measure?: string;
  match_type?: string;
}

export interface PhotoAnalysisResult {
  analysis: {
    trade: string;
    equipment: EquipmentItem[];
    work_scope: WorkScopeItem[];
    summary: string;
  };
  suggestions: CostItemSuggestion[];
  tokens_used?: number;
  processing_time_ms?: number;
  upgrade_required?: boolean;
  detected_trade?: string;
  required_plan?: string;
}

export interface PhotoAnalysisUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface PhotoAnalysisQuota {
  calls_remaining: number;
  tokens_remaining: number;
}

export interface DraftEstimateResult {
  estimate_id: string;
  estimate_number: string;
  title: string;
  status: string;
  area: {
    id: string;
    name: string;
  };
  line_items: Array<{
    id: string;
    description: string;
    quantity: number;
    line_total: number;
    confidence_level: 'high' | 'medium' | 'low';
  }>;
  totals: {
    material: number;
    labor: number;
    total: number;
  };
}

/**
 * Analyze a job site photo using AI to identify equipment and suggest line items
 */
export function analyzePhotoForQuote(
  data: {
    image: string; // Base64 encoded
    mimeType: string;
    context?: {
      description?: string;
      location?: string;
      workOrderId?: string;
      customerId?: string;
    };
    screen?: string;
  }
): Promise<ApiResponse<PhotoAnalysisResult> & { usage?: PhotoAnalysisUsage; quota?: PhotoAnalysisQuota }> {
  return apiRequest<PhotoAnalysisResult>('/ai/photo-to-quote', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Create a draft estimate from photo analysis suggestions
 */
export function createEstimateFromPhotoAnalysis(
  data: {
    suggestions: CostItemSuggestion[];
    customerId?: string;
    workOrderId?: string;
    location?: string;
  }
): Promise<ApiResponse<DraftEstimateResult>> {
  return apiRequest<DraftEstimateResult>('/ai/photo-to-quote/create-estimate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============================================================================
// SITE EQUIPMENT API (Property Profiles)
// ============================================================================

export interface SiteEquipmentItem {
  id: string;
  tenant_id: string;
  site_id: string;
  site_name?: string;
  customer_id?: string;
  customer_name?: string;
  equipment_tag?: string;
  equipment_type: string;
  category?: string;
  brand?: string;
  model?: string;
  serial_number?: string;
  capacity?: string;
  specifications?: Record<string, any>;
  location_description?: string;
  location_notes?: string;
  install_date?: string;
  installed_by?: string;
  age_years?: number;
  warranty_start_date?: string;
  warranty_end_date?: string;
  warranty_provider?: string;
  warranty_terms?: string;
  warranty_status?: 'active' | 'expiring_soon' | 'expired' | 'unknown';
  condition: 'new' | 'good' | 'fair' | 'poor' | 'critical' | 'decommissioned';
  last_inspected_date?: string;
  next_service_due?: string;
  notes?: string;
  is_active: boolean;
  created_at: string;
  photo_count: number;
  service_count: number;
  last_service_date?: string;
  last_service_type?: string;
}

export interface SiteEquipmentResponse {
  site: {
    id: string;
    name: string;
    customer_id: string;
    customer_name: string;
    address_line1?: string;
    city?: string;
    state?: string;
  } | null;
  equipment: SiteEquipmentItem[];
  summary: {
    total: number;
    by_category: Record<string, number>;
    warranty_expiring: number;
    warranty_expired: number;
    needs_service: number;
  };
}

/**
 * Get equipment installed at a site ("What's installed here")
 */
export function getSiteEquipment(
  siteId: string,
  includeInactive?: boolean
): Promise<ApiResponse<SiteEquipmentResponse>> {
  const params = new URLSearchParams();
  if (includeInactive) params.append('include_inactive', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<SiteEquipmentResponse>(`/site-equipment/by-site/${siteId}${query}`);
}

/**
 * Get equipment detail by ID
 */
export function getSiteEquipmentDetail(
  equipmentId: string
): Promise<ApiResponse<SiteEquipmentItem & { photos: any[]; service_history: any[] }>> {
  return apiRequest<SiteEquipmentItem & { photos: any[]; service_history: any[] }>(
    `/site-equipment/${equipmentId}`
  );
}

/**
 * Add service history entry for equipment
 */
export function addEquipmentServiceEntry(
  equipmentId: string,
  data: {
    work_order_id?: string;
    service_date?: string;
    service_type: string;
    description?: string;
    outcome?: string;
    condition_after?: string;
    notes?: string;
    next_service_recommended?: string;
  }
): Promise<ApiResponse<any>> {
  return apiRequest<any>(`/site-equipment/${equipmentId}/service`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============================================================================
// CREW CLOCK-IN/OUT API
// ============================================================================

export interface CrewMember {
  technician_id: string;
  first_name: string;
  last_name: string;
  role: 'lead' | 'crew' | 'apprentice';
  phone?: string;
  is_clocked_in: boolean;
  active_time_entry_id?: string | null;
  clock_in_time?: string | null;
  total_hours_today?: number;
  verification_photo_url?: string | null;
}

export interface CrewClockInRequest {
  technicianId: string;
  verificationPhotoBase64?: string;
  signatureData?: string;
  location?: { latitude: number; longitude: number };
}

export interface CrewClockOutRequest {
  technicianId: string;
  location?: { latitude: number; longitude: number };
  notes?: string;
}

export function getWorkOrderCrew(
  workOrderId: string
): Promise<ApiResponse<{ success: boolean; crew: CrewMember[] }>> {
  return apiRequest(`/mobile/sync/work-orders/${workOrderId}/crew`);
}

export function crewClockIn(
  workOrderId: string,
  data: CrewClockInRequest
): Promise<ApiResponse<{ success: boolean; timeEntry: any }>> {
  return apiRequest(`/mobile/sync/work-orders/${workOrderId}/crew-clock-in`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function crewClockOut(
  workOrderId: string,
  data: CrewClockOutRequest
): Promise<ApiResponse<{ success: boolean; timeEntry: any }>> {
  return apiRequest(`/mobile/sync/work-orders/${workOrderId}/crew-clock-out`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============================================================================
// SELF CLOCK-IN/OUT API (Crew member on own device)
// ============================================================================

export interface SelfClockInRequest {
  verificationPhotoBase64?: string;
  location?: { latitude: number; longitude: number; accuracy?: number };
}

export interface SelfClockOutRequest {
  location?: { latitude: number; longitude: number; accuracy?: number };
  notes?: string;
}

export function selfClockIn(
  workOrderId: string,
  data: SelfClockInRequest
): Promise<ApiResponse<{ success: boolean; timeEntry: any }>> {
  return apiRequest(`/mobile/sync/work-orders/${workOrderId}/self-clock-in`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function createClockInSession(
  workOrderId: string
): Promise<ApiResponse<{ success: boolean; session: { id: string; token: string; expiresAt: string; qrUrl: string } }>> {
  return apiRequest(`/work-orders/${workOrderId}/clock-in-session`, {
    method: 'POST',
  });
}

export function selfClockOut(
  workOrderId: string,
  data: SelfClockOutRequest
): Promise<ApiResponse<{ success: boolean; timeEntry: any }>> {
  return apiRequest(`/mobile/sync/work-orders/${workOrderId}/self-clock-out`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
