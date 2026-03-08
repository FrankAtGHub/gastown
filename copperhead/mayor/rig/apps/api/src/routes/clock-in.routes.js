/**
 * Clock-In Routes — QR-based crew clock-in
 *
 * These endpoints are UNAUTHENTICATED — they use session tokens
 * from clock_in_sessions table instead of JWT auth.
 *
 * Flow:
 * 1. Lead tech creates session: POST /api/work-orders/:id/clock-in-session (authenticated)
 * 2. Crew scans QR → GET /api/clock-in/verify?token=XXX (unauthenticated)
 * 3. Crew submits: POST /api/clock-in/submit (unauthenticated, token in body)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/db');

/**
 * @route   GET /api/clock-in/verify
 * @desc    Verify a clock-in session token, return WO info
 * @query   token - session token from QR code
 * @access  Public (token-based)
 */
router.get('/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }

    const result = await pool.query(`
      SELECT
        cs.id, cs.work_order_id, cs.tenant_id, cs.expires_at, cs.is_active,
        wo.work_order_number, wo.title, wo.service_address_line1,
        wo.service_city, wo.service_state,
        c.name as customer_name
      FROM clock_in_sessions cs
      JOIN work_orders wo ON wo.id = cs.work_order_id
      LEFT JOIN customers c ON c.id = wo.customer_id
      WHERE cs.session_token = $1
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invalid or expired session' });
    }

    const session = result.rows[0];

    if (!session.is_active) {
      return res.status(410).json({ success: false, error: 'Session has been deactivated' });
    }

    if (new Date(session.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'Session has expired' });
    }

    res.json({
      success: true,
      workOrder: {
        id: session.work_order_id,
        work_order_number: session.work_order_number,
        title: session.title,
        address: [session.service_address_line1, session.service_city, session.service_state]
          .filter(Boolean).join(', '),
        customer_name: session.customer_name,
      },
      expiresAt: session.expires_at,
    });
  } catch (error) {
    console.error('Clock-in verify error:', error);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

/**
 * @route   POST /api/clock-in/submit
 * @desc    Submit a QR clock-in — creates time entry
 * @body    { token, technicianName, location? }
 * @access  Public (token-based)
 */
router.post('/submit', async (req, res) => {
  try {
    const { token, technicianName, location } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }
    if (!technicianName || technicianName.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Technician name required (at least 2 characters)' });
    }

    // Validate session
    const sessionResult = await pool.query(`
      SELECT cs.id, cs.work_order_id, cs.tenant_id, cs.expires_at, cs.is_active, cs.created_by,
             wo.technician_id
      FROM clock_in_sessions cs
      JOIN work_orders wo ON wo.id = cs.work_order_id
      WHERE cs.session_token = $1
    `, [token]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invalid session token' });
    }

    const session = sessionResult.rows[0];

    if (!session.is_active) {
      return res.status(410).json({ success: false, error: 'Session deactivated' });
    }

    if (new Date(session.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'Session expired' });
    }

    // Find or match technician by name in the crew
    // For QR clock-in, we look up by name since the crew member may not be logged in
    const crewResult = await pool.query(`
      SELECT woc.technician_id, u.first_name, u.last_name
      FROM work_order_crew woc
      JOIN users u ON u.id = woc.technician_id
      WHERE woc.work_order_id = $1 AND woc.removed_at IS NULL
    `, [session.work_order_id]);

    // Try to match by name (case-insensitive)
    const normalizedName = technicianName.trim().toLowerCase();
    let matchedTechId = null;
    for (const member of crewResult.rows) {
      const fullName = `${member.first_name} ${member.last_name}`.toLowerCase();
      if (fullName === normalizedName || member.first_name.toLowerCase() === normalizedName
          || member.last_name.toLowerCase() === normalizedName) {
        matchedTechId = member.technician_id;
        break;
      }
    }

    // If no crew match, use the session creator (lead tech) as the verified_by
    // and create time entry attributed to lead for tracking
    const technicianId = matchedTechId || session.created_by;

    // Check no open time entry exists
    const openEntry = await pool.query(
      'SELECT id FROM time_entries WHERE user_id = $1 AND work_order_id = $2 AND end_time IS NULL',
      [technicianId, session.work_order_id]
    );
    if (openEntry.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'Already clocked in to this work order' });
    }

    // Create time entry
    const timeEntryResult = await pool.query(`
      INSERT INTO time_entries (
        tenant_id, work_order_id, user_id, start_time,
        start_latitude, start_longitude,
        verified_by_user_id, clock_in_method, notes
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, 'qr_code', $7)
      RETURNING *
    `, [
      session.tenant_id, session.work_order_id, technicianId,
      location?.latitude || null, location?.longitude || null,
      session.created_by,
      matchedTechId ? null : `QR clock-in by: ${technicianName.trim()}`
    ]);

    res.status(201).json({
      success: true,
      timeEntry: timeEntryResult.rows[0],
      matchedCrew: !!matchedTechId,
    });
  } catch (error) {
    console.error('Clock-in submit error:', error);
    res.status(500).json({ success: false, error: 'Clock-in failed' });
  }
});

module.exports = router;
