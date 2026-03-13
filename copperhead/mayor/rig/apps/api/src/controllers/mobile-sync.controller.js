/**
 * Mobile Sync Controller
 *
 * Handles all mobile-specific API requests for technician app.
 * Optimized for offline-first sync patterns.
 *
 * @module controllers/mobile-sync
 */

const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../config/jwt');

/**
 * Mobile Login - Returns user data + initial sync payload
 */
exports.mobileLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    // Get user with tenant info
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name,
              u.role, u.tenant_id, u.is_active,
              t.name as tenant_name
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Generate tokens (algorithm enforced by config/jwt.js)
    const accessToken = signAccessToken({ userId: user.id, tenantId: user.tenant_id, role: user.role });
    const refreshToken = signRefreshToken({ userId: user.id, tenantId: user.tenant_id });

    // Return user info (no password hash)
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        tenantId: user.tenant_id,
        tenantName: user.tenant_name
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 604800 // 7 days in seconds
      },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Mobile login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
};

/**
 * Refresh Token
 */
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'Refresh token required' });
    }

    const decoded = verifyRefreshToken(refreshToken);

    // Get current user role
    const userResult = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [decoded.userId]
    );

    const role = userResult.rows[0]?.role || decoded.role;

    // Generate new access token (algorithm enforced by config/jwt.js)
    const accessToken = signAccessToken({ userId: decoded.userId, tenantId: decoded.tenantId, role });

    res.json({
      success: true,
      accessToken,
      expiresIn: 604800,
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({ success: false, error: 'Invalid refresh token' });
  }
};

/**
 * Bootstrap Sync - Initial data load for offline operation
 */
exports.bootstrapSync = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;

    // Get assigned work orders — includes WOs where user is lead OR crew member
    const workOrdersResult = await pool.query(
      `SELECT wo.*,
              c.name as customer_name,
              COALESCE(s.address_line1, wo.service_address_line1, c.address_line1) as customer_address,
              c.primary_contact_phone as customer_phone, c.primary_contact_email as customer_email,
              s.name as site_name,
              s.access_instructions as site_access_instructions,
              s.latitude as site_latitude,
              s.longitude as site_longitude
       FROM work_orders wo
       LEFT JOIN customers c ON wo.customer_id = c.id
       LEFT JOIN sites s ON wo.site_id = s.id
       WHERE wo.tenant_id = $1
         AND (wo.technician_id = $2
              OR wo.id IN (
                SELECT work_order_id FROM work_order_crew
                WHERE technician_id = $2 AND removed_at IS NULL
              ))
         AND wo.status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY wo.scheduled_date ASC, wo.scheduled_time ASC`,
      [tenantId, userId]
    );

    // Get user profile
    const userResult = await pool.query(
      `SELECT id, email, first_name, last_name, role, phone
       FROM users WHERE id = $1`,
      [userId]
    );

    // Get crew data for all returned work orders
    const workOrderIds = workOrdersResult.rows.map(wo => wo.id);
    let crewByWorkOrder = {};
    if (workOrderIds.length > 0) {
      const crewResult = await pool.query(`
        SELECT woc.work_order_id, woc.technician_id, woc.role,
               u.first_name, u.last_name, u.phone
        FROM work_order_crew woc
        JOIN users u ON u.id = woc.technician_id
        WHERE woc.work_order_id = ANY($1) AND woc.removed_at IS NULL
        ORDER BY woc.role, u.first_name
      `, [workOrderIds]);

      // Group crew by work order
      for (const row of crewResult.rows) {
        if (!crewByWorkOrder[row.work_order_id]) {
          crewByWorkOrder[row.work_order_id] = [];
        }
        crewByWorkOrder[row.work_order_id].push(row);
      }
    }

    // Attach crew array to each work order
    const workOrders = workOrdersResult.rows.map(wo => ({
      ...wo,
      crew: crewByWorkOrder[wo.id] || []
    }));

    res.json({
      success: true,
      user: userResult.rows[0],
      workOrders,
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Bootstrap sync error:', error);
    res.status(500).json({ success: false, error: 'Sync failed' });
  }
};

/**
 * Get Work Orders - With optional delta sync
 */
