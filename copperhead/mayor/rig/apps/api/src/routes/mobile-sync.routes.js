/**
 * Mobile Sync Routes
 *
 * API endpoints specifically designed for mobile app synchronization.
 * These endpoints are optimized for:
 * - Bandwidth efficiency (minimal payloads)
 * - Offline-first patterns (delta sync support)
 * - Technician-specific data filtering
 *
 * @module routes/mobile-sync
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGate');
const mobileSyncController = require('../controllers/mobile-sync.controller');

// All mobile sync routes require authentication (except login)
// Note: authenticateToken is applied at the route level, not here

/**
 * @route   POST /api/mobile/auth/login
 * @desc    Mobile-specific login (returns user + initial sync data)
 * @access  Public
 */
router.post('/auth/login', mobileSyncController.mobileLogin);

/**
 * @route   POST /api/mobile/auth/refresh
 * @desc    Refresh JWT token
 * @access  Private
 */
router.post('/auth/refresh', mobileSyncController.refreshToken);

/**
 * @route   GET /api/mobile/sync/bootstrap
 * @desc    Initial sync - get all data needed for offline operation
 * @access  Private
 */
router.get('/sync/bootstrap', authenticateToken, mobileSyncController.bootstrapSync);

/**
 * @route   GET /api/mobile/sync/work-orders
 * @desc    Get work orders assigned to current technician
 * @query   since - ISO timestamp for delta sync (optional)
 * @query   status - Filter by status (optional)
 * @access  Private
 */
router.get('/sync/work-orders', authenticateToken, mobileSyncController.getWorkOrders);

/**
 * @route   GET /api/mobile/sync/work-orders/:id
 * @desc    Get single work order with full details
 * @access  Private
 */
router.get('/sync/work-orders/:id', authenticateToken, mobileSyncController.getWorkOrderDetail);

/**
 * @route   GET /api/mobile/sync/work-orders/:id/documents
 * @desc    Get files and drawings from source estimate (for offline download)
 * @access  Private
 */
router.get('/sync/work-orders/:id/documents', authenticateToken, mobileSyncController.getWorkOrderDocuments);

/**
 * @route   PATCH /api/mobile/sync/work-orders/:id/status
 * @desc    Update work order status (en_route, in_progress, completed, etc.)
 * @access  Private
 */
router.patch('/sync/work-orders/:id/status', authenticateToken, mobileSyncController.updateWorkOrderStatus);

/**
 * @route   POST /api/mobile/sync/work-orders/:id/time-entries
 * @desc    Submit time entry for work order
 * @access  Private
 */
router.post('/sync/work-orders/:id/time-entries', authenticateToken, mobileSyncController.submitTimeEntry);

/**
 * @route   POST /api/mobile/sync/work-orders/:id/notes
 * @desc    Add note to work order
 * @access  Private
 */
router.post('/sync/work-orders/:id/notes', authenticateToken, mobileSyncController.addNote);

/**
 * @route   GET /api/mobile/sync/work-orders/:id/photos
 * @desc    Get photos for work order
 * @access  Private
 */
router.get('/sync/work-orders/:id/photos', authenticateToken, mobileSyncController.getPhotos);

/**
 * @route   POST /api/mobile/sync/work-orders/:id/photos
 * @desc    Upload photo attachment
 * @access  Private
 */
router.post('/sync/work-orders/:id/photos', authenticateToken, mobileSyncController.uploadPhoto);

/**
 * @route   POST /api/mobile/sync/work-orders/:id/signature
 * @desc    Submit customer signature
 * @access  Private
 */
router.post(
  '/sync/work-orders/:id/signature',
  authenticateToken,
  requireFeature('digital_signatures'),
  mobileSyncController.submitSignature
);

/**
 * @route   POST /api/mobile/sync/work-orders/:id/complete
 * @desc    Complete work order with all close-out data
 * @access  Private
 */
router.post('/sync/work-orders/:id/complete', authenticateToken, mobileSyncController.completeWorkOrder);

/**
 * @route   POST /api/mobile/sync/location
 * @desc    Submit technician GPS location
 * @access  Private (requires gps_tracking feature)
 */
router.post(
  '/sync/location',
  authenticateToken,
  requireFeature('gps_tracking'),
  mobileSyncController.submitLocation
);

/**
 * @route   POST /api/mobile/sync/clock
 * @desc    Clock in/out for the day
 * @access  Private
 */
router.post('/sync/clock', authenticateToken, mobileSyncController.clockInOut);

