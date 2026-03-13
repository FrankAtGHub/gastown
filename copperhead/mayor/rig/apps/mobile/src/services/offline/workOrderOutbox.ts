/**
 * Work Order Offline Outbox
 *
 * Queues work order operations when offline and syncs when online.
 * Supports all mobile work order operations:
 * - Status updates
 * - Time entries
 * - Notes
 * - Photos
 * - Signatures
 * - Completions
 * - Location updates
 *
 * Events are stored in AsyncStorage and replayed in FIFO order.
 * Handles retry logic and permanent failure marking.
 *
 * @module services/offline/workOrderOutbox
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import {
  WorkOrderOutboxEvent,
  WorkOrderOutboxStats,
  WorkOrderOutboxConfig,
  WorkOrderOperationType,
  WorkOrderPayload,
  StatusUpdatePayload,
  TimeEntryPayload,
  NotePayload,
  PhotoPayload,
  SignaturePayload,
  CompletionPayload,
  LocationPayload,
  SyncResult,
  SyncHandlerResult,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const OUTBOX_STORAGE_KEY = '@fieldops/workorder_outbox';
const MAX_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 5000;
const SYNC_DEBOUNCE_MS = 1000;

// ============================================================================
// WORK ORDER OUTBOX CLASS
// ============================================================================

class WorkOrderOutbox {
  private events: WorkOrderOutboxEvent[] = [];
  private isLoaded = false;
  private isSyncing = false;
  private config: WorkOrderOutboxConfig = {};
  private unsubscribeNetInfo: (() => void) | null = null;
  private syncTimeout: NodeJS.Timeout | null = null;

  /**
   * Initialize the outbox - load from storage and subscribe to network changes
   */
  async initialize(config: WorkOrderOutboxConfig = {}): Promise<void> {
    this.config = config;

    await this.loadFromStorage();

    this.unsubscribeNetInfo = NetInfo.addEventListener(this.handleNetworkChange);

    console.log('[WorkOrderOutbox] Initialized with', this.events.length, 'pending events');
  }

  /**
   * Cleanup - unsubscribe from network changes
   */
  destroy(): void {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
  }

  /**
   * Update config handlers (useful for React context updates)
   */
  updateConfig(config: Partial<WorkOrderOutboxConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ============================================================================
  // ADD OPERATIONS
  // ============================================================================

  async addStatusUpdate(payload: StatusUpdatePayload): Promise<string> {
    return this.addEvent('STATUS_UPDATE', payload, payload.workOrderId);
  }

  async addTimeEntry(payload: TimeEntryPayload): Promise<string> {
    return this.addEvent('TIME_ENTRY', payload, payload.workOrderId);
  }

  async addNote(payload: NotePayload): Promise<string> {
    return this.addEvent('NOTE', payload, payload.workOrderId);
  }

  async addPhoto(payload: PhotoPayload): Promise<string> {
    return this.addEvent('PHOTO', payload, payload.workOrderId);
  }

  async addSignature(payload: SignaturePayload): Promise<string> {
    return this.addEvent('SIGNATURE', payload, payload.workOrderId);
  }

  async addCompletion(payload: CompletionPayload): Promise<string> {
    return this.addEvent('COMPLETION', payload, payload.workOrderId);
  }

  async addLocation(payload: LocationPayload): Promise<string> {
    return this.addEvent('LOCATION', payload, 'global');
  }

  private async addEvent(
    type: WorkOrderOperationType,
    payload: WorkOrderPayload,
    workOrderId: string
  ): Promise<string> {
    const event: WorkOrderOutboxEvent = {
      id: this.generateId(),
      type,
      payload,
      workOrderId,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      lastError: null,
      status: 'pending',
    };

    this.events.push(event);
    await this.saveToStorage();

    console.log(`[WorkOrderOutbox] Added ${type} event:`, event.id, 'for WO:', workOrderId);

    this.scheduleSyncAttempt();

    return event.id;
  }

  // ============================================================================
  // QUERY OPERATIONS
  // ============================================================================

  getStats(): WorkOrderOutboxStats {
    const pending = this.events.filter(e => e.status === 'pending').length;
    const failed = this.events.filter(e => e.status === 'failed').length;

    const byWorkOrder: Record<string, number> = {};
    const byType: Record<WorkOrderOperationType, number> = {
      STATUS_UPDATE: 0,
      TIME_ENTRY: 0,
      NOTE: 0,
      PHOTO: 0,
      SIGNATURE: 0,
      COMPLETION: 0,
      LOCATION: 0,
    };

    for (const event of this.events) {
      if (event.status !== 'pending') continue;
      byWorkOrder[event.workOrderId] = (byWorkOrder[event.workOrderId] || 0) + 1;
      byType[event.type] = (byType[event.type] || 0) + 1;
    }

    return {
      pending,
      failed,
      total: this.events.length,
      byWorkOrder,
      byType,
    };
  }

  getPendingEvents(): WorkOrderOutboxEvent[] {
    return [...this.events.filter(e => e.status === 'pending')];
  }

  getFailedEvents(): WorkOrderOutboxEvent[] {
    return [...this.events.filter(e => e.status === 'failed')];
  }

  getEventsForWorkOrder(workOrderId: string): WorkOrderOutboxEvent[] {
    return [...this.events.filter(e => e.workOrderId === workOrderId)];
  }

  hasPendingEvents(): boolean {
    return this.events.some(e => e.status === 'pending');
  }

  hasPendingForWorkOrder(workOrderId: string): boolean {
    return this.events.some(e => e.workOrderId === workOrderId && e.status === 'pending');
  }

  // ============================================================================
  // MANAGEMENT OPERATIONS
  // ============================================================================

  async retryEvent(eventId: string): Promise<boolean> {
    const event = this.events.find(e => e.id === eventId);
    if (!event || event.status !== 'failed') {
      return false;
    }

    event.status = 'pending';
    event.retryCount = 0;
    event.lastError = null;

    await this.saveToStorage();
    this.scheduleSyncAttempt();

    return true;
  }

  async discardEvent(eventId: string): Promise<boolean> {
    const index = this.events.findIndex(e => e.id === eventId);
    if (index === -1) {
      return false;
    }

    this.events.splice(index, 1);
    await this.saveToStorage();

    console.log('[WorkOrderOutbox] Discarded event:', eventId);
    return true;
  }

  async clearAll(): Promise<void> {
    this.events = [];
    await AsyncStorage.removeItem(OUTBOX_STORAGE_KEY);
    console.log('[WorkOrderOutbox] Cleared all events');
  }

  async clearForWorkOrder(workOrderId: string): Promise<number> {
    const before = this.events.length;
    this.events = this.events.filter(e => e.workOrderId !== workOrderId);
    const removed = before - this.events.length;

    if (removed > 0) {
      await this.saveToStorage();
      console.log('[WorkOrderOutbox] Cleared', removed, 'events for WO:', workOrderId);
    }

    return removed;
  }

  // ============================================================================
  // SYNC OPERATIONS
  // ============================================================================

  async forceSync(): Promise<SyncResult[]> {
    return this.syncEvents();
  }

  private scheduleSyncAttempt(): void {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }

    this.syncTimeout = setTimeout(() => {
      this.attemptSync();
    }, SYNC_DEBOUNCE_MS);
  }

  private attemptSync(): void {
    if (this.isSyncing) {
      return;
    }

    NetInfo.fetch().then(state => {
      if (state.isConnected && this.hasPendingEvents()) {
        this.syncEvents().catch(err => {
          console.error('[WorkOrderOutbox] Sync failed:', err);
          this.config.onSyncError?.(err);
        });
      }
    });
  }

  private async syncEvents(): Promise<SyncResult[]> {
    if (this.isSyncing) {
      return [];
    }

    this.isSyncing = true;
    const results: SyncResult[] = [];

    try {
      const pendingEvents = this.events
        .filter(e => e.status === 'pending')
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

      console.log('[WorkOrderOutbox] Syncing', pendingEvents.length, 'events');

      for (const event of pendingEvents) {
        const result = await this.syncEvent(event);
        results.push(result);

        if (!result.success && event.status === 'pending') {
          // Event failed but can be retried - continue with next events
          // unless it's a critical operation that blocks others
          if (this.isBlockingFailure(event, result)) {
            console.log('[WorkOrderOutbox] Stopping sync due to blocking failure');
            break;
          }
        }
      }

      await this.saveToStorage();
      this.config.onSyncComplete?.(results);
    } finally {
      this.isSyncing = false;
    }

    return results;
  }

  private isBlockingFailure(event: WorkOrderOutboxEvent, result: SyncResult): boolean {
    // Completions should block - don't sync more operations for a completed WO
    if (event.type === 'COMPLETION') return true;

    // Status updates might affect other operations
    if (event.type === 'STATUS_UPDATE' && result.error?.includes('conflict')) return true;

    return false;
  }

  private async syncEvent(event: WorkOrderOutboxEvent): Promise<SyncResult> {
    event.status = 'processing';

    try {
      const handler = this.getHandler(event.type);

      if (!handler) {
        event.status = 'failed';
        event.lastError = 'No sync handler configured';
        return {
          eventId: event.id,
          type: event.type,
          workOrderId: event.workOrderId,
          success: false,
          error: event.lastError,
        };
      }

      const result = await handler(event.payload);

      if (result.success) {
        const index = this.events.findIndex(e => e.id === event.id);
        if (index !== -1) {
          this.events.splice(index, 1);
        }
        console.log('[WorkOrderOutbox] Synced event:', event.id);
        return {
          eventId: event.id,
          type: event.type,
          workOrderId: event.workOrderId,
          success: true,
          data: result.data,
        };
      } else {
        return this.handleEventError(event, result.error || 'API error');
      }
    } catch (error) {
      return this.handleEventError(
        event,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private getHandler(type: WorkOrderOperationType): ((payload: any) => Promise<SyncHandlerResult>) | undefined {
    switch (type) {
      case 'STATUS_UPDATE':
        return this.config.onStatusUpdate;
      case 'TIME_ENTRY':
        return this.config.onTimeEntry;
      case 'NOTE':
        return this.config.onNote;
      case 'PHOTO':
        return this.config.onPhoto;
      case 'SIGNATURE':
        return this.config.onSignature;
      case 'COMPLETION':
        return this.config.onCompletion;
      case 'LOCATION':
        return this.config.onLocation;
      default:
        return undefined;
    }
  }

  private handleEventError(event: WorkOrderOutboxEvent, errorMessage: string): SyncResult {
    event.retryCount++;
    event.lastError = errorMessage;

    if (event.retryCount >= MAX_RETRY_COUNT) {
      event.status = 'failed';
      console.log('[WorkOrderOutbox] Event failed permanently:', event.id, errorMessage);
    } else {
      event.status = 'pending';
      console.log('[WorkOrderOutbox] Event will retry:', event.id, `(${event.retryCount}/${MAX_RETRY_COUNT})`);
    }

    return {
      eventId: event.id,
      type: event.type,
      workOrderId: event.workOrderId,
      success: false,
      error: errorMessage,
    };
  }

  // ============================================================================
  // NETWORK HANDLING
  // ============================================================================

  private handleNetworkChange = (state: NetInfoState): void => {
    console.log('[WorkOrderOutbox] Network state changed:', state.isConnected);

    if (state.isConnected && this.hasPendingEvents()) {
      setTimeout(() => this.attemptSync(), RETRY_DELAY_MS);
    }
  };

  // ============================================================================
  // STORAGE
  // ============================================================================

  private async loadFromStorage(): Promise<void> {
    try {
      const data = await AsyncStorage.getItem(OUTBOX_STORAGE_KEY);
      if (data) {
        this.events = JSON.parse(data);
        // Reset any 'processing' events to 'pending' (app may have crashed)
        this.events.forEach(e => {
          if (e.status === 'processing') {
            e.status = 'pending';
          }
        });
      }
      this.isLoaded = true;
    } catch (error) {
      console.error('[WorkOrderOutbox] Failed to load from storage:', error);
      this.events = [];
      this.isLoaded = true;
    }
  }

  private async saveToStorage(): Promise<void> {
    try {
      await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(this.events));
    } catch (error) {
      console.error('[WorkOrderOutbox] Failed to save to storage:', error);
    }
  }

  private generateId(): string {
    return `wo_outbox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const workOrderOutbox = new WorkOrderOutbox();

export default workOrderOutbox;