exports.getWorkOrders = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;
    const { since, status } = req.query;

    // Return work orders for tenant (MVP: all work orders, not just assigned to user)
    let query = `
      SELECT wo.id, wo.tenant_id, wo.work_order_number, wo.customer_id,
             wo.technician_id as assigned_to,
             wo.title, wo.description, wo.work_type, wo.status, wo.priority,
             CASE WHEN wo.scheduled_date IS NOT NULL
                  THEN (wo.scheduled_date || 'T' || COALESCE(wo.scheduled_time::text, '09:00:00'))
                  ELSE NULL END as scheduled_start,
             NULL as scheduled_end,
             wo.estimated_hours, wo.actual_hours,
             wo.phase_type, wo.market, wo.reference_number,
             wo.parts_status, wo.waiting_reason,
             wo.notes, wo.internal_notes,
             wo.site_id,
             COALESCE(s.address_line1, wo.service_address_line1) as service_address_line1,
             COALESCE(s.city, wo.service_city) as service_city,
             COALESCE(s.state, wo.service_state) as service_state,
             COALESCE(s.postal_code, wo.service_postal_code) as service_postal_code,
             s.name as site_name,
             s.access_instructions as site_access_instructions,
             s.latitude as site_latitude,
             s.longitude as site_longitude,
             wo.completed_at, wo.created_at, wo.updated_at,
             c.name as customer_name,
             COALESCE(s.address_line1, wo.service_address_line1, c.address_line1) as customer_address,
             COALESCE(s.city, wo.service_city, c.city) as customer_city,
             COALESCE(s.state, wo.service_state, c.state) as customer_state,
             COALESCE(s.postal_code, wo.service_postal_code, c.postal_code) as customer_postal_code,
             c.primary_contact_name as customer_contact_name,
             c.primary_contact_phone as customer_phone,
             c.primary_contact_email as customer_email,
             wo.source_estimate_id, wo.project_id
      FROM work_orders wo
      LEFT JOIN customers c ON wo.customer_id = c.id
      LEFT JOIN sites s ON wo.site_id = s.id
      WHERE wo.tenant_id = $1
    `;
    const params = [tenantId];

    // Delta sync - only get changes since timestamp
    if (since) {
      params.push(since);
      query += ` AND wo.updated_at > $${params.length}`;
    }

    // Status filter
    if (status) {
      params.push(status);
      query += ` AND wo.status = $${params.length}`;
    } else {
      // Default: exclude closed statuses
      query += ` AND wo.status NOT IN ('COMPLETED', 'CANCELLED')`;
    }

    query += ` ORDER BY wo.scheduled_date ASC, wo.scheduled_time ASC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      workOrders: result.rows,
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get work orders error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch work orders' });
  }
};

/**
 * Get Single Work Order Detail
 */
exports.getWorkOrderDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.user;

    // Get work order with customer + site - using same field mappings as getWorkOrders
    const woResult = await pool.query(
      `SELECT wo.id, wo.tenant_id, wo.work_order_number, wo.customer_id,
              wo.technician_id as assigned_to,
              wo.title, wo.description, wo.work_type, wo.status, wo.priority,
              CASE WHEN wo.scheduled_date IS NOT NULL
                   THEN (wo.scheduled_date || 'T' || COALESCE(wo.scheduled_time::text, '09:00:00'))
                   ELSE NULL END as scheduled_start,
              NULL as scheduled_end,
              wo.estimated_hours, wo.actual_hours,
              wo.phase_type, wo.market, wo.reference_number,
              wo.parts_status, wo.waiting_reason,
              wo.notes, wo.internal_notes,
              wo.site_id,
              COALESCE(s.address_line1, wo.service_address_line1) as service_address_line1,
              COALESCE(s.city, wo.service_city) as service_city,
              COALESCE(s.state, wo.service_state) as service_state,
              COALESCE(s.postal_code, wo.service_postal_code) as service_postal_code,
              s.name as site_name,
              s.access_instructions as site_access_instructions,
              s.latitude as site_latitude,
              s.longitude as site_longitude,
              wo.signature_url, wo.signature_name, wo.signature_date,
              wo.source_estimate_id, wo.project_id,
              wo.completed_at, wo.created_at, wo.updated_at,
              c.name as customer_name,
              COALESCE(s.address_line1, wo.service_address_line1, c.address_line1) as customer_address,
              COALESCE(s.city, wo.service_city, c.city) as customer_city,
              COALESCE(s.state, wo.service_state, c.state) as customer_state,
              COALESCE(s.postal_code, wo.service_postal_code, c.postal_code) as customer_postal_code,
              c.primary_contact_name as customer_contact_name,
              c.primary_contact_phone as customer_phone,
              c.primary_contact_email as customer_email,
              c.notes as customer_notes
       FROM work_orders wo
       LEFT JOIN customers c ON wo.customer_id = c.id
       LEFT JOIN sites s ON wo.site_id = s.id
       WHERE wo.id = $1 AND wo.tenant_id = $2`,
      [id, tenantId]
    );

    if (woResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    const workOrder = woResult.rows[0];

    // Get time entries
    const timeEntriesResult = await pool.query(
      `SELECT * FROM time_entries WHERE work_order_id = $1 ORDER BY start_time DESC`,
      [id]
    );

    // Get notes (from work_order_notes table if exists, fallback to empty)
    let notesRows = [];
    try {
      const notesResult = await pool.query(
        `SELECT won.id, won.content, won.is_internal, won.created_at,
                u.first_name, u.last_name
         FROM work_order_notes won
         LEFT JOIN users u ON won.created_by = u.id
         WHERE won.work_order_id = $1
         ORDER BY won.created_at DESC`,
        [id]
      );
      notesRows = notesResult.rows;
    } catch (e) {
      // Table may not exist yet — graceful fallback
    }

    // Get parts from work_order_parts junction table
    let partsRows = [];
    try {
      const partsResult = await pool.query(
        `SELECT wop.id, wop.inventory_item_id, wop.quantity, wop.status, wop.unit_cost, wop.total_cost,
                ii.name, ii.sku, ii.description, ii.category, ii.unit_of_measure
         FROM work_order_parts wop
         LEFT JOIN inventory_items ii ON wop.inventory_item_id = ii.id
         WHERE wop.work_order_id = $1
         ORDER BY ii.name`,
        [id]
      );
      partsRows = partsResult.rows;
    } catch (e) {
      // Table may not exist yet — graceful fallback
    }

    // Get tasks from tasks table
    let tasksRows = [];
    try {
      const tasksResult = await pool.query(
        `SELECT id, description, is_completed, estimated_hours,
                completed_at, completed_by, sequence_number as sort_order, notes as task_notes
         FROM tasks
         WHERE work_order_id = $1 AND deleted_at IS NULL
         ORDER BY sequence_number ASC, created_at ASC`,
        [id]
      );
      tasksRows = tasksResult.rows;
    } catch (e) {
      // Table may not exist yet — graceful fallback
    }

    res.json({
      success: true,
      data: {
        workOrder,
        timeEntries: timeEntriesResult.rows,
        notes: notesRows,
        photos: [],
        parts: partsRows,
        tasks: tasksRows,
      },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get work order detail error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch work order' });
  }
};

/**
 * Update Work Order Status
 */
exports.updateWorkOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const { userId, tenantId } = req.user;

    // Normalize status to uppercase
    const normalizedStatus = status.toUpperCase();
    const validStatuses = ['DRAFT', 'SCHEDULED', 'ACCEPTED', 'TRAVELING', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(normalizedStatus)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    // Update work order
    const result = await pool.query(
      `UPDATE work_orders
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [normalizedStatus, id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    res.json({
      success: true,
      workOrder: result.rows[0],
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ success: false, error: 'Failed to update status' });
  }
};