/**
 * @route   POST /api/mobile/sync/offline-queue
 * @desc    Submit queued offline actions for processing
 * @body    { actions: [{ type, payload, timestamp }] }
 * @access  Private
 */
router.post('/sync/offline-queue', authenticateToken, mobileSyncController.processOfflineQueue);

/**
 * @route   GET /api/mobile/sync/customers
 * @desc    Get customer data for assigned work orders
 * @access  Private
 */
router.get('/sync/customers', authenticateToken, mobileSyncController.getCustomers);

/**
 * @route   GET /api/mobile/sync/inventory
 * @desc    Get inventory/parts data for work orders
 * @access  Private
 */
router.get('/sync/inventory', authenticateToken, mobileSyncController.getInventory);

// ============================================================================
// CREW CLOCK-IN/OUT ROUTES
// ============================================================================

/**
 * @route   GET /api/mobile/sync/work-orders/:id/crew
 * @desc    Get crew members for a work order with clock-in status
 * @access  Private
 */
router.get('/sync/work-orders/:id/crew', authenticateToken, mobileSyncController.getWorkOrderCrew);

/**
 * @route   POST /api/mobile/sync/work-orders/:id/crew-clock-in
 * @desc    Lead tech clocks in a crew member (creates verified time entry)
 * @body    { technicianId, verificationPhotoBase64?, signatureData?, location? }
 * @access  Private
 */
router.post('/sync/work-orders/:id/crew-clock-in', authenticateToken, mobileSyncController.crewClockIn);

/**
 * @route   POST /api/mobile/sync/work-orders/:id/crew-clock-out
 * @desc    Lead tech clocks out a crew member (closes time entry)
 * @body    { technicianId, location?, notes? }
 * @access  Private
 */
router.post('/sync/work-orders/:id/crew-clock-out', authenticateToken, mobileSyncController.crewClockOut);

/**
 * @route   GET /api/mobile/sync/work-orders/:id/crew-status
 * @desc    Get clock-in times and total hours for all crew on a WO
 * @access  Private
 */
router.get('/sync/work-orders/:id/crew-status', authenticateToken, mobileSyncController.getCrewClockStatus);

/**
 * @route   POST /api/mobile/sync/work-orders/:id/self-clock-in
 * @desc    Crew member clocks themselves in from own device (selfie + GPS)
 * @body    { verificationPhotoBase64?, location? }
 * @access  Private (must be assigned to work order crew)
 */
router.post('/sync/work-orders/:id/self-clock-in', authenticateToken, mobileSyncController.selfClockIn);

/**
 * @route   POST /api/mobile/sync/work-orders/:id/self-clock-out
 * @desc    Crew member clocks themselves out from own device
 * @body    { location?, notes? }
 * @access  Private
 */
router.post('/sync/work-orders/:id/self-clock-out', authenticateToken, mobileSyncController.selfClockOut);

// ============================================================================
// END OF DAY ROUTES
// ============================================================================

/**
 * @route   GET /api/mobile/technicians/:id/day-summary
 * @desc    Get technician's day summary (completed WOs, pending items, tomorrow schedule)
 * @query   date - Target date (default: today)
 * @access  Private
 */
router.get('/technicians/:id/day-summary', authenticateToken, mobileSyncController.getDaySummary);

/**
 * @route   PATCH /api/mobile/time-entries/:id/submit
 * @desc    Submit single time entry
 * @access  Private
 */
router.patch('/time-entries/:id/submit', authenticateToken, mobileSyncController.submitSingleTimeEntry);

/**
 * @route   POST /api/mobile/technicians/:id/time-entries/submit-all
 * @desc    Submit all pending time entries for technician
 * @body    { date?: string } - Target date (default: today)
 * @access  Private
 */
router.post('/technicians/:id/time-entries/submit-all', authenticateToken, mobileSyncController.submitAllTimeEntries);

/**
 * @route   POST /api/mobile/technicians/:id/complete-day
 * @desc    Complete technician's day (validates no pending items)
 * @body    { date, totalHoursWorked, totalJobsCompleted, notes }
 * @access  Private
 */
router.post('/technicians/:id/complete-day', authenticateToken, mobileSyncController.completeDay);

/**
 * @route   GET /api/mobile/technicians/:id/pending-count
 * @desc    Get count of pending items (time entries, photos, parts)
 * @query   date - Target date (default: today)
 * @access  Private
 */
router.get('/technicians/:id/pending-count', authenticateToken, mobileSyncController.getPendingItemsCount);

module.exports = router;
