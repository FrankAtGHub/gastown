// Field Ops API - Main Server Entry Point
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

// Import routes
const authRoutes = require('./routes/auth.routes');
const workOrderRoutes = require('./routes/workOrder.routes');
const customerRoutes = require('./routes/customer.routes');
const userRoutes = require('./routes/user.routes');
const fileRoutes = require('./routes/file.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const vehicleRoutes = require('./routes/vehicle.routes');
const transactionRoutes = require('./routes/transaction.routes');
const taskRoutes = require('./routes/task.routes');
const timeEntryRoutes = require('./routes/timeEntry.routes');
const technicianRoutes = require('./routes/technician.routes');
const purchaseOrderRoutes = require('./routes/purchaseOrder.routes');
const vendorRoutes = require('./routes/vendor.routes');
const materialRequestRoutes = require('./routes/materialRequest.routes');
const procurementAnalyticsRoutes = require('./routes/procurementAnalytics.routes');
const deiEventsRoutes = require('./routes/debug/dei-events');
const dispatchRoutes = require('./routes/dispatch.routes');
const crmRoutes = require('./routes/crm.routes');
const mobileSyncRoutes = require('./routes/mobile-sync.routes');
const transferRoutes = require('./routes/transfer.routes');
const inventoryDomainRoutes = require('./routes/inventoryDomain.routes');
const cycleCountRoutes = require('./routes/cycleCount.routes');
const healthRoutes = require('./routes/health.routes');
const wmsReportingRoutes = require('./routes/wmsReporting.routes');
const kitsRoutes = require('./routes/kits.routes');
const loadoutsRoutes = require('./routes/loadouts.routes');
const restockSuggestionsRoutes = require('./routes/restockSuggestions.routes');
const serializedItemsRoutes = require('./routes/serializedItems.routes');
const rmaRoutes = require('./routes/rma.routes');
const warrantyRoutes = require('./routes/warranty.routes');
const lineageRoutes = require('./routes/lineage.routes');
const pricingRoutes = require('./routes/pricing.routes');
const quoteRoutes = require('./routes/quote.routes');
const projectRoutes = require('./routes/project.routes');
const jobTemplateRoutes = require('./routes/jobTemplate.routes');
const pricingRequestRoutes = require('./routes/pricingRequest.routes');
const publicRoutes = require('./routes/public.routes');
const safetyRoutes = require('./routes/safety.routes');
const importRoutes = require('./routes/import.routes');
const photosRoutes = require('./routes/photos.routes');
const messageRoutes = require('./routes/message.routes');
const sitesRoutes = require('./routes/sites.routes');
const siteEquipmentRoutes = require('./routes/siteEquipment.routes');
const templateReuseRoutes = require('./routes/templateReuse.routes');
const estimateAreaRoutes = require('./routes/estimateArea.routes');
const aiRoutes = require('./routes/ai.routes');
const lineItemRoutes = require('./routes/lineItem.routes');
const workTemplateRoutes = require('./routes/workTemplate.routes');
const tenantSettingsRoutes = require('./routes/tenantSettings.routes');
const rolesRoutes = require('./routes/roles.routes');
const barcodeLookupRoutes = require('./routes/barcodeLookup.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const ssoRoutes = require('./routes/sso.routes');
const addOnRoutes = require('./routes/addOn.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const adminSsoRoutes = require('./routes/admin/sso.routes');
const adminAiUsageRoutes = require('./routes/admin/aiUsage.routes');
const adminBetaInvitesRoutes = require('./routes/admin/betaInvites.routes');
const actionRoutes = require('./routes/action.routes');
const laborCostEmployeesRoutes = require('./routes/laborCostEmployees.routes');
const estimateProcurementReviewRoutes = require('./routes/estimateProcurementReview.routes');
const procurementOrchestrationRoutes = require('./routes/procurementOrchestration.routes');
const estimatePdfRoutes = require('./routes/estimatePdf.routes');
const estimateReviewRoutes = require('./routes/estimateReview.routes');
const approvedQueueRoutes = require('./routes/approvedQueue.routes');
const workOrderPdfRoutes = require('./routes/workOrderPdf.routes');
const transferPdfRoutes = require('./routes/transferPdf.routes');
const purchaseOrderPdfRoutes = require('./routes/purchaseOrderPdf.routes');
const changeOrderRequestRoutes = require('./routes/changeOrderRequest.routes');
const taxonomyRoutes = require('./routes/taxonomy.routes');
const integrationsRoutes = require('./routes/integrations.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const paymentRoutes = require('./routes/payment.routes');
const billingRoutes = require('./routes/billing.routes');
const accountingWebhookRoutes = require('./routes/webhooks/accounting.routes');
const notificationRoutes = require('./routes/notification.routes');
const notificationsRoutes = require('./routes/notifications.routes'); // In-app notifications
const notificationPreferencesRoutes = require('./routes/notificationPreferences.routes'); // Notification preferences
const printTemplatesRoutes = require('./routes/printTemplates.routes');
const reportsRoutes = require('./routes/reports.routes');
const inventoryItemRequestRoutes = require('./routes/inventoryItemRequest.routes');
const documentSequencesRoutes = require('./routes/documentSequences.routes');
const procurementWorkflowRoutes = require('./routes/procurementWorkflow.routes');
const maintenanceRoutes = require('./routes/maintenance.routes');
const bugReportRoutes = require('./routes/bugReport.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const docsExchangeRoutes = require('./routes/docsExchange.routes');
const clockInRoutes = require('./routes/clock-in.routes');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { authenticateToken, requireRole, requireSystemAdmin } = require('./middleware/auth');
const { requestIdMiddleware, requestLoggingMiddleware } = require('./middleware/requestLogger');
const { errorTrackingMiddleware } = require('./middleware/errorTracker');

// Import database and services
const { pool } = require('./config/db');
const { validateJwtSecrets } = require('./config/jwt');
const { initializeFeatureService } = require('./services/feature.service');
const { initializeCRMService } = require('./services/crm.service');

// Validate JWT secrets at startup (fatal in production/staging if weak or missing)
validateJwtSecrets();

// Initialize services (redis is optional - pass undefined if not using)
initializeFeatureService(pool);
initializeCRMService(pool);
console.log('✅ Feature and CRM services initialized');

// Import BullMQ queue system (replaces Inngest)
// Conditionally loaded - bullmq requires Redis which isn't available in tests
let initializeQueueSystem = async () => false;
let getAllQueueStats = async () => ({});
let shutdownQueues = async () => {};

if (process.env.NODE_ENV !== 'test') {
  const workers = require('./queues/workers');
  const queues = require('./queues');
  initializeQueueSystem = workers.initializeQueueSystem;
  getAllQueueStats = queues.getAllQueueStats;
  shutdownQueues = queues.shutdown;
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Security headers
app.use(helmet());

// CORS configuration
// CSRF note: This API uses Bearer token auth (Authorization header), not cookies.
// Browsers cannot set custom headers in cross-origin requests without CORS preflight,
// so CSRF attacks are inherently mitigated. Strict CORS origin allowlist below
// provides defense-in-depth.
app.use(cors({
  origin: [
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'http://localhost:8082',
    'http://127.0.0.1:8082',
    'http://localhost:8090',
    'http://127.0.0.1:8090',
    'http://app.fieldops.local',
    'http://api.fieldops.local',
    'https://numeruspro.com',
    'https://www.numeruspro.com',
    'http://localhost:3003',
    ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [])
  ],
  credentials: true
}));

// Body parsing - 1mb default limit for most endpoints.
// Routes needing larger payloads (e.g. AI base64 image/audio) override per-route.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Static file serving for uploaded photos
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Observability middleware (request ID and structured logging)
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);

// Rate limiting - disabled in development/test for E2E testing
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test',
});
app.use('/api/', limiter);

// Stricter rate limiters for unauthenticated endpoints
const publicApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per window for public estimate portal
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const ssoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 SSO attempts per window
  message: { success: false, message: 'Too many SSO attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const mobileAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 mobile login attempts per window (matches web login limiter)
  message: { success: false, message: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 webhook calls per minute (high volume expected from accounting services)
  message: { success: false, message: 'Too many webhook requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================================
// ROUTES
// ============================================================================

// Health check routes (enhanced observability)
app.use('/health', healthRoutes);

// Queue stats endpoint (replaces Inngest dashboard)
app.get('/api/queues/stats', authenticateToken, requireSystemAdmin, async (req, res) => {
  try {
    const stats = await getAllQueueStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Queue stats unavailable', error: err.message });
  }
});

// Debug routes (no auth for testing purposes) - MUST be before catch-all /api routes
if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
  app.use('/api/debug/dei-events', deiEventsRoutes);
}

// API routes
app.use('/api/auth', authRoutes);

// SSO routes (NO authentication - handles OAuth flow)
app.use('/api/sso', ssoLimiter, ssoRoutes);

// Admin SSO routes (requires system admin - platform-level access)
app.use('/api/admin/sso', authenticateToken, requireSystemAdmin, adminSsoRoutes);

// Admin AI usage routes (requires system admin - platform-level access)
app.use('/api/admin/ai', authenticateToken, requireSystemAdmin, adminAiUsageRoutes);

// Admin beta invites routes (requires system admin)
app.use('/api/admin/beta-invites', authenticateToken, adminBetaInvitesRoutes);

// Docs exchange routes (mixed auth - generate requires auth, verify is public)
app.use('/api/docs', docsExchangeRoutes);

// Public routes (NO authentication - customer-facing portals)
// MUST be before catch-all authenticated routes
app.use('/api/public', publicApiLimiter, publicRoutes);

// QR clock-in — unauthenticated (token-based)
app.use('/api/clock-in', clockInRoutes);

// Webhook routes (NO authentication - verified by signatures)
app.use('/api/webhooks', webhookLimiter, accountingWebhookRoutes);

// Mobile sync routes (auth handled per-route for login/refresh endpoints)
// MUST be before catch-all /api route below
app.use('/api/mobile/auth', mobileAuthLimiter); // Rate limit mobile login/refresh
app.use('/api/mobile', mobileSyncRoutes);

app.use('/api/work-orders', authenticateToken, workOrderRoutes);
app.use('/api/work-orders', authenticateToken, changeOrderRequestRoutes); // Change order requests from field
app.use('/api/customers', authenticateToken, customerRoutes);
app.use('/api/sites', authenticateToken, sitesRoutes);
app.use('/api/site-equipment', authenticateToken, siteEquipmentRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/users', authenticateToken, notificationRoutes); // Push notification token management
app.use('/api/files', authenticateToken, fileRoutes);
app.use('/api/inventory', authenticateToken, inventoryRoutes);
app.use('/api/inventory-requests', authenticateToken, inventoryItemRequestRoutes);
app.use('/api/vehicles', authenticateToken, vehicleRoutes);
app.use('/api/transactions', authenticateToken, transactionRoutes);
app.use('/api/time-entries', authenticateToken, timeEntryRoutes);
app.use('/api/technicians', authenticateToken, technicianRoutes);
app.use('/api/purchase-orders', authenticateToken, purchaseOrderRoutes);
app.use('/api/vendors', authenticateToken, vendorRoutes);
app.use('/api/material-requests', authenticateToken, materialRequestRoutes);
app.use('/api/notifications', authenticateToken, notificationsRoutes); // In-app notifications
app.use('/api/notification-preferences', authenticateToken, notificationPreferencesRoutes); // Notification preferences
app.use('/api/analytics/procurement', authenticateToken, procurementAnalyticsRoutes);
app.use('/api/procurement-workflow', authenticateToken, procurementWorkflowRoutes); // Procurement workflow orchestration
app.use('/api/analytics', authenticateToken, analyticsRoutes); // Sales dashboard analytics
app.use('/api/dispatch', authenticateToken, dispatchRoutes);
app.use('/api/crm', authenticateToken, crmRoutes);
app.use('/api/transfers', authenticateToken, transferRoutes);
app.use('/api/inventory/v1', authenticateToken, inventoryDomainRoutes);
app.use('/api/cycle-counts', authenticateToken, cycleCountRoutes);
app.use('/api/reports', authenticateToken, wmsReportingRoutes);
app.use('/api/kits', authenticateToken, kitsRoutes);
app.use('/api/loadouts', authenticateToken, loadoutsRoutes);
app.use('/api/restock-suggestions', authenticateToken, restockSuggestionsRoutes);
app.use('/api/serialized-items', authenticateToken, serializedItemsRoutes);
app.use('/api/rma', authenticateToken, rmaRoutes);
app.use('/api/warranty', authenticateToken, warrantyRoutes);
app.use('/api/lineage', authenticateToken, lineageRoutes);
app.use('/api/pricing', authenticateToken, pricingRoutes);
app.use('/api/labor-cost-employees', authenticateToken, laborCostEmployeesRoutes);
app.use('/api/quotes', authenticateToken, quoteRoutes);
app.use('/api/projects', authenticateToken, projectRoutes);
app.use('/api/job-templates', authenticateToken, jobTemplateRoutes);
app.use('/api/pricing-requests', authenticateToken, pricingRequestRoutes);
app.use('/api/import', authenticateToken, importRoutes); // CSV import routes (A2)
app.use('/api/template-reuse', authenticateToken, templateReuseRoutes);
app.use('/api/estimates', authenticateToken, estimateAreaRoutes);
app.use('/api/estimates', authenticateToken, estimatePdfRoutes); // PDF generation for estimates
app.use('/api/estimates', authenticateToken, estimateReviewRoutes); // Review aggregations for estimates
app.use('/api/estimates', authenticateToken, approvedQueueRoutes); // Approved queue for RSB conversion widget
app.use('/api/work-orders', authenticateToken, workOrderPdfRoutes); // PDF generation for work orders
app.use('/api/transfers', authenticateToken, transferPdfRoutes); // PDF generation for transfers
app.use('/api/purchase-orders', authenticateToken, purchaseOrderPdfRoutes); // PDF generation for purchase orders
app.use('/api/ai', authenticateToken, express.json({ limit: '10mb' }), aiRoutes); // AI services (larger limit for base64 image/audio)
app.use('/api/v1/ai', authenticateToken, express.json({ limit: '10mb' }), aiRoutes); // AI routes (v1 alias)
app.use('/api/line-items', authenticateToken, lineItemRoutes); // Line item catalog for estimates
app.use('/api/procurement/pricing-reviews', authenticateToken, estimateProcurementReviewRoutes); // Procurement pricing review workflow
app.use('/api/procurement', authenticateToken, procurementOrchestrationRoutes); // Procurement workflow orchestration
app.use('/api/work-templates', authenticateToken, workTemplateRoutes); // Dispatch work templates
app.use('/api/settings', authenticateToken, tenantSettingsRoutes); // Tenant settings and preferences
app.use('/api/roles', authenticateToken, rolesRoutes); // Tenant-scoped custom roles
app.use('/api/document-sequences', authenticateToken, documentSequencesRoutes); // Document number sequences (EST, PO, WO)
app.use('/api/print-templates', authenticateToken, printTemplatesRoutes); // Print template configurations
app.use('/api/reports', reportsRoutes); // Reports (timesheets, inventory usage, labor by service) - auth handled in routes
app.use('/api/add-ons', authenticateToken, addOnRoutes); // Tenant add-ons and trade starter packs
app.use('/api/onboarding', authenticateToken, onboardingRoutes); // Tenant onboarding flow
app.use('/api/actions', authenticateToken, actionRoutes); // Non-billable internal action tracking
app.use('/api/barcode', authenticateToken, barcodeLookupRoutes); // Barcode/QR lookup for inventory
app.use('/api/taxonomy', authenticateToken, taxonomyRoutes); // Product taxonomy for AI search
app.use('/api/integrations', authenticateToken, integrationsRoutes); // QuickBooks/Xero integrations
app.use('/api/invoices', authenticateToken, invoiceRoutes); // Invoice management with accounting sync
app.use('/api/payments', authenticateToken, paymentRoutes); // Payment management with accounting sync
app.use('/api', authenticateToken, billingRoutes); // Billing schedules, milestones, progress invoicing, change orders
app.use('/api', authenticateToken, messageRoutes); // Message routes for work order messaging
app.use('/api', authenticateToken, safetyRoutes); // Safety checklist routes
app.use('/api/photos', authenticateToken, photosRoutes); // Work order photos (Lite MVP)
app.use('/api/maintenance', authenticateToken, maintenanceRoutes); // Maintenance reminders
app.use('/api/bug-reports', bugReportRoutes); // Beta tester bug tracking (auth handled in routes)
app.use('/api/dashboard', authenticateToken, dashboardRoutes); // Dashboard KPIs
app.use('/api', authenticateToken, taskRoutes); // Task routes catch-all - MUST be last

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error tracking middleware (before final error handler)
app.use(errorTrackingMiddleware);

// Error handler (must be last)
app.use(errorHandler);

// ============================================================================
// START SERVER
// ============================================================================

const server = app.listen(PORT, async () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║         🚀 Field Ops API Server Started                  ║
║                                                           ║
║         Environment: ${process.env.NODE_ENV || 'development'}                           ║
║         Port: ${PORT}                                        ║
║         URL: http://localhost:${PORT}                        ║
║         Health: http://localhost:${PORT}/health              ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Initialize BullMQ queue system (non-blocking)
  initializeQueueSystem()
    .then(success => {
      if (success) {
        console.log('✅ BullMQ queue system initialized');
      } else {
        console.log('⚠️  BullMQ queue system not available (Redis may not be running)');
      }
    })
    .catch(err => {
      console.log('⚠️  BullMQ initialization error:', err.message);
    });
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Close HTTP server
  server.close(() => {
    console.log('HTTP server closed');
  });

  // Shutdown queue system
  try {
    await shutdownQueues();
  } catch (err) {
    console.log('Queue shutdown error:', err.message);
  }

  // Close database pool
  try {
    await pool.end();
    console.log('Database pool closed');
  } catch (err) {
    console.log('Database pool close error:', err.message);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  // Close server & exit process
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

module.exports = app;