/**
 * Submit Time Entry
 * Accepts optional GPS location data for start and end positions
 */
exports.submitTimeEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { startTime, endTime, notes, startLocation, endLocation } = req.body;
    const { userId, tenantId } = req.user;

    // Calculate duration
    let durationMinutes = null;
    if (startTime && endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);
      durationMinutes = Math.round((end - start) / 60000);
    }

    // Extract location data if provided
    const startLat = startLocation?.latitude || null;
    const startLon = startLocation?.longitude || null;
    const startAcc = startLocation?.accuracy || null;
    const endLat = endLocation?.latitude || null;
    const endLon = endLocation?.longitude || null;
    const endAcc = endLocation?.accuracy || null;

    const result = await pool.query(
      `INSERT INTO time_entries (
        work_order_id, user_id, tenant_id, start_time, end_time,
        duration_minutes, notes,
        start_latitude, start_longitude, start_location_accuracy,
        end_latitude, end_longitude, end_location_accuracy,
        location_captured_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      RETURNING *`,
      [
        id, userId, tenantId, startTime, endTime, durationMinutes, notes,
        startLat, startLon, startAcc, endLat, endLon, endAcc,
        (startLat || endLat) ? new Date().toISOString() : null
      ]
    );

    res.json({
      success: true,
      data: result.rows[0],
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Submit time entry error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit time entry' });
  }
};

/**
 * Add Note to Work Order
 */
exports.addNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const { userId } = req.user;

    // For now, store notes in work_orders.description (append)
    // TODO: Create work_order_notes table
    const result = await pool.query(
      `UPDATE work_orders
       SET description = COALESCE(description, '') || E'\\n\\n[' || NOW()::text || '] ' || $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [content, id]
    );

    res.json({
      success: true,
      data: { note: content, addedAt: new Date().toISOString() },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({ success: false, error: 'Failed to add note' });
  }
};

/**
 * Upload Photo - Accepts base64 encoded image
 */
exports.uploadPhoto = async (req, res) => {
  try {
    const { id } = req.params;
    const { base64Data, filename, caption, photoType } = req.body;
    const { userId, tenantId } = req.user;

    if (!base64Data) {
      return res.status(400).json({ success: false, error: 'base64Data is required' });
    }

    // Verify work order exists and belongs to tenant
    const woCheck = await pool.query(
      'SELECT id FROM work_orders WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (woCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    // Generate unique filename
    const photoId = uuidv4();
    const ext = filename ? path.extname(filename) || '.jpg' : '.jpg';
    const storedFilename = `${photoId}${ext}`;

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(__dirname, '../../uploads/photos', id);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Decode and save base64 image
    const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const filePath = path.join(uploadsDir, storedFilename);
    fs.writeFileSync(filePath, base64Content, 'base64');

    // Get file size
    const stats = fs.statSync(filePath);

    // Insert into database
    const result = await pool.query(
      `INSERT INTO work_order_photos (
        id, tenant_id, work_order_id, user_id,
        filename, original_filename, caption, category,
        file_path, file_size_bytes, uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $4)
      RETURNING *`,
      [
        photoId, tenantId, id, userId,
        storedFilename, filename || storedFilename, caption || null, photoType || 'general',
        `uploads/photos/${id}/${storedFilename}`, stats.size
      ]
    );

    const photo = result.rows[0];

    res.json({
      success: true,
      data: {
        id: photo.id,
        workOrderId: id,
        filename: photo.filename,
        caption: photo.caption,
        category: photo.category,
        url: `/api/files/photos/${id}/${storedFilename}`,
        uploadedAt: photo.uploaded_at
      },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Upload photo error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload photo' });
  }
};

/**
 * Get Photos for Work Order
 */
exports.getPhotos = async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.user;

    const result = await pool.query(
      `SELECT id, filename, original_filename, caption, category,
              file_path, uploaded_at, user_id
       FROM work_order_photos
       WHERE work_order_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       ORDER BY uploaded_at DESC`,
      [id, tenantId]
    );

    const photos = result.rows.map(photo => ({
      id: photo.id,
      filename: photo.filename,
      caption: photo.caption,
      category: photo.category,
      url: `/api/files/photos/${id}/${photo.filename}`,
      uploadedAt: photo.uploaded_at,
      uploadedBy: photo.user_id
    }));

    res.json({
      success: true,
      data: photos,
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get photos error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch photos' });
  }
};

/**
 * Submit Customer Signature
 */
exports.submitSignature = async (req, res) => {
  try {
    const { id } = req.params;
    const { signerName } = req.body;

    // TODO: Store signature image and create work_order_signatures table
    // For now, mark work order as signed
    await pool.query(
      `UPDATE work_orders SET updated_at = NOW() WHERE id = $1`,
      [id]
    );

    res.json({
      success: true,
      data: {
        workOrderId: id,
        signerName,
        signedAt: new Date().toISOString()
      },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Submit signature error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit signature' });
  }
};

/**
 * Complete Work Order - Full close-out
 */
exports.completeWorkOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { completionNotes } = req.body;
    const { userId, tenantId } = req.user;

    // Update work order
    const result = await pool.query(
      `UPDATE work_orders
       SET status = 'COMPLETED',
           completed_by = $1,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [userId, id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    res.json({
      success: true,
      data: result.rows[0],
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Complete work order error:', error);
    res.status(500).json({ success: false, error: 'Failed to complete work order' });
  }
};

/**
 * Submit GPS Location
 */
exports.submitLocation = async (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;
    const { userId, tenantId } = req.user;

    const result = await pool.query(
      `INSERT INTO location_logs (
        user_id, tenant_id, latitude, longitude, accuracy, recorded_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *`,
      [userId, tenantId, latitude, longitude, accuracy]
    );

    res.json({
      success: true,
      data: result.rows[0],
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Submit location error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit location' });
  }
};

/**
 * Clock In/Out
 */
exports.clockInOut = async (req, res) => {
  try {
    const { action, latitude, longitude } = req.body;
    const { userId, tenantId } = req.user;

    if (!['in', 'out'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid action. Use "in" or "out"' });
    }

    // Store as a time entry with special type
    const result = await pool.query(
      `INSERT INTO time_entries (
        user_id, tenant_id, start_time, notes, created_at
      ) VALUES ($1, $2, NOW(), $3, NOW())
      RETURNING *`,
      [userId, tenantId, `Clock ${action} at ${latitude || 'unknown'},${longitude || 'unknown'}`]
    );

    res.json({
      success: true,
      data: { action, recordedAt: new Date().toISOString() },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Clock in/out error:', error);
    res.status(500).json({ success: false, error: 'Failed to record clock entry' });
  }
};

/**
 * Process Offline Queue - Batch process queued actions
 */
exports.processOfflineQueue = async (req, res) => {
  try {
    const { actions } = req.body;
    const { userId, tenantId } = req.user;

    if (!Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ success: false, error: 'No actions to process' });
    }

    const results = [];
    const errors = [];

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'UPDATE_STATUS':
            await pool.query(
              `UPDATE work_orders SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
              [action.payload.status, action.payload.workOrderId, tenantId]
            );
            results.push({ actionId: action.id, success: true });
            break;

          case 'ADD_TIME_ENTRY':
            await pool.query(
              `INSERT INTO time_entries (work_order_id, user_id, tenant_id, start_time, end_time, notes, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [action.payload.workOrderId, userId, tenantId,
               action.payload.startTime, action.payload.endTime,
               action.payload.notes, action.timestamp]
            );
            results.push({ actionId: action.id, success: true });
            break;

          case 'ADD_NOTE':
            await pool.query(
              `UPDATE work_orders
               SET description = COALESCE(description, '') || E'\\n\\n[' || $1 || '] ' || $2,
                   updated_at = NOW()
               WHERE id = $3`,
              [action.timestamp, action.payload.content, action.payload.workOrderId]
            );
            results.push({ actionId: action.id, success: true });
            break;

          case 'LOCATION_UPDATE':
            await pool.query(
              `INSERT INTO location_logs (user_id, tenant_id, latitude, longitude, recorded_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [userId, tenantId, action.payload.latitude, action.payload.longitude, action.timestamp]
            );
            results.push({ actionId: action.id, success: true });
            break;

          default:
            errors.push({ actionId: action.id, error: 'Unknown action type' });
        }
      } catch (actionError) {
        errors.push({ actionId: action.id, error: actionError.message });
      }
    }

    res.json({
      success: true,
      data: {
        processed: results.length,
        failed: errors.length,
        results,
        errors
      },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Process offline queue error:', error);
    res.status(500).json({ success: false, error: 'Failed to process offline queue' });
  }
};

/**
 * Get Customers for assigned work orders
 */
exports.getCustomers = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;

    const result = await pool.query(
      `SELECT DISTINCT c.*
       FROM customers c
       INNER JOIN work_orders wo ON c.id = wo.customer_id
       WHERE wo.tenant_id = $1 AND wo.technician_id = $2
         AND wo.status NOT IN ('COMPLETED', 'CANCELLED')`,
      [tenantId, userId]
    );

    res.json({
      success: true,
      data: result.rows,
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch customers' });
  }
};

/**
 * Get Inventory items
 */
exports.getInventory = async (req, res) => {
  try {
    const { tenantId } = req.user;

    const result = await pool.query(
      `SELECT id, sku, name, description, category, unit_price, quantity_on_hand
       FROM inventory_items
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY name`,
      [tenantId]
    );

    res.json({
      success: true,
      data: result.rows,
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch inventory' });
  }
};

// ============================================================================
// END OF DAY ENDPOINTS
// ============================================================================

/**
 * Get Day Summary - Complete summary of technician's day
 */
exports.getDaySummary = async (req, res) => {
  try {
    const { id: technicianId } = req.params;
    const { tenantId, userId } = req.user;
    const { date } = req.query;

    // Verify technician is requesting their own data
    if (technicianId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const targetDate = date || new Date().toISOString().split('T')[0];
    const tomorrowDate = new Date(new Date(targetDate).getTime() + 86400000).toISOString().split('T')[0];

    // Get completed work orders for today
    const completedWOs = await pool.query(
      `SELECT wo.*, c.name as customer_name, c.address_line1 as customer_address
       FROM work_orders wo
       LEFT JOIN customers c ON wo.customer_id = c.id
       WHERE wo.tenant_id = $1 AND wo.technician_id = $2
         AND DATE(wo.completed_at) = $3
         AND wo.status = 'COMPLETED'
       ORDER BY wo.completed_at DESC`,
      [tenantId, technicianId, targetDate]
    );

    // Get total hours worked from time entries
    const hoursResult = await pool.query(
      `SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as total_hours,
              COUNT(*) as total_entries
       FROM time_entries
       WHERE tenant_id = $1 AND user_id = $2
         AND DATE(start_time) = $3`,
      [tenantId, technicianId, targetDate]
    );

    // Get pending time entries (not submitted)
    const pendingTimeEntries = await pool.query(
      `SELECT te.*, wo.work_order_number
       FROM time_entries te
       LEFT JOIN work_orders wo ON te.work_order_id = wo.id
       WHERE te.tenant_id = $1 AND te.user_id = $2
         AND DATE(te.start_time) = $3
         AND te.submitted_at IS NULL`,
      [tenantId, technicianId, targetDate]
    );

    // Get pending photos (not synced)
    const pendingPhotos = await pool.query(
      `SELECT p.*, wo.work_order_number
       FROM work_order_photos p
       LEFT JOIN work_orders wo ON p.work_order_id = wo.id
       WHERE p.tenant_id = $1 AND p.user_id = $2
         AND DATE(p.uploaded_at) = $3
         AND p.is_synced = false`,
      [tenantId, technicianId, targetDate]
    );

    // Get tomorrow's schedule
    const tomorrowSchedule = await pool.query(
      `SELECT wo.*, c.name as customer_name, c.address_line1 as customer_address
       FROM work_orders wo
       LEFT JOIN customers c ON wo.customer_id = c.id
       WHERE wo.tenant_id = $1 AND wo.technician_id = $2
         AND wo.scheduled_date = $3
         AND wo.status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY wo.scheduled_time ASC`,
      [tenantId, technicianId, tomorrowDate]
    );

    res.json({
      success: true,
      data: {
        date: targetDate,
        completedWorkOrders: completedWOs.rows,
        totalHoursWorked: parseFloat(hoursResult.rows[0].total_hours) || 0,
        totalWorkOrdersCompleted: completedWOs.rows.length,
        pendingTimeEntries: pendingTimeEntries.rows.map(te => ({
          ...te,
          isPending: true,
          workOrderNumber: te.work_order_number
        })),
        pendingParts: [], // TODO: Add parts tracking
        pendingPhotos: pendingPhotos.rows.map(p => ({
          ...p,
          isPending: true,
          workOrderNumber: p.work_order_number
        })),
        tomorrowSchedule: tomorrowSchedule.rows
      },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get day summary error:', error);
    res.status(500).json({ success: false, error: 'Failed to get day summary' });
  }
};

/**
 * Submit Single Time Entry - Mark as SUBMITTED
 */
exports.submitSingleTimeEntry = async (req, res) => {
  try {
    const { id: timeEntryId } = req.params;
    const { tenantId, userId } = req.user;

    const result = await pool.query(
      `UPDATE time_entries
       SET submitted_at = NOW(), status = 'SUBMITTED', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3
       RETURNING *`,
      [timeEntryId, tenantId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Time entry not found' });
    }

    res.json({
      success: true,
      data: result.rows[0],
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Submit time entry error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit time entry' });
  }
};

/**
 * Submit All Time Entries - Batch submit for technician
 */
exports.submitAllTimeEntries = async (req, res) => {
  try {
    const { id: technicianId } = req.params;
    const { tenantId, userId } = req.user;
    const { date } = req.body;

    if (technicianId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const targetDate = date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `UPDATE time_entries
       SET submitted_at = NOW(), status = 'SUBMITTED', updated_at = NOW()
       WHERE tenant_id = $1 AND user_id = $2
         AND DATE(start_time) = $3
         AND submitted_at IS NULL
       RETURNING id`,
      [tenantId, technicianId, targetDate]
    );

    res.json({
      success: true,
      data: {
        count: result.rows.length,
        submittedIds: result.rows.map(r => r.id)
      },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Submit all time entries error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit time entries' });
  }
};

/**
 * Complete Day - Mark technician's day as complete
 */
exports.completeDay = async (req, res) => {
  try {
    const { id: technicianId } = req.params;
    const { tenantId, userId } = req.user;
    const { date, totalHoursWorked, totalJobsCompleted, notes } = req.body;

    if (technicianId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const targetDate = date || new Date().toISOString().split('T')[0];

    // Check for pending items
    const pendingCheck = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM time_entries WHERE tenant_id = $1 AND user_id = $2 AND DATE(start_time) = $3 AND submitted_at IS NULL) as pending_time_entries,
        (SELECT COUNT(*) FROM work_order_photos WHERE tenant_id = $1 AND user_id = $2 AND DATE(uploaded_at) = $3 AND is_synced = false) as pending_photos`,
      [tenantId, technicianId, targetDate]
    );

    const pending = pendingCheck.rows[0];
    const hasPending = parseInt(pending.pending_time_entries) > 0 || parseInt(pending.pending_photos) > 0;

    if (hasPending) {
      return res.status(400).json({
        success: false,
        error: 'Cannot complete day with pending items',
        data: {
          pendingTimeEntries: parseInt(pending.pending_time_entries),
          pendingPhotos: parseInt(pending.pending_photos)
        }
      });
    }

    // Insert or update day completion log
    const result = await pool.query(
      `INSERT INTO day_completion_logs (
        tenant_id, technician_id, completion_date,
        total_hours, total_jobs_completed, notes
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tenant_id, technician_id, completion_date)
      DO UPDATE SET
        total_hours = $4,
        total_jobs_completed = $5,
        notes = $6,
        completed_at = NOW()
      RETURNING *`,
      [tenantId, technicianId, targetDate, totalHoursWorked || 0, totalJobsCompleted || 0, notes]
    );

    res.json({
      success: true,
      data: result.rows[0],
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Complete day error:', error);
    res.status(500).json({ success: false, error: 'Failed to complete day' });
  }
};

/**
 * Get Pending Items Count
 */
exports.getPendingItemsCount = async (req, res) => {
  try {
    const { id: technicianId } = req.params;
    const { tenantId, userId } = req.user;
    const { date } = req.query;

    if (technicianId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const targetDate = date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM time_entries WHERE tenant_id = $1 AND user_id = $2 AND DATE(start_time) = $3 AND submitted_at IS NULL) as pending_time_entries,
        (SELECT COUNT(*) FROM work_order_photos WHERE tenant_id = $1 AND user_id = $2 AND DATE(uploaded_at) = $3 AND is_synced = false) as pending_photos`,
      [tenantId, technicianId, targetDate]
    );

    const counts = result.rows[0];

    res.json({
      success: true,
      data: {
        pendingTimeEntries: parseInt(counts.pending_time_entries) || 0,
        pendingParts: 0, // TODO: Add parts tracking
        pendingPhotos: parseInt(counts.pending_photos) || 0,
        total: parseInt(counts.pending_time_entries) + parseInt(counts.pending_photos)
      },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get pending items count error:', error);
    res.status(500).json({ success: false, error: 'Failed to get pending count' });
  }
};

/**
 * Get Work Order Documents
 * Returns files and drawings from the source estimate (via lineage)
 * Used by technicians to access manuals, drawings, specs on the job site
 */
exports.getWorkOrderDocuments = async (req, res) => {
  try {
    const { id: workOrderId } = req.params;
    const { tenantId } = req.user;

    // Verify work order exists and belongs to tenant
    const woCheck = await pool.query(
      'SELECT id, work_order_number FROM work_orders WHERE id = $1 AND tenant_id = $2',
      [workOrderId, tenantId]
    );
    if (woCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    // Find the source estimate via lineage (GENERATED_FROM edge)
    const estimateResult = await pool.query(
      `SELECT
         from_node.entity_id as estimate_id,
         from_node.entity_number as estimate_number
       FROM work_lineage_nodes wo_node
       JOIN work_lineage_edges e ON e.to_node_id = wo_node.id
       JOIN work_lineage_nodes from_node ON from_node.id = e.from_node_id
       WHERE wo_node.entity_id = $1
         AND wo_node.node_type = 'work_order'
         AND from_node.node_type = 'estimate'
         AND e.edge_type = 'GENERATED_FROM'
         AND wo_node.tenant_id = $2
       LIMIT 1`,
      [workOrderId, tenantId]
    );

    const documents = { files: [], drawings: [], estimateId: null, estimateNumber: null };

    if (estimateResult.rows.length > 0) {
      const { estimate_id, estimate_number } = estimateResult.rows[0];
      documents.estimateId = estimate_id;
      documents.estimateNumber = estimate_number;

      // Fetch files from the source estimate
      const filesResult = await pool.query(
        `SELECT id, filename, original_filename, file_size_bytes, mime_type,
                category, description, uploaded_at
         FROM estimate_files
         WHERE estimate_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         ORDER BY category, uploaded_at DESC`,
        [estimate_id, tenantId]
      );

      documents.files = filesResult.rows.map(f => ({
        id: f.id,
        name: f.original_filename,
        filename: f.filename,
        size: f.file_size_bytes,
        mimeType: f.mime_type,
        category: f.category,
        description: f.description,
        uploadedAt: f.uploaded_at,
        url: `/uploads/estimate-files/${f.filename}`,
        downloadUrl: `/api/files/estimate-files/${f.filename}`
      }));

      // Fetch drawings from the source estimate
      const drawingsResult = await pool.query(
        `SELECT id, filename, original_filename, file_size_bytes, mime_type,
                drawing_type, page_number, description, thumbnail_path, uploaded_at
         FROM estimate_drawings
         WHERE estimate_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         ORDER BY drawing_type, page_number, uploaded_at DESC`,
        [estimate_id, tenantId]
      );

      documents.drawings = drawingsResult.rows.map(d => ({
        id: d.id,
        name: d.original_filename,
        filename: d.filename,
        size: d.file_size_bytes,
        mimeType: d.mime_type,
        drawingType: d.drawing_type,
        pageNumber: d.page_number,
        description: d.description,
        uploadedAt: d.uploaded_at,
        url: `/uploads/estimate-drawings/${d.filename}`,
        downloadUrl: `/api/files/estimate-drawings/${d.filename}`,
        thumbnailUrl: d.thumbnail_path ? `/uploads/estimate-drawings/${d.thumbnail_path}` : null
      }));
    }

    res.json({
      success: true,
      data: {
        workOrderId,
        workOrderNumber: woCheck.rows[0].work_order_number,
        sourceEstimate: documents.estimateId ? {
          id: documents.estimateId,
          number: documents.estimateNumber
        } : null,
        files: documents.files,
        drawings: documents.drawings,
        totalCount: documents.files.length + documents.drawings.length
      },
      syncTimestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get work order documents error:', error);
    res.status(500).json({ success: false, error: 'Failed to get documents' });
  }
};

// ============================================================================
// CREW CLOCK-IN/OUT ENDPOINTS
// ============================================================================

/**
 * Get Work Order Crew - List crew members with clock-in status
 */
exports.getWorkOrderCrew = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const workOrderId = req.params.id;

    const result = await pool.query(`
      SELECT
        woc.technician_id,
        u.first_name,
        u.last_name,
        woc.role,
        u.phone,
        CASE WHEN te.id IS NOT NULL THEN true ELSE false END as is_clocked_in,
        te.id as active_time_entry_id,
        te.start_time as clock_in_time,
        COALESCE(
          (SELECT SUM(COALESCE(t2.duration_minutes, 0)) / 60.0
           FROM time_entries t2
           WHERE t2.user_id = woc.technician_id
             AND t2.work_order_id = $1
             AND t2.start_time::date = CURRENT_DATE),
          0
        ) as total_hours_today,
        (SELECT wp.file_path FROM work_order_photos wp
         WHERE wp.id = te.verification_photo_id LIMIT 1) as verification_photo_url
      FROM work_order_crew woc
      JOIN users u ON u.id = woc.technician_id
      LEFT JOIN time_entries te ON te.user_id = woc.technician_id
        AND te.work_order_id = $1
        AND te.end_time IS NULL
      WHERE woc.work_order_id = $1
        AND woc.removed_at IS NULL
      ORDER BY
        CASE woc.role WHEN 'lead' THEN 0 WHEN 'crew' THEN 1 WHEN 'apprentice' THEN 2 ELSE 3 END,
        u.first_name
    `, [workOrderId]);

    res.json({
      success: true,
      crew: result.rows
    });
  } catch (error) {
    console.error('Get work order crew error:', error);
    res.status(500).json({ success: false, error: 'Failed to get crew' });
  }
};

/**
 * Crew Clock-In - Lead tech creates time entry for a crew member
 */
exports.crewClockIn = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;
    const workOrderId = req.params.id;
    const { technicianId, verificationPhotoBase64, signatureData, location } = req.body;

    // 1. Validate requester is the lead tech on this WO
    const woResult = await pool.query(
      'SELECT technician_id FROM work_orders WHERE id = $1 AND tenant_id = $2',
      [workOrderId, tenantId]
    );
    if (woResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }
    if (woResult.rows[0].technician_id !== userId) {
      return res.status(403).json({ success: false, error: 'Only the lead tech can clock in crew members' });
    }

    // 2. Validate technicianId is in work_order_crew
    const crewResult = await pool.query(
      'SELECT technician_id, role FROM work_order_crew WHERE work_order_id = $1 AND technician_id = $2 AND removed_at IS NULL',
      [workOrderId, technicianId]
    );
    if (crewResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Technician is not assigned to this crew' });
    }

    // 3. Check no open time entry exists
    const openEntryResult = await pool.query(
      'SELECT id FROM time_entries WHERE user_id = $1 AND work_order_id = $2 AND end_time IS NULL',
      [technicianId, workOrderId]
    );
    if (openEntryResult.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'Crew member is already clocked in' });
    }

    // 4. Handle verification photo
    let verificationPhotoId = null;
    let clockInMethod = 'self';

    if (verificationPhotoBase64) {
      const photoResult = await pool.query(`
        INSERT INTO work_order_photos (tenant_id, work_order_id, user_id, category, file_path, uploaded_at)
        VALUES ($1, $2, $3, 'crew_verification', $4, NOW())
        RETURNING id
      `, [tenantId, workOrderId, userId, `crew-verification/${technicianId}-${Date.now()}.jpg`]);
      verificationPhotoId = photoResult.rows[0].id;
      clockInMethod = signatureData ? 'crew_photo_signature' : 'crew_photo';
    } else if (signatureData) {
      clockInMethod = 'crew_signature';
    }

    // 5. Create time entry
    const timeEntryResult = await pool.query(`
      INSERT INTO time_entries (
        tenant_id, work_order_id, user_id, start_time,
        start_latitude, start_longitude, start_location_accuracy,
        verification_photo_id, verification_signature,
        verified_by_user_id, clock_in_method
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      tenantId, workOrderId, technicianId,
      location?.latitude || null, location?.longitude || null, location?.accuracy || null,
      verificationPhotoId, signatureData || null,
      userId, clockInMethod
    ]);

    res.status(201).json({
      success: true,
      timeEntry: timeEntryResult.rows[0]
    });
  } catch (error) {
    console.error('Crew clock-in error:', error);
    res.status(500).json({ success: false, error: 'Failed to clock in crew member' });
  }
};

/**
 * Crew Clock-Out - Lead tech closes crew member's time entry
 */
exports.crewClockOut = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;
    const workOrderId = req.params.id;
    const { technicianId, location, notes } = req.body;

    // 1. Validate requester is the lead tech
    const woResult = await pool.query(
      'SELECT technician_id FROM work_orders WHERE id = $1 AND tenant_id = $2',
      [workOrderId, tenantId]
    );
    if (woResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }
    if (woResult.rows[0].technician_id !== userId) {
      return res.status(403).json({ success: false, error: 'Only the lead tech can clock out crew members' });
    }

    // 2. Find and close open time entry
    const updateResult = await pool.query(`
      UPDATE time_entries
      SET end_time = NOW(),
          duration_minutes = EXTRACT(EPOCH FROM (NOW() - start_time)) / 60,
          end_latitude = $3,
          end_longitude = $4,
          end_location_accuracy = $5,
          notes = COALESCE($6, notes),
          updated_at = NOW()
      WHERE user_id = $1 AND work_order_id = $2 AND end_time IS NULL
      RETURNING *
    `, [
      technicianId, workOrderId,
      location?.latitude || null, location?.longitude || null, location?.accuracy || null,
      notes || null
    ]);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No open time entry found for this crew member' });
    }

    res.json({
      success: true,
      timeEntry: updateResult.rows[0]
    });
  } catch (error) {
    console.error('Crew clock-out error:', error);
    res.status(500).json({ success: false, error: 'Failed to clock out crew member' });
  }
};

/**
 * Get Crew Clock Status - All crew clock-in times and hours for a WO
 */
exports.getCrewClockStatus = async (req, res) => {
  try {
    const workOrderId = req.params.id;

    const result = await pool.query(`
      SELECT
        woc.technician_id,
        u.first_name,
        u.last_name,
        woc.role,
        te.start_time as clock_in_time,
        te.end_time as clock_out_time,
        COALESCE(
          (SELECT SUM(COALESCE(t2.duration_minutes, 0)) / 60.0
           FROM time_entries t2
           WHERE t2.user_id = woc.technician_id
             AND t2.work_order_id = $1
             AND t2.start_time::date = CURRENT_DATE),
          0
        ) as total_hours_today
      FROM work_order_crew woc
      JOIN users u ON u.id = woc.technician_id
      LEFT JOIN time_entries te ON te.user_id = woc.technician_id
        AND te.work_order_id = $1
        AND te.end_time IS NULL
      WHERE woc.work_order_id = $1
        AND woc.removed_at IS NULL
      ORDER BY woc.role, u.first_name
    `, [workOrderId]);

    res.json({
      success: true,
      crewStatus: result.rows
    });
  } catch (error) {
    console.error('Get crew clock status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get crew status' });
  }
};

/**
 * Self Clock-In - Crew member clocks themselves in from their own device
 */
exports.selfClockIn = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;
    const workOrderId = req.params.id;
    const { verificationPhotoBase64, location } = req.body;

    // 1. Validate WO exists
    const woResult = await pool.query(
      'SELECT id FROM work_orders WHERE id = $1 AND tenant_id = $2',
      [workOrderId, tenantId]
    );
    if (woResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    // 2. Validate caller is assigned to crew
    const crewResult = await pool.query(
      'SELECT technician_id, role FROM work_order_crew WHERE work_order_id = $1 AND technician_id = $2 AND removed_at IS NULL',
      [workOrderId, userId]
    );
    if (crewResult.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'You are not assigned to this work order crew' });
    }

    // 3. Check no open time entry exists
    const openEntryResult = await pool.query(
      'SELECT id FROM time_entries WHERE user_id = $1 AND work_order_id = $2 AND end_time IS NULL',
      [userId, workOrderId]
    );
    if (openEntryResult.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'You are already clocked in' });
    }

    // 4. Handle selfie verification photo
    let verificationPhotoId = null;
    if (verificationPhotoBase64) {
      const photoResult = await pool.query(`
        INSERT INTO work_order_photos (tenant_id, work_order_id, user_id, category, file_path, uploaded_at)
        VALUES ($1, $2, $3, 'self_verification', $4, NOW())
        RETURNING id
      `, [tenantId, workOrderId, userId, `self-verification/${userId}-${Date.now()}.jpg`]);
      verificationPhotoId = photoResult.rows[0].id;
    }

    // 5. Create time entry
    const timeEntryResult = await pool.query(`
      INSERT INTO time_entries (
        tenant_id, work_order_id, user_id, start_time,
        start_latitude, start_longitude, start_location_accuracy,
        verification_photo_id, clock_in_method
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, 'self')
      RETURNING *
    `, [
      tenantId, workOrderId, userId,
      location?.latitude || null, location?.longitude || null, location?.accuracy || null,
      verificationPhotoId
    ]);

    res.status(201).json({
      success: true,
      timeEntry: timeEntryResult.rows[0]
    });
  } catch (error) {
    console.error('Self clock-in error:', error);
    res.status(500).json({ success: false, error: 'Failed to clock in' });
  }
};

/**
 * Self Clock-Out - Crew member clocks themselves out from their own device
 */
exports.selfClockOut = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;
    const workOrderId = req.params.id;
    const { location, notes } = req.body;

    // Find and close the caller's open time entry
    const updateResult = await pool.query(`
      UPDATE time_entries
      SET end_time = NOW(),
          duration_minutes = EXTRACT(EPOCH FROM (NOW() - start_time)) / 60,
          end_latitude = $3,
          end_longitude = $4,
          end_location_accuracy = $5,
          notes = COALESCE($6, notes),
          updated_at = NOW()
      WHERE user_id = $1 AND work_order_id = $2 AND end_time IS NULL
      RETURNING *
    `, [
      userId, workOrderId,
      location?.latitude || null, location?.longitude || null, location?.accuracy || null,
      notes || null
    ]);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No open time entry found' });
    }

    res.json({
      success: true,
      timeEntry: updateResult.rows[0]
    });
  } catch (error) {
    console.error('Self clock-out error:', error);
    res.status(500).json({ success: false, error: 'Failed to clock out' });
  }
};
