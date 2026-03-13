// Work Order Routes
const express = require('express');
const router = express.Router();
const { body, validationResult, query: validationQuery } = require('express-validator');
const { query, getClient } = require('../config/db');
const { requireRole } = require('../middleware/auth');
const {
  emitWorkOrderCreated,
  emitWorkOrderOnHold,
  emitWorkOrderCanceled,
  emitWorkOrderCompleted,
} = require('../dei/events');
const {
  sendWorkOrderCreated: sendQueueWorkOrderCreated,
  sendWorkOrderCompleted: sendQueueWorkOrderCompleted,
  sendWorkOrderStatusChanged,
  sendWorkOrderCancelled,
  sendCheckWorkOrderPartsAvailability,
} = require('../queues/events');
const partsSchedulingService = require('../services/partsScheduling.service');

// ============================================================================
// GET /api/work-orders - Get all work orders (with filtering)
// ============================================================================
router.get('/', async (req, res, next) => {
  try {
    const { status, priority, assigned_to, customer_id, parts_status, ready_to_schedule, page = 1, limit = 20 } = req.query;
    const tenantId = req.user.tenant_id;
    const offset = (page - 1) * limit;

    // Build query dynamically based on filters
    let queryText = `
      SELECT wo.*,
             c.name as customer_name, c.primary_contact_name, c.primary_contact_email, c.primary_contact_phone,
             u.first_name as assigned_first_name, u.last_name as assigned_last_name,
             CASE WHEN u.id IS NOT NULL THEN u.first_name || ' ' || u.last_name END as technician_name,
             (SELECT COUNT(*) FROM work_order_parts wop WHERE wop.work_order_id = wo.id) as parts_count
      FROM work_orders wo
      LEFT JOIN customers c ON wo.customer_id = c.id
      LEFT JOIN users u ON wo.technician_id = u.id
      WHERE wo.tenant_id = $1 AND wo.deleted_at IS NULL
    `;
    const params = [tenantId];
    let paramIndex = 2;

    if (status) {
      queryText += ` AND wo.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (priority) {
      queryText += ` AND wo.priority = $${paramIndex}`;
      params.push(priority);
      paramIndex++;
    }

    if (assigned_to) {
      queryText += ` AND wo.technician_id = $${paramIndex}`;
      params.push(assigned_to);
      paramIndex++;
    }

    if (customer_id) {
      queryText += ` AND wo.customer_id = $${paramIndex}`;
      params.push(customer_id);
      paramIndex++;
    }

    // Parts scheduling filters
    if (parts_status) {
      queryText += ` AND wo.parts_status = $${paramIndex}`;
      params.push(parts_status);
      paramIndex++;
    }

    // ready_to_schedule=true means parts are available and WO is not yet scheduled
    if (ready_to_schedule === 'true') {
      queryText += ` AND wo.parts_status = 'available' AND wo.scheduled_date IS NULL`;
    }

    // waiting_on_parts=true means parts_status is not available
    if (req.query.waiting_on_parts === 'true') {
      queryText += ` AND wo.parts_status IN ('pending_parts', 'partial', 'backordered')`;
    }

    queryText += ` ORDER BY wo.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count for pagination
    const countResult = await query(
      'SELECT COUNT(*) FROM work_orders WHERE tenant_id = $1 AND deleted_at IS NULL',
      [tenantId]
    );

    res.json({
      success: true,
      data: {
        work_orders: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countResult.rows[0].count),
          pages: Math.ceil(countResult.rows[0].count / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/work-orders/:id - Get single work order
// ============================================================================
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    const result = await query(
      `SELECT wo.*,
              c.name as customer_name, c.primary_contact_name, c.primary_contact_email, c.primary_contact_phone,
              u.first_name as assigned_first_name, u.last_name as assigned_last_name,
              creator.first_name as created_by_first_name, creator.last_name as created_by_last_name,
              s.name as site_name, s.address_line1 as service_address_line1, s.address_line2 as service_address_line2,
              s.city as service_city, s.state as service_state, s.postal_code as service_postal_code,
              s.access_instructions as site_access_instructions,
              p.project_number,
              (SELECT COUNT(*) FROM company_assets ca WHERE ca.checkout_work_order_id = wo.id AND ca.deleted_at IS NULL) as assets_checked_out
       FROM work_orders wo
       LEFT JOIN customers c ON wo.customer_id = c.id
       LEFT JOIN users u ON wo.technician_id = u.id
       LEFT JOIN users creator ON wo.created_by = creator.id
       LEFT JOIN sites s ON wo.site_id = s.id
       LEFT JOIN projects p ON wo.project_id = p.id
       WHERE wo.id = $1 AND wo.tenant_id = $2 AND wo.deleted_at IS NULL`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work order not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /api/work-orders - Create new work order
// ============================================================================
router.post(
  '/',
  requireRole('admin', 'manager', 'dispatcher'),
  [
    body('title').trim().notEmpty(),
    body('customer_id').isUUID().optional(),
    body('assigned_to').isUUID().optional(),
    body('priority').isIn(['low', 'medium', 'high', 'urgent']).optional(),
    body('status').isIn(['pending', 'assigned', 'in_progress', 'completed', 'cancelled']).optional(),
  ],
  async (req, res, next) => {
    try {
      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const tenantId = req.user.tenant_id;
      const userId = req.user.id;
      const {
        title,
        description,
        customer_id,
        assigned_to,
        priority = 'medium',
        status = 'pending',
        work_type,
        scheduled_start,
        scheduled_end,
        service_address_line1,
        service_address_line2,
        service_city,
        service_state,
        service_postal_code,
        service_country = 'USA',
        estimated_hours,
        estimated_amount,
        notes
      } = req.body;

      // Generate work order number
      const countResult = await query(
        'SELECT COUNT(*) FROM work_orders WHERE tenant_id = $1',
        [tenantId]
      );
      const workOrderNumber = `WO-${String(parseInt(countResult.rows[0].count) + 1).padStart(6, '0')}`;

      const result = await query(
        `INSERT INTO work_orders (
          tenant_id, work_order_number, customer_id, technician_id, created_by,
          title, description, priority, status, work_type,
          scheduled_start, scheduled_end,
          service_address_line1, service_address_line2, service_city, service_state,
          service_postal_code, service_country,
          estimated_hours, estimated_amount, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        RETURNING *`,
        [
          tenantId, workOrderNumber, customer_id, assigned_to, userId,
          title, description, priority, status, work_type,
          scheduled_start, scheduled_end,
          service_address_line1, service_address_line2, service_city, service_state,
          service_postal_code, service_country,
          estimated_hours, estimated_amount, notes
        ]
      );

      // Emit work order created event (DEI)
      const createdWO = result.rows[0];
      await emitWorkOrderCreated({
        work_order: {
          id: createdWO.id,
          code: createdWO.work_order_number,
          customer_id: createdWO.customer_id,
          tech_id: createdWO.technician_id,
          dispatcher_id: createdWO.created_by,
          trade: createdWO.work_type || 'electrician',
          status: createdWO.status,
          priority: createdWO.priority,
          title: createdWO.title,
          description: createdWO.description,
          scheduled_start: createdWO.scheduled_start,
        },
        actor: { id: userId, role: req.user.role || 'dispatcher', source: 'api' }
      });

      // Trigger queue workflow (if customer_id exists)
      if (createdWO.customer_id) {
        try {
          await sendQueueWorkOrderCreated({
            workOrderId: createdWO.id,
            tenantId: tenantId,
            customerId: createdWO.customer_id,
            priority: createdWO.priority || 'medium',
            scheduledDate: createdWO.scheduled_start,
          });
          console.log('[Queue] Work order lifecycle triggered:', createdWO.id);
        } catch (queueErr) {
          // Log but don't fail - queue is non-blocking
          console.error('[Queue] Failed to trigger workflow:', queueErr.message);
        }
      }

      res.status(201).json({
        success: true,
        message: 'Work order created successfully',
        data: result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// PATCH /api/work-orders/:id - Update work order
// ============================================================================
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const updates = req.body;

    // Check if work order exists and belongs to tenant
    const existingWO = await query(
      'SELECT id, technician_id FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );

    if (existingWO.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work order not found'
      });
    }

    const oldTechId = existingWO.rows[0].technician_id;

    // Build update query dynamically
    // Map assigned_to -> technician_id for API compatibility
    if (updates.assigned_to) {
      updates.technician_id = updates.assigned_to;
      delete updates.assigned_to;
    }
    const allowedFields = [
      'title', 'description', 'customer_id', 'technician_id', 'priority', 'status',
      'work_type', 'scheduled_start', 'scheduled_end', 'scheduled_date', 'scheduled_time',
      'actual_start', 'actual_end',
      'service_address_line1', 'service_address_line2', 'service_city', 'service_state',
      'service_postal_code', 'service_country', 'estimated_hours', 'estimated_amount',
      'actual_hours', 'actual_amount', 'parts_used', 'photos', 'signature_url',
      'signature_name', 'signature_date', 'notes', 'internal_notes', 'market',
      'site_id'
    ];

    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = $${paramIndex}`);
        values.push(updates[key]);
        paramIndex++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    values.push(id, tenantId);
    const queryText = `
      UPDATE work_orders
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
      RETURNING *
    `;

    const result = await query(queryText, values);
    const updatedWO = result.rows[0];

    // Auto-upsert lead in work_order_crew when technician_id changes
    const newTechId = updates.technician_id;
    if (newTechId && newTechId !== oldTechId) {
      const userId = req.user.id;
      // Demote old lead if exists
      if (oldTechId) {
        await query(
          `UPDATE work_order_crew SET role = 'member', updated_at = NOW()
           WHERE work_order_id = $1 AND tenant_id = $2 AND technician_id = $3 AND role = 'lead' AND removed_at IS NULL`,
          [id, tenantId, oldTechId]
        );
      }
      // Upsert new lead
      await query(
        `INSERT INTO work_order_crew (tenant_id, work_order_id, technician_id, role, assigned_by)
         VALUES ($1, $2, $3, 'lead', $4)
         ON CONFLICT (work_order_id, technician_id)
         DO UPDATE SET role = 'lead', removed_at = NULL, removed_by = NULL, updated_at = NOW()
         RETURNING id, technician_id, role as crew_role, true as is_lead`,
        [tenantId, id, newTechId, userId]
      );
    }

    res.json({
      success: true,
      message: 'Work order updated successfully',
      data: updatedWO
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /api/work-orders/:id - Soft delete work order
// ============================================================================
router.delete('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    const result = await query(
      'UPDATE work_orders SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work order not found'
      });
    }

    res.json({
      success: true,
      message: 'Work order deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PATCH /api/work-orders/:id/tech-notes - Update technician notes
// ============================================================================
router.patch('/:id/tech-notes', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tech_notes } = req.body;
    const tenantId = req.user.tenant_id;

    if (!tech_notes) {
      return res.status(400).json({
        success: false,
        message: 'Tech notes are required'
      });
    }

    const result = await query(
      'UPDATE work_orders SET notes = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [tech_notes, id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work order not found'
      });
    }

    res.json({
      success: true,
      message: 'Tech notes updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/work-orders/:id/readiness - Get readiness checklist for a work order
// ============================================================================
router.get('/:id/readiness', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    const result = await query(
      `SELECT wo.parts_status, wo.customer_id, wo.site_id, wo.technician_id, wo.scheduled_date, wo.scheduled_time,
        wo.status,
        c.name as customer_name,
        (SELECT COUNT(*) FROM work_order_parts wop WHERE wop.work_order_id = wo.id) as parts_count,
        (SELECT COUNT(*) FROM work_order_parts wop WHERE wop.work_order_id = wo.id AND wop.status IN ('available', 'staged', 'reserved')) as parts_available,
        (SELECT COUNT(*) FROM work_order_parts wop WHERE wop.work_order_id = wo.id AND wop.status = 'backordered') as parts_backordered,
        (SELECT COUNT(*) FROM company_assets ca WHERE ca.checkout_work_order_id = wo.id AND ca.deleted_at IS NULL) as assets_checked_out,
        (SELECT COUNT(*) FROM tasks t WHERE t.work_order_id = wo.id) as total_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.work_order_id = wo.id AND t.is_completed = true) as completed_tasks
      FROM work_orders wo
      LEFT JOIN customers c ON c.id = wo.customer_id
      WHERE wo.id = $1 AND wo.tenant_id = $2 AND wo.deleted_at IS NULL`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    const wo = result.rows[0];
    const partsCount = parseInt(wo.parts_count) || 0;
    const partsAvailable = parseInt(wo.parts_available) || 0;
    const partsBo = parseInt(wo.parts_backordered) || 0;
    const totalTasks = parseInt(wo.total_tasks) || 0;
    const completedTasks = parseInt(wo.completed_tasks) || 0;

    const checklist = [
      {
        key: 'customer',
        label: 'Customer assigned',
        status: Boolean(wo.customer_id) ? 'ok' : 'missing',
        detail: wo.customer_name || null
      },
      {
        key: 'site',
        label: 'Site/address set',
        status: Boolean(wo.site_id) ? 'ok' : 'missing',
      },
      {
        key: 'technician',
        label: 'Technician assigned',
        status: Boolean(wo.technician_id) ? 'ok' : 'missing',
      },
      {
        key: 'scheduled',
        label: 'Scheduled date set',
        status: wo.scheduled_date ? 'ok' : 'missing',
        detail: wo.scheduled_date ? new Date(wo.scheduled_date).toISOString().split('T')[0] : null
      },
      {
        key: 'parts',
        label: 'Parts available',
        status: partsCount === 0 ? 'ok' :
                (wo.parts_status === 'available' || wo.parts_status === 'ready' || wo.parts_status === 'staged' || wo.parts_status === 'not_required') ? 'ok' :
                partsBo > 0 ? 'warning' : 'warning',
        detail: partsCount === 0 ? 'No parts required' : `${partsAvailable} of ${partsCount} ready`,
      },
      {
        key: 'assets',
        label: 'Assets checked out',
        status: parseInt(wo.assets_checked_out) > 0 ? 'ok' : 'info',
        detail: parseInt(wo.assets_checked_out) > 0 ? `${wo.assets_checked_out} checked out` : 'No assets checked out',
      },
    ];

    // Add backorder items if any
    if (partsBo > 0) {
      checklist.push({
        key: 'backordered',
        label: 'Items on backorder',
        status: 'warning',
        detail: `${partsBo} item(s) backordered`,
      });
    }

    // Add task completion for in-progress+ states
    if (['IN_PROGRESS', 'in_progress', 'WAITING', 'waiting'].includes(wo.status)) {
      checklist.push({
        key: 'tasks',
        label: 'Tasks complete',
        status: totalTasks === 0 ? 'ok' : completedTasks === totalTasks ? 'ok' : 'warning',
        detail: totalTasks === 0 ? 'No tasks defined' : `${completedTasks} of ${totalTasks} complete`,
      });
    }

    res.json({ success: true, data: { checklist } });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PATCH /api/work-orders/:id/status - Update work order status (with state machine)
// ============================================================================
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, context } = req.body;
    const tenantId = req.user.tenant_id;
    const userRole = req.user.role || 'TECHNICIAN'; // Default to TECHNICIAN if not set

    // Get current work order
    const currentWO = await query(
      'SELECT * FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );

    if (currentWO.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    const workOrder = currentWO.rows[0];

    // Build server-side context from DB for validation gates
    const contextQuery = await query(
      `SELECT wo.parts_status, wo.customer_id, wo.site_id, wo.technician_id, wo.scheduled_date,
        (SELECT COUNT(*) FROM work_order_parts wop WHERE wop.work_order_id = wo.id) as parts_count,
        (SELECT COUNT(*) FROM company_assets ca WHERE ca.checkout_work_order_id = wo.id AND ca.deleted_at IS NULL) as assets_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.work_order_id = wo.id AND t.is_completed = false) as incomplete_tasks
      FROM work_orders wo WHERE wo.id = $1 AND wo.tenant_id = $2`,
      [id, tenantId]
    );
    const woContext = contextQuery.rows[0] || {};
    const serverContext = {
      technicianAssigned: Boolean(woContext.technician_id || workOrder.technician_id),
      scheduledTime: woContext.scheduled_date || workOrder.scheduled_date,
      customerAssigned: Boolean(woContext.customer_id || workOrder.customer_id),
      siteId: Boolean(woContext.site_id || workOrder.site_id),
      partsStatus: woContext.parts_status || workOrder.parts_status || 'not_required',
      partsCount: parseInt(woContext.parts_count) || 0,
      assetsCheckedOut: parseInt(woContext.assets_count) > 0,
      allTasksComplete: parseInt(woContext.incomplete_tasks) === 0,
      signatureRequired: workOrder.signature_required || false,
      signatureCaptured: workOrder.signature_captured || false,
    };

    // Import state machine
    const { WorkOrderStateMachine, WorkOrderState, UserRole } = require('@field-ops/shared-domain');

    // Map database status to state machine enum (supports both lower and uppercase)
    const statusMap = {
      // Lowercase (legacy/some seeds)
      'pending': 'DRAFT',
      'assigned': 'SCHEDULED',
      'accepted': 'ACCEPTED',
      'traveling': 'TRAVELING',
      'in_progress': 'IN_PROGRESS',
      'waiting': 'WAITING',
      'completed': 'COMPLETED',
      'urgent': 'URGENT',
      'cancelled': 'CANCELLED',
      // Uppercase (migration standard)
      'DRAFT': 'DRAFT',
      'SCHEDULED': 'SCHEDULED',
      'ACCEPTED': 'ACCEPTED',
      'TRAVELING': 'TRAVELING',
      'IN_PROGRESS': 'IN_PROGRESS',
      'WAITING': 'WAITING',
      'COMPLETED': 'COMPLETED',
      'URGENT': 'URGENT',
      'CANCELLED': 'CANCELLED'
    };

    const reverseStatusMap = Object.fromEntries(
      Object.entries(statusMap).map(([k, v]) => [v, k])
    );

    const currentState = statusMap[workOrder.status] || WorkOrderState.DRAFT;
    const targetState = status.toUpperCase().replace(/-/g, '_');

    // Initialize state machine with current state
    const stateMachine = new WorkOrderStateMachine(currentState);

    // Validate role
    const roleUpper = userRole.toUpperCase();
    if (!UserRole[roleUpper]) {
      return res.status(403).json({
        success: false,
        error: 'Invalid user role',
        errorCode: 'INVALID_ROLE'
      });
    }

    // Attempt transition — server context overrides client for security-critical fields
    const transitionResult = stateMachine.transition(
      WorkOrderState[targetState],
      UserRole[roleUpper],
      serverContext
    );

    if (!transitionResult.success) {
      // Return valid next states + structured blockers for better UX
      const validNextStates = stateMachine.getValidTransitions(UserRole[roleUpper]);
      return res.status(400).json({
        success: false,
        error: transitionResult.error || 'Cannot transition work order',
        errorCode: 'INVALID_STATE_TRANSITION',
        blockers: transitionResult.blockers || [],
        warnings: [],
        details: {
          currentState: reverseStatusMap[currentState] || currentState,
          attemptedState: reverseStatusMap[targetState] || targetState,
          validNextStates: validNextStates.map(s => reverseStatusMap[s] || s)
        }
      });
    }

    // Update database with new status
    const newDbStatus = reverseStatusMap[transitionResult.newState] || status;
    let updateQuery = 'UPDATE work_orders SET status = $1, updated_at = NOW()';
    const params = [newDbStatus, id, tenantId];

    // Update completed_at if transitioning to completed
    if (transitionResult.newState === WorkOrderState.COMPLETED) {
      updateQuery += ', completed_at = NOW()';
    }

    updateQuery += ' WHERE id = $2 AND tenant_id = $3 RETURNING *';

    const result = await query(updateQuery, params);
    const updatedWO = result.rows[0];

    // Emit appropriate events based on status transition
    if (transitionResult.newState === WorkOrderState.COMPLETED) {
      await emitWorkOrderCompleted({
        work_order: {
          id: updatedWO.id,
          code: updatedWO.work_order_number,
          customer_id: updatedWO.customer_id,
          tech_id: updatedWO.technician_id,
          status_from: reverseStatusMap[currentState] || currentState,
          status_to: newDbStatus,
          trade: updatedWO.work_type || 'electrician',
        },
        actor: { id: req.user.id, role: userRole }
      });
    } else if (transitionResult.newState === WorkOrderState.CANCELLED) {
      await emitWorkOrderCanceled({
        work_order: {
          id: updatedWO.id,
          code: updatedWO.work_order_number,
          customer_id: updatedWO.customer_id,
          tech_id: updatedWO.technician_id,
          status_from: reverseStatusMap[currentState] || currentState,
          cancellation_reason: context?.reason || 'Not specified',
          trade: updatedWO.work_type || 'electrician',
        },
        actor: { id: req.user.id, role: userRole }
      });
    }

    // Get valid next states for response
    const validNextStates = stateMachine.getValidTransitions(UserRole[roleUpper]);

    // Trigger BullMQ status change event
    try {
      await sendWorkOrderStatusChanged({
        workOrderId: id,
        tenantId,
        previousStatus: reverseStatusMap[currentState] || currentState,
        newStatus: newDbStatus,
        technicianId: req.user.id,
      });

      // If completed, also send completion event for workflow
      if (transitionResult.newState === WorkOrderState.COMPLETED) {
        await sendQueueWorkOrderCompleted({
          workOrderId: id,
          tenantId,
          technicianId: updatedWO.technician_id || req.user.id,
          completedAt: new Date().toISOString(),
        });
      }
    } catch (queueErr) {
      console.error('[Queue] Failed to send status change:', queueErr.message);
    }

    res.json({
      success: true,
      message: 'Work order status updated successfully',
      warnings: transitionResult.warnings || [],
      data: {
        workOrder: result.rows[0],
        currentState: newDbStatus,
        validNextStates: validNextStates.map(s => reverseStatusMap[s] || s)
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /api/work-orders/:id/hold - Place work order on hold
// ============================================================================
router.post('/:id/hold', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { hold_type, hold_reason } = req.body;
    const tenantId = req.user.tenant_id;

    // Validate inputs
    if (!hold_type) {
      return res.status(400).json({
        success: false,
        error: 'Hold type is required',
        errorCode: 'MISSING_HOLD_TYPE'
      });
    }

    const validHoldTypes = ['safety', 'customer', 'parts', 'permit', 'internal', 'other'];
    if (!validHoldTypes.includes(hold_type.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid hold type. Must be one of: ${validHoldTypes.join(', ')}`,
        errorCode: 'INVALID_HOLD_TYPE'
      });
    }

    // Get current work order
    const currentWO = await query(
      'SELECT * FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );

    if (currentWO.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    const workOrder = currentWO.rows[0];

    // Update work order to on-hold status (waitingParts as proxy for "On Hold")
    const result = await query(
      `UPDATE work_orders
       SET status = $1,
           hold_type = $2,
           hold_reason = $3,
           updated_at = NOW()
       WHERE id = $4 AND tenant_id = $5
       RETURNING *`,
      ['waitingParts', hold_type, hold_reason || null, id, tenantId]
    );

    const updatedWO = result.rows[0];

    // Emit work order on hold event
    await emitWorkOrderOnHold({
      work_order: {
        id: updatedWO.id,
        code: updatedWO.work_order_number,
        customer_id: updatedWO.customer_id,
        tech_id: updatedWO.technician_id,
        status: updatedWO.status,
        trade: updatedWO.work_type || 'electrician',
      },
      hold: {
        reason: hold_type,
        notes: hold_reason || '',
      },
      actor: { id: req.user.id, role: req.user.role || 'dispatcher' }
    });

    res.json({
      success: true,
      message: 'Work order placed on hold successfully',
      data: updatedWO
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /api/work-orders/:id/cancel - Cancel work order
// ============================================================================
/**
 * Cancel a work order and return its line items to the source estimate.
 *
 * This endpoint:
 * 1. Cancels the work order
 * 2. Returns assigned line items to estimate (assignment_status = 'returned')
 * 3. Creates RETURNED_TO lineage edge
 * 4. Recalculates estimate conversion percentage
 * 5. Logs work_order_cancelled event
 */
router.post('/:id/cancel', async (req, res, next) => {
  const client = await getClient();

  try {
    const { id } = req.params;
    const { cancellation_reason } = req.body;
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    // Validate inputs
    if (!cancellation_reason) {
      return res.status(400).json({
        success: false,
        error: 'Cancellation reason is required',
        errorCode: 'MISSING_CANCELLATION_REASON'
      });
    }

    await client.query('BEGIN');

    // Get current work order
    const currentWO = await client.query(
      'SELECT * FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );

    if (currentWO.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    const workOrder = currentWO.rows[0];

    // Get line items assigned to this work order
    const lineItemsResult = await client.query(`
      SELECT eli.*, e.id as source_estimate_id, e.estimate_number
      FROM estimate_line_items eli
      JOIN estimates e ON eli.estimate_id = e.id
      WHERE eli.assigned_work_order_id = $1
    `, [id]);

    const lineItems = lineItemsResult.rows;
    const estimateIds = [...new Set(lineItems.map(li => li.source_estimate_id))];

    // Update work order to cancelled status
    const result = await client.query(
      `UPDATE work_orders
       SET status = $1,
           cancellation_reason = $2,
           updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      ['cancelled', cancellation_reason, id, tenantId]
    );

    const updatedWO = result.rows[0];

    // Release materials (work_order_parts) — mark as returned
    // Don't touch parts already installed (those are consumed)
    const releasedParts = await client.query(`
      UPDATE work_order_parts
      SET status = 'returned', updated_at = NOW()
      WHERE work_order_id = $1 AND tenant_id = $2
        AND status NOT IN ('installed')
      RETURNING id, inventory_item_id, quantity
    `, [id, tenantId]);

    // Update WO parts_status to reflect cancellation
    await client.query(`
      UPDATE work_orders SET parts_status = 'not_required', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
    `, [id, tenantId]);

    // Handle line items based on whether WO is part of a project
    const hasProject = !!workOrder.project_id;

    if (lineItems.length > 0) {
      if (hasProject) {
        // OPTION 2: Keep items in project context (unassigned but still in project)
        // Items can be reassigned to other WOs in the project without re-converting
        await client.query(`
          UPDATE estimate_line_items
          SET assignment_status = 'unassigned',
              assigned_work_order_id = NULL,
              project_id = $1,
              assignment_history = assignment_history || $2::jsonb,
              updated_at = NOW()
          WHERE assigned_work_order_id = $3
        `, [
          workOrder.project_id,
          JSON.stringify({
            work_order_id: id,
            work_order_number: workOrder.work_order_number,
            cancelled_at: new Date().toISOString(),
            reason: cancellation_reason,
            kept_in_project: true,
            project_id: workOrder.project_id
          }),
          id
        ]);
      } else {
        // No project - return items to estimate (original behavior)
        await client.query(`
          UPDATE estimate_line_items
          SET assignment_status = 'returned',
              assigned_work_order_id = NULL,
              assignment_history = assignment_history || $1::jsonb,
              updated_at = NOW()
          WHERE assigned_work_order_id = $2
        `, [
          JSON.stringify({
            work_order_id: id,
            work_order_number: workOrder.work_order_number,
            returned_at: new Date().toISOString(),
            reason: cancellation_reason
          }),
          id
        ]);
      }

      // Create lineage edges
      const lineageService = require('../services/workLineage.service');

      // Get or create work order node
      let woNode = await lineageService.getNodeByEntity(tenantId, 'work_order', id);
      if (!woNode) {
        woNode = await lineageService.upsertWorkOrderNode({
          tenant_id: tenantId,
          work_order_id: id,
          work_order_number: workOrder.work_order_number,
          customer_id: workOrder.customer_id,
          site_id: workOrder.site_id,
          status: 'cancelled'
        });
      } else {
        await lineageService.upsertWorkOrderNode({
          tenant_id: tenantId,
          work_order_id: id,
          work_order_number: workOrder.work_order_number,
          customer_id: workOrder.customer_id,
          site_id: workOrder.site_id,
          status: 'cancelled'
        });
      }

      const edgeIds = [];

      // Only create RETURNED_TO edges if items actually returned to estimate
      if (!hasProject) {
        for (const estimateId of estimateIds) {
          const estimateResult = await client.query(
            'SELECT * FROM estimates WHERE id = $1 AND tenant_id = $2',
            [estimateId, tenantId]
          );

          if (estimateResult.rows.length > 0) {
            const estimate = estimateResult.rows[0];

            let estimateNode = await lineageService.getNodeByEntity(tenantId, 'estimate', estimateId);
            if (!estimateNode) {
              estimateNode = await lineageService.upsertEstimateNode({
                tenant_id: tenantId,
                estimate_id: estimateId,
                estimate_number: estimate.estimate_number,
                customer_id: estimate.customer_id,
                site_id: estimate.site_id,
                status: estimate.status
              });
            }

            const edge = await lineageService.createEdge({
              tenant_id: tenantId,
              from_node_id: woNode.id,
              to_node_id: estimateNode.id,
              edge_type: 'RETURNED_TO',
              reason: cancellation_reason,
              metadata: {
                line_item_count: lineItems.filter(li => li.source_estimate_id === estimateId).length,
                line_item_ids: lineItems.filter(li => li.source_estimate_id === estimateId).map(li => li.id)
              },
              created_by_user_id: userId
            });

            if (edge) {
              edgeIds.push(edge.id);
            }

            // Recalculate estimate conversion percentage
            await client.query('SELECT recalculate_estimate_conversion($1)', [estimateId]);
          }
        }
      }

      // Record the cancellation event
      await lineageService.recordLineageEvent({
        tenant_id: tenantId,
        event_type: 'work_order_cancelled',
        source_entity_ids: [id],
        target_entity_ids: hasProject ? [workOrder.project_id] : estimateIds,
        event_reason: cancellation_reason,
        event_payload: {
          work_order: {
            id: workOrder.id,
            work_order_number: workOrder.work_order_number,
            phase_type: workOrder.phase_type,
            status_from: workOrder.status,
            project_id: workOrder.project_id
          },
          line_items_affected: lineItems.length,
          kept_in_project: hasProject,
          project_id: workOrder.project_id,
          affected_estimates: hasProject ? [] : estimateIds
        },
        triggered_by_user_id: userId,
        edge_ids: edgeIds
      });
    }

    await client.query('COMMIT');

    // Emit work order canceled event (DEI)
    await emitWorkOrderCanceled({
      work_order: {
        id: updatedWO.id,
        code: updatedWO.work_order_number,
        customer_id: updatedWO.customer_id,
        tech_id: updatedWO.technician_id,
        status_from: workOrder.status,
        status: 'cancelled',
        cancellation_reason,
        trade: updatedWO.work_type || 'electrician',
        project_id: workOrder.project_id,
        items_kept_in_project: hasProject
      },
      actor: { id: userId, role: req.user.role || 'dispatcher' }
    });

    // Emit queue event for unassigned work check (if project-based)
    if (hasProject && lineItems.length > 0) {
      try {
        await sendWorkOrderCancelled({
          tenantId: req.user.tenant_id,
          workOrderId: id,
          projectId: workOrder.project_id,
          lineItemsReturned: lineItems.length
        });
      } catch (queueErr) {
        console.log('[WorkOrder] Queue event send error (non-fatal):', queueErr.message);
      }
    }

    res.json({
      success: true,
      message: hasProject
        ? `Work order cancelled. ${lineItems.length} item(s) remain unassigned in project.`
        : 'Work order cancelled successfully',
      data: {
        workOrder: updatedWO,
        lineItemsAffected: lineItems.length,
        keptInProject: hasProject,
        projectId: workOrder.project_id,
        returnedToEstimate: !hasProject,
        affectedEstimates: hasProject ? 0 : estimateIds.length
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[WorkOrder] Cancel error:', error);
    next(error);
  } finally {
    client.release();
  }
});

// ============================================================================
// POST /api/work-orders/:id/restore - Restore a cancelled work order
// ============================================================================
// Reverses a cancellation: sets status back to DRAFT, reclaims line items
// that were unassigned during cancel (if not yet reassigned), recalculates
// estimated_hours from the reclaimed line items' labor, and restores
// materials (work_order_parts) back to pending status.
//
// Hours are DERIVED from line items (labor_hours × quantity × multipliers),
// so we recalculate from whatever items are actually reclaimed — if some
// were already reassigned to another WO, we only get hours for our items.
router.post('/:id/restore', requireRole('admin', 'manager', 'dispatcher'), async (req, res, next) => {
  const client = await getClient();

  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    await client.query('BEGIN');

    // Get current work order
    const currentWO = await client.query(
      'SELECT * FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );

    if (currentWO.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    const workOrder = currentWO.rows[0];

    if (!['cancelled', 'CANCELLED'].includes(workOrder.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Only cancelled work orders can be restored',
        errorCode: 'NOT_CANCELLED'
      });
    }

    // ── Step 1: Reclaim line items ────────────────────────────────
    // Only reclaims items that have this WO in their assignment_history
    // and haven't been reassigned to another WO
    let reclaimedCount = 0;
    const restoreHistoryEntry = JSON.stringify({
      action: 'restored',
      work_order_id: id,
      work_order_number: workOrder.work_order_number,
      restored_at: new Date().toISOString(),
      restored_by: userId
    });

    if (workOrder.project_id) {
      // Project-based WO: reclaim unassigned items still in the project
      const reclaimResult = await client.query(`
        UPDATE estimate_line_items
        SET assignment_status = 'assigned',
            assigned_work_order_id = $1,
            assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $2::jsonb,
            updated_at = NOW()
        WHERE project_id = $3
          AND assignment_status = 'unassigned'
          AND assigned_work_order_id IS NULL
          AND assignment_history::text LIKE '%' || $4 || '%'
      `, [id, restoreHistoryEntry, workOrder.project_id, id]);
      reclaimedCount = reclaimResult.rowCount;
    } else {
      // Standalone WO: reclaim items returned to estimate
      const reclaimResult = await client.query(`
        UPDATE estimate_line_items
        SET assignment_status = 'assigned',
            assigned_work_order_id = $1,
            assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $2::jsonb,
            updated_at = NOW()
        WHERE assignment_status = 'returned'
          AND assigned_work_order_id IS NULL
          AND assignment_history::text LIKE '%' || $3 || '%'
      `, [id, restoreHistoryEntry, id]);
      reclaimedCount = reclaimResult.rowCount;

      // Recalculate estimate conversion percentage
      if (reclaimedCount > 0) {
        const affectedEstimates = await client.query(`
          SELECT DISTINCT estimate_id FROM estimate_line_items
          WHERE assigned_work_order_id = $1
        `, [id]);
        for (const row of affectedEstimates.rows) {
          await client.query('SELECT recalculate_estimate_conversion($1)', [row.estimate_id]);
        }
      }
    }

    // ── Step 2: Recalculate estimated_hours from reclaimed line items ──
    // Hours come from the line items' labor (labor_hours × quantity).
    // Assembly items: materials have labor assigned → labor_hours on line item
    // Service items: just labor hours, no materials
    const laborResult = await client.query(`
      SELECT COALESCE(SUM(
        COALESCE(eli.labor_hours, eli.default_labor_hours, 0) * COALESCE(eli.quantity, 1)
      ), 0) as total_labor_hours
      FROM estimate_line_items eli
      WHERE eli.assigned_work_order_id = $1
        AND eli.line_type != 'section'
    `, [id]);
    const recalculatedHours = parseFloat(laborResult.rows[0].total_labor_hours) || workOrder.estimated_hours || 0;

    // ── Step 3: Restore materials (work_order_parts) ──────────────
    // Parts that were marked 'returned' during cancel go back to 'pending'
    const restoredParts = await client.query(`
      UPDATE work_order_parts
      SET status = 'pending', updated_at = NOW()
      WHERE work_order_id = $1 AND tenant_id = $2
        AND status = 'returned'
      RETURNING id, inventory_item_id, quantity
    `, [id, tenantId]);
    const partsRestoredCount = restoredParts.rowCount;

    // Determine parts_status based on what we have
    const partsCountResult = await client.query(`
      SELECT COUNT(*) as total FROM work_order_parts
      WHERE work_order_id = $1 AND tenant_id = $2
    `, [id, tenantId]);
    const totalParts = parseInt(partsCountResult.rows[0].total);
    const newPartsStatus = totalParts > 0 ? 'pending_parts' : 'not_required';

    // ── Step 4: Update work order ─────────────────────────────────
    const result = await client.query(`
      UPDATE work_orders
      SET status = 'DRAFT',
          cancellation_reason = NULL,
          cancelled_at = NULL,
          estimated_hours = $3,
          parts_status = $4,
          updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `, [id, tenantId, recalculatedHours, newPartsStatus]);

    const restoredWO = result.rows[0];

    // ── Step 5: Record lineage event ──────────────────────────────
    try {
      const lineageService = require('../services/workLineage.service');
      await lineageService.recordLineageEvent({
        tenant_id: tenantId,
        event_type: 'work_order_restored',
        source_entity_ids: [id],
        target_entity_ids: workOrder.project_id ? [workOrder.project_id] : [],
        event_reason: 'Work order restored from cancellation',
        event_payload: {
          work_order: {
            id: workOrder.id,
            work_order_number: workOrder.work_order_number,
            phase_type: workOrder.phase_type,
            original_estimated_hours: workOrder.estimated_hours,
            recalculated_hours: recalculatedHours,
            project_id: workOrder.project_id
          },
          line_items_reclaimed: reclaimedCount,
          parts_restored: partsRestoredCount
        },
        triggered_by_user_id: userId
      });
    } catch (lineageErr) {
      console.log('[WorkOrder] Lineage event error (non-fatal):', lineageErr.message);
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Work order restored. ${reclaimedCount} line item(s) reclaimed, ${partsRestoredCount} material(s) restored, ${recalculatedHours} estimated hours.`,
      data: {
        workOrder: restoredWO,
        lineItemsReclaimed: reclaimedCount,
        partsRestored: partsRestoredCount,
        estimatedHours: recalculatedHours
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[WorkOrder] Restore error:', error);
    next(error);
  } finally {
    client.release();
  }
});

// ============================================================================
// GET /api/work-orders/:id/time-summary - Get time breakdown for work order
// ============================================================================
router.get('/:id/time-summary', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    // Verify work order exists and belongs to tenant
    const woCheck = await query(
      'SELECT id FROM work_orders WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (woCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work order not found'
      });
    }

    // Get all time entries for this work order
    const timeEntries = await query(
      `SELECT activity_type, duration_minutes
       FROM time_entries
       WHERE work_order_id = $1 AND tenant_id = $2
       ORDER BY start_time ASC`,
      [id, tenantId]
    );

    // Calculate totals by activity type
    const summary = {
      travel_minutes: 0,
      work_minutes: 0,
      break_minutes: 0,
      total_minutes: 0,
      billable_minutes: 0
    };

    timeEntries.rows.forEach(entry => {
      const minutes = entry.duration_minutes || 0;

      if (entry.activity_type === 'travel') {
        summary.travel_minutes += minutes;
        summary.billable_minutes += minutes;
      } else if (entry.activity_type === 'work') {
        summary.work_minutes += minutes;
        summary.billable_minutes += minutes;
      } else if (entry.activity_type === 'break') {
        summary.break_minutes += minutes;
      }

      summary.total_minutes += minutes;
    });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /api/work-orders/:id/reserve-materials - Reserve inventory for work order
// ============================================================================
router.post('/:id/reserve-materials', async (req, res, next) => {
  const client = await getClient();

  try {
    const { id: workOrderId } = req.params;
    const { items } = req.body; // [{ inventoryItemId, sku, locationId, quantity }]
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    // Validate request
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Items array is required and must not be empty',
        errorCode: 'INVALID_REQUEST'
      });
    }

    // Verify work order exists and belongs to tenant
    const woCheck = await query(
      'SELECT id, work_order_number, status FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [workOrderId, tenantId]
    );

    if (woCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    const workOrder = woCheck.rows[0];

    await client.query('BEGIN');

    // Import inventory service
    const inventoryService = require('../services/inventory.service');

    // Reserve inventory
    const summary = await inventoryService.reserveInventoryForWorkOrder(client, {
      tenantId,
      workOrderId,
      items,
      performedBy: userId
    });

    await client.query('COMMIT');

    // Log material reservation (audit trail)
    console.log('[WorkOrder] Material reserved', {
      workOrderId,
      itemsReserved: summary.itemsReserved,
      itemsSkipped: summary.itemsSkipped,
      totalItems: items.length
    });

    res.json({
      success: true,
      message: `Reserved ${summary.itemsReserved} item(s) for work order`,
      data: {
        workOrderId,
        reservations: summary.reservations,
        itemsReserved: summary.itemsReserved,
        itemsSkipped: summary.itemsSkipped,
        warnings: summary.warnings
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[RESERVATION] Error reserving materials:', error);
    next(error);
  } finally {
    client.release();
  }
});

// ============================================================================
// POST /api/work-orders/:id/release-materials - Release inventory reservations
// ============================================================================
router.post('/:id/release-materials', async (req, res, next) => {
  const client = await getClient();

  try {
    const { id: workOrderId } = req.params;
    const { items } = req.body; // [{ inventoryItemId, sku, locationId, quantity }]
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    // Validate request
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Items array is required and must not be empty',
        errorCode: 'INVALID_REQUEST'
      });
    }

    // Verify work order exists and belongs to tenant
    const woCheck = await query(
      'SELECT id, work_order_number, status FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [workOrderId, tenantId]
    );

    if (woCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    const workOrder = woCheck.rows[0];

    await client.query('BEGIN');

    // Import inventory service
    const inventoryService = require('../services/inventory.service');

    // Release inventory reservations
    const summary = await inventoryService.releaseInventoryReservation(client, {
      tenantId,
      workOrderId,
      items,
      performedBy: userId
    });

    await client.query('COMMIT');

    // Log material release (audit trail)
    console.log('[WorkOrder] Material reservation released', {
      workOrderId,
      itemsReleased: summary.itemsReleased,
      itemsSkipped: summary.itemsSkipped,
      totalItems: items.length
    });

    res.json({
      success: true,
      message: `Released ${summary.itemsReleased} item(s) from work order reservation`,
      data: {
        workOrderId,
        releases: summary.releases,
        itemsReleased: summary.itemsReleased,
        itemsSkipped: summary.itemsSkipped,
        warnings: summary.warnings
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[RESERVATION] Error releasing materials:', error);
    next(error);
  } finally {
    client.release();
  }
});

// ============================================================================
// GET /api/work-orders/:id/material-reservations - Get reservations for work order
// ============================================================================
router.get('/:id/material-reservations', async (req, res, next) => {
  try {
    const { id: workOrderId } = req.params;
    const tenantId = req.user.tenant_id;

    // Verify work order exists and belongs to tenant
    const woCheck = await query(
      'SELECT id FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [workOrderId, tenantId]
    );

    if (woCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    // Import inventory service
    const inventoryService = require('../services/inventory.service');

    // Get reservations
    const reservations = await inventoryService.getReservationsForWorkOrder(tenantId, workOrderId);

    res.json({
      success: true,
      data: {
        workOrderId,
        reservations,
        totalItems: reservations.length
      }
    });
  } catch (error) {
    console.error('[RESERVATION] Error fetching reservations:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/work-orders/:id/costs - Get work order cost breakdown
// ============================================================================
router.get('/:id/costs', async (req, res, next) => {
  try {
    const { id: workOrderId } = req.params;
    const tenantId = req.user.tenant_id;

    // Verify work order exists
    const woResult = await query(
      'SELECT id FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [workOrderId, tenantId]
    );

    if (woResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    // Import job costing service
    const jobCostingService = require('../services/jobCosting.service');

    // Get cost breakdown
    const costs = await jobCostingService.getWorkOrderCosts(workOrderId, tenantId);

    res.json({
      success: true,
      data: costs
    });
  } catch (error) {
    console.error('[JOB_COSTING] Error fetching work order costs:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/work-orders/:id/costs/export - Export work order costs as CSV
// ============================================================================
router.get('/:id/costs/export', async (req, res, next) => {
  try {
    const { id: workOrderId } = req.params;
    const tenantId = req.user.tenant_id;

    // Verify work order exists
    const woResult = await query(
      'SELECT work_order_number FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [workOrderId, tenantId]
    );

    if (woResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    const workOrderNumber = woResult.rows[0].work_order_number;

    // Import job costing service
    const jobCostingService = require('../services/jobCosting.service');

    // Generate CSV export
    const csvContent = await jobCostingService.exportWorkOrderCostsCSV(workOrderId, tenantId);

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="work-order-${workOrderNumber}-costs.csv"`);

    res.send(csvContent);
  } catch (error) {
    console.error('[JOB_COSTING] Error exporting work order costs:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/work-orders/dashboard/stats - Dashboard statistics
// ============================================================================
router.get('/dashboard/stats', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const today = new Date().toISOString().split('T')[0];

    // Get work order status counts
    const statusResult = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'in_progress' OR status = 'inProgress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE status = 'on_hold' OR status = 'onHold') as on_hold,
        COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled')
          AND scheduled_date < CURRENT_DATE) as overdue,
        COUNT(*) as total
      FROM work_orders
      WHERE tenant_id = $1 AND deleted_at IS NULL
    `, [tenantId]);

    // Get today's work orders
    const todayResult = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'in_progress' OR status = 'inProgress') as in_progress
      FROM work_orders
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND scheduled_date = $2
    `, [tenantId, today]);

    // Get overdue work orders list
    const overdueResult = await query(`
      SELECT wo.id, wo.work_order_number, wo.title, wo.scheduled_date, wo.priority,
             c.name as customer_name,
             u.first_name || ' ' || u.last_name as assignee_name
      FROM work_orders wo
      LEFT JOIN customers c ON wo.customer_id = c.id
      LEFT JOIN users u ON wo.technician_id = u.id
      WHERE wo.tenant_id = $1
        AND wo.deleted_at IS NULL
        AND wo.status NOT IN ('completed', 'cancelled')
        AND wo.scheduled_date < CURRENT_DATE
      ORDER BY wo.priority DESC, wo.scheduled_date ASC
      LIMIT 10
    `, [tenantId]);

    // Get recent activity (last 20 work order changes)
    const activityResult = await query(`
      SELECT
        wo.id,
        wo.work_order_number,
        wo.title,
        wo.status,
        wo.updated_at,
        c.name as customer_name,
        u.first_name || ' ' || u.last_name as updated_by_name
      FROM work_orders wo
      LEFT JOIN customers c ON wo.customer_id = c.id
      LEFT JOIN users u ON wo.created_by = u.id
      WHERE wo.tenant_id = $1 AND wo.deleted_at IS NULL
      ORDER BY wo.updated_at DESC
      LIMIT 20
    `, [tenantId]);

    // Get technicians in field today
    const techsResult = await query(`
      SELECT
        u.id,
        u.first_name || ' ' || u.last_name as name,
        COUNT(wo.id) as active_jobs,
        COUNT(wo.id) FILTER (WHERE wo.status = 'completed') as completed_today
      FROM users u
      LEFT JOIN work_orders wo ON wo.technician_id = u.id
        AND wo.scheduled_date = $2
        AND wo.deleted_at IS NULL
      WHERE u.tenant_id = $1
        AND u.role = 'technician'
        AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name
      HAVING COUNT(wo.id) > 0
      ORDER BY COUNT(wo.id) DESC
    `, [tenantId, today]);

    res.json({
      success: true,
      data: {
        statusBreakdown: {
          total: parseInt(statusResult.rows[0].total) || 0,
          completed: parseInt(statusResult.rows[0].completed) || 0,
          inProgress: parseInt(statusResult.rows[0].in_progress) || 0,
          scheduled: parseInt(statusResult.rows[0].scheduled) || 0,
          onHold: parseInt(statusResult.rows[0].on_hold) || 0,
          overdue: parseInt(statusResult.rows[0].overdue) || 0
        },
        today: {
          total: parseInt(todayResult.rows[0].total) || 0,
          completed: parseInt(todayResult.rows[0].completed) || 0,
          inProgress: parseInt(todayResult.rows[0].in_progress) || 0
        },
        overdueWorkOrders: overdueResult.rows.map(wo => ({
          id: wo.id,
          number: wo.work_order_number,
          title: wo.title,
          customer: wo.customer_name,
          dueDate: wo.scheduled_date,
          priority: wo.priority,
          assignee: wo.assignee_name
        })),
        recentActivity: activityResult.rows.map(wo => ({
          id: wo.id,
          number: wo.work_order_number,
          title: wo.title,
          status: wo.status,
          customer: wo.customer_name,
          updatedAt: wo.updated_at,
          updatedBy: wo.updated_by_name
        })),
        techniciansInField: techsResult.rows.map(t => ({
          id: t.id,
          name: t.name,
          activeJobs: parseInt(t.active_jobs) || 0,
          completedToday: parseInt(t.completed_today) || 0
        })),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[DASHBOARD] Error fetching stats:', error);
    next(error);
  }
});

// ============================================================================
// WORK ORDER PARTS ENDPOINTS
// ============================================================================

// GET /api/work-orders/:id/parts - Get parts for a work order
router.get('/:id/parts', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    const result = await query(`
      SELECT wop.*, ii.sku, ii.name, ii.description, ii.category
      FROM work_order_parts wop
      JOIN inventory_items ii ON wop.inventory_item_id = ii.id
      WHERE wop.work_order_id = $1 AND wop.tenant_id = $2
      ORDER BY wop.created_at DESC
    `, [id, tenantId]);

    res.json({
      success: true,
      data: result.rows.map(p => ({
        id: p.id,
        inventory_item_id: p.inventory_item_id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        category: p.category,
        quantity: parseFloat(p.quantity),
        unit_of_measure: p.unit_of_measure,
        unit_cost: p.unit_cost ? parseFloat(p.unit_cost) : null,
        total_cost: p.total_cost ? parseFloat(p.total_cost) : null,
        status: p.status,
        source: p.source,
        notes: p.notes,
        created_at: p.created_at
      }))
    });
  } catch (error) {
    console.error('[WO_PARTS] Error fetching parts:', error);
    next(error);
  }
});

// Valid part sources
const VALID_PART_SOURCES = ['truck', 'warehouse', 'purchased', 'other_truck', 'job_site', 'other'];

// POST /api/work-orders/:id/parts - Add part to work order
// Handles different sources: truck (deducts), warehouse, purchased (creates expense), etc.
router.post('/:id/parts', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      inventory_item_id,
      quantity = 1,
      unit_of_measure = 'each',
      notes,
      source = 'truck',
      // Expense fields (required if source === 'purchased')
      expense
    } = req.body;
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    if (!inventory_item_id) {
      return res.status(400).json({ success: false, message: 'inventory_item_id is required' });
    }

    // Validate source
    if (!VALID_PART_SOURCES.includes(source)) {
      return res.status(400).json({
        success: false,
        message: `Invalid source. Must be one of: ${VALID_PART_SOURCES.join(', ')}`
      });
    }

    // If purchased, expense details are required
    if (source === 'purchased' && !expense) {
      return res.status(400).json({
        success: false,
        message: 'Expense details required when source is "purchased"'
      });
    }

    // Verify work order exists
    const woCheck = await query(
      'SELECT id FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );
    if (woCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Work order not found' });
    }

    // Get item cost for snapshot (use expense amount if purchased, otherwise catalog cost)
    const itemResult = await query(
      'SELECT unit_cost FROM inventory_items WHERE id = $1 AND tenant_id = $2',
      [inventory_item_id, tenantId]
    );
    let unitCost = itemResult.rows[0]?.unit_cost || 0;

    // If purchased, use the actual purchase price
    if (source === 'purchased' && expense?.amount) {
      unitCost = expense.amount / quantity;
    }
    const totalCost = unitCost * quantity;

    // Only deduct from truck if source is 'truck'
    if (source === 'truck') {
      // Find the tech's assigned truck
      const vehicleResult = await query(
        'SELECT id FROM vehicles WHERE assigned_technician_id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1',
        [userId, tenantId]
      );
      const vehicleId = vehicleResult.rows[0]?.id;

      if (vehicleId) {
        // Check if part exists on truck
        const truckStockResult = await query(
          'SELECT quantity_current FROM vehicle_inventory WHERE vehicle_id = $1 AND inventory_item_id = $2 AND tenant_id = $3',
          [vehicleId, inventory_item_id, tenantId]
        );
        const truckQty = truckStockResult.rows[0]?.quantity_current || 0;

        if (truckQty < quantity) {
          return res.status(400).json({
            success: false,
            message: `Insufficient stock on truck. Available: ${truckQty}, Requested: ${quantity}`,
            errorCode: 'INSUFFICIENT_TRUCK_STOCK',
            available: truckQty
          });
        }

        // Update vehicle_inventory (deduct quantity)
        await query(`
          UPDATE vehicle_inventory
          SET quantity_current = quantity_current - $1,
              updated_at = NOW()
          WHERE vehicle_id = $2 AND inventory_item_id = $3 AND tenant_id = $4
        `, [quantity, vehicleId, inventory_item_id, tenantId]);

        // Create inventory transaction for audit trail
        await query(`
          INSERT INTO inventory_transactions (
            tenant_id, inventory_item_id, transaction_type, quantity,
            location_id, reference_type, reference_id,
            work_order_id, performed_by, notes
          ) VALUES ($1, $2, 'used_on_job', $3, $4, 'vehicle', $4, $5, $6, $7)
        `, [tenantId, inventory_item_id, -quantity, vehicleId, id, userId, notes || 'Part used from truck']);
      }
    }

    // Insert or update work order parts (upsert) - now includes source
    const result = await query(`
      INSERT INTO work_order_parts (
        tenant_id, work_order_id, inventory_item_id, quantity, unit_of_measure,
        unit_cost, total_cost, notes, source, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (work_order_id, inventory_item_id)
      DO UPDATE SET
        quantity = work_order_parts.quantity + EXCLUDED.quantity,
        total_cost = (work_order_parts.quantity + EXCLUDED.quantity) * COALESCE(work_order_parts.unit_cost, 0),
        source = EXCLUDED.source,
        updated_at = NOW()
      RETURNING *
    `, [tenantId, id, inventory_item_id, quantity, unit_of_measure, unitCost, totalCost, notes, source, userId]);

    const workOrderPartId = result.rows[0].id;

    // If purchased, create expense record
    let expenseRecord = null;
    if (source === 'purchased' && expense) {
      const taxAmount = expense.tax_amount || 0;
      const expenseTotal = (expense.amount || 0) + taxAmount;

      const expenseResult = await query(`
        INSERT INTO field_expenses (
          tenant_id, work_order_id, work_order_part_id, expense_type,
          vendor_name, vendor_address, amount, tax_amount, total_amount,
          receipt_photo_url, receipt_number, payment_method, card_last_four,
          notes, submitted_by
        ) VALUES ($1, $2, $3, 'parts', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `, [
        tenantId, id, workOrderPartId,
        expense.vendor_name, expense.vendor_address || null,
        expense.amount, taxAmount, expenseTotal,
        expense.receipt_photo_url || null, expense.receipt_number || null,
        expense.payment_method || 'personal_reimburse', expense.card_last_four || null,
        expense.notes || `Purchased ${quantity} x part for work order`,
        userId
      ]);
      expenseRecord = expenseResult.rows[0];
    }

    // Get the full part with item details
    const fullPart = await query(`
      SELECT wop.*, ii.sku, ii.name, ii.description
      FROM work_order_parts wop
      JOIN inventory_items ii ON wop.inventory_item_id = ii.id
      WHERE wop.id = $1
    `, [workOrderPartId]);

    res.status(201).json({
      success: true,
      data: fullPart.rows[0],
      expense: expenseRecord
    });
  } catch (error) {
    console.error('[WO_PARTS] Error adding part:', error);
    next(error);
  }
});

// PATCH /api/work-orders/:id/parts/:partId - Update part quantity
router.patch('/:id/parts/:partId', async (req, res, next) => {
  try {
    const { id, partId } = req.params;
    const { quantity, status, notes } = req.body;
    const tenantId = req.user.tenant_id;

    // Build update query dynamically
    const updates = [];
    const values = [tenantId, id, partId];
    let paramIndex = 4;

    if (quantity !== undefined) {
      updates.push(`quantity = $${paramIndex}`);
      values.push(quantity);
      paramIndex++;
      // Also update total_cost
      updates.push(`total_cost = $${paramIndex} * COALESCE(unit_cost, 0)`);
      values.push(quantity);
      paramIndex++;
    }

    if (status !== undefined) {
      updates.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex}`);
      values.push(notes);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No updates provided' });
    }

    updates.push('updated_at = NOW()');

    const result = await query(`
      UPDATE work_order_parts
      SET ${updates.join(', ')}
      WHERE tenant_id = $1 AND work_order_id = $2 AND id = $3
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Part not found' });
    }

    // Get full part with item details
    const fullPart = await query(`
      SELECT wop.*, ii.sku, ii.name, ii.description
      FROM work_order_parts wop
      JOIN inventory_items ii ON wop.inventory_item_id = ii.id
      WHERE wop.id = $1
    `, [result.rows[0].id]);

    res.json({
      success: true,
      data: fullPart.rows[0]
    });
  } catch (error) {
    console.error('[WO_PARTS] Error updating part:', error);
    next(error);
  }
});

// ============================================================================
// POST /api/work-orders/:id/sign-off - Sign off on completed phase
// ============================================================================
/**
 * Sign off on a completed phase work order.
 *
 * This endpoint:
 * 1. Validates the work order is in COMPLETED status
 * 2. Sets phase_signed_off_at=NOW() and phase_signed_off_by=userId
 * 3. Finds any dependent work orders (via depends_on_work_order_id)
 * 4. Updates dependent WOs from WAITING to SCHEDULED
 * 5. Clears blocked_reason on dependent WOs
 * 6. Logs changes to work_order_status_history
 */
router.post('/:id/sign-off', requireRole('admin', 'manager', 'dispatcher'), async (req, res, next) => {
  const client = await getClient();

  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    await client.query('BEGIN');

    // Get the work order
    const woResult = await client.query(`
      SELECT wo.*, p.project_number
      FROM work_orders wo
      LEFT JOIN projects p ON p.id = wo.project_id
      WHERE wo.id = $1 AND wo.tenant_id = $2 AND wo.deleted_at IS NULL
    `, [id, tenantId]);

    if (woResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    const workOrder = woResult.rows[0];

    // Validate work order is completed
    if (!['COMPLETED', 'completed'].includes(workOrder.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `Work order must be in COMPLETED status to sign off. Current status: ${workOrder.status}`,
        errorCode: 'INVALID_STATUS_FOR_SIGNOFF'
      });
    }

    // Check if already signed off
    if (workOrder.phase_signed_off_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Work order has already been signed off',
        errorCode: 'ALREADY_SIGNED_OFF',
        details: {
          signedOffAt: workOrder.phase_signed_off_at,
          signedOffBy: workOrder.phase_signed_off_by
        }
      });
    }

    // Update the work order with sign-off info
    const updateResult = await client.query(`
      UPDATE work_orders
      SET
        phase_signed_off_at = NOW(),
        phase_signed_off_by = $1,
        updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3
      RETURNING *
    `, [userId, id, tenantId]);

    const signedOffWO = updateResult.rows[0];

    // Log the sign-off in work_order_status_history
    await client.query(`
      INSERT INTO work_order_status_history (
        tenant_id, work_order_id, from_status, to_status,
        changed_by, reason, metadata, created_at
      ) VALUES ($1, $2, $3, $3, $4, $5, $6, NOW())
    `, [
      tenantId,
      id,
      workOrder.status,
      userId,
      'Phase signed off',
      JSON.stringify({
        trigger: 'sign_off_endpoint',
        phase_type: workOrder.phase_type,
        phase_sequence: workOrder.phase_sequence
      })
    ]);

    // Find and unblock dependent work orders
    const dependentWOs = await client.query(`
      SELECT id, work_order_number, status, blocked_reason
      FROM work_orders
      WHERE depends_on_work_order_id = $1
        AND tenant_id = $2
        AND status IN ('WAITING', 'waiting')
        AND deleted_at IS NULL
    `, [id, tenantId]);

    const unblockedWorkOrders = [];

    for (const depWO of dependentWOs.rows) {
      // Update dependent WO: WAITING -> SCHEDULED
      await client.query(`
        UPDATE work_orders
        SET
          status = 'SCHEDULED',
          blocked_reason = NULL,
          unblocked_at = NOW(),
          updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `, [depWO.id, tenantId]);

      // Log the status change
      await client.query(`
        INSERT INTO work_order_status_history (
          tenant_id, work_order_id, from_status, to_status,
          changed_by, reason, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [
        tenantId,
        depWO.id,
        'WAITING',
        'SCHEDULED',
        userId,
        `Predecessor ${workOrder.work_order_number} signed off`,
        JSON.stringify({
          trigger: 'sign_off_endpoint',
          predecessor_wo_id: id,
          predecessor_wo_number: workOrder.work_order_number,
          predecessor_phase_type: workOrder.phase_type
        })
      ]);

      unblockedWorkOrders.push({
        id: depWO.id,
        workOrderNumber: depWO.work_order_number,
        previousStatus: 'WAITING',
        newStatus: 'SCHEDULED',
        previousBlockedReason: depWO.blocked_reason
      });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Phase signed off successfully${unblockedWorkOrders.length > 0 ? `, ${unblockedWorkOrders.length} dependent work order(s) unblocked` : ''}`,
      data: {
        workOrderId: signedOffWO.id,
        workOrderNumber: signedOffWO.work_order_number,
        phaseType: signedOffWO.phase_type,
        phaseSequence: signedOffWO.phase_sequence,
        phaseSignedOffAt: signedOffWO.phase_signed_off_at,
        phaseSignedOffBy: userId,
        unblockedWorkOrders
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[WorkOrder] Sign-off error:', error);
    next(error);
  } finally {
    client.release();
  }
});

// ============================================================================
// POST /api/work-orders/:id/sign-off - Sign off on completed phase
// ============================================================================
/**
 * Sign off on a completed phase work order.
 *
 * This endpoint:
 * 1. Validates the work order is in COMPLETED status
 * 2. Sets phase_signed_off_at=NOW() and phase_signed_off_by=userId
 * 3. Finds any dependent work orders (via depends_on_work_order_id)
 * 4. Updates dependent WOs from WAITING to SCHEDULED
 * 5. Clears blocked_reason on dependent WOs
 * 6. Logs changes to work_order_status_history
 */
router.post('/:id/sign-off', requireRole('admin', 'manager', 'dispatcher'), async (req, res, next) => {
  const client = await getClient();

  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    await client.query('BEGIN');

    // Get the work order
    const woResult = await client.query(`
      SELECT wo.*, p.project_number
      FROM work_orders wo
      LEFT JOIN projects p ON p.id = wo.project_id
      WHERE wo.id = $1 AND wo.tenant_id = $2 AND wo.deleted_at IS NULL
    `, [id, tenantId]);

    if (woResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    const workOrder = woResult.rows[0];

    // Validate work order is completed
    if (!['COMPLETED', 'completed'].includes(workOrder.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `Work order must be in COMPLETED status to sign off. Current status: ${workOrder.status}`,
        errorCode: 'INVALID_STATUS_FOR_SIGNOFF'
      });
    }

    // Check if already signed off
    if (workOrder.phase_signed_off_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Work order has already been signed off',
        errorCode: 'ALREADY_SIGNED_OFF',
        details: {
          signedOffAt: workOrder.phase_signed_off_at,
          signedOffBy: workOrder.phase_signed_off_by
        }
      });
    }

    // Update the work order with sign-off info
    const updateResult = await client.query(`
      UPDATE work_orders
      SET
        phase_signed_off_at = NOW(),
        phase_signed_off_by = $1,
        updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3
      RETURNING *
    `, [userId, id, tenantId]);

    const signedOffWO = updateResult.rows[0];

    // Log the sign-off in work_order_status_history
    await client.query(`
      INSERT INTO work_order_status_history (
        tenant_id, work_order_id, from_status, to_status,
        changed_by, reason, metadata, created_at
      ) VALUES ($1, $2, $3, $3, $4, $5, $6, NOW())
    `, [
      tenantId,
      id,
      workOrder.status,
      userId,
      'Phase signed off',
      JSON.stringify({
        trigger: 'sign_off_endpoint',
        phase_type: workOrder.phase_type,
        phase_sequence: workOrder.phase_sequence
      })
    ]);

    // Find and unblock dependent work orders
    const dependentWOs = await client.query(`
      SELECT id, work_order_number, status, blocked_reason
      FROM work_orders
      WHERE depends_on_work_order_id = $1
        AND tenant_id = $2
        AND status IN ('WAITING', 'waiting')
        AND deleted_at IS NULL
    `, [id, tenantId]);

    const unblockedWorkOrders = [];

    for (const depWO of dependentWOs.rows) {
      // Update dependent WO: WAITING -> SCHEDULED
      await client.query(`
        UPDATE work_orders
        SET
          status = 'SCHEDULED',
          blocked_reason = NULL,
          unblocked_at = NOW(),
          updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `, [depWO.id, tenantId]);

      // Log the status change
      await client.query(`
        INSERT INTO work_order_status_history (
          tenant_id, work_order_id, from_status, to_status,
          changed_by, reason, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [
        tenantId,
        depWO.id,
        'WAITING',
        'SCHEDULED',
        userId,
        `Predecessor ${workOrder.work_order_number} signed off`,
        JSON.stringify({
          trigger: 'sign_off_endpoint',
          predecessor_wo_id: id,
          predecessor_wo_number: workOrder.work_order_number,
          predecessor_phase_type: workOrder.phase_type
        })
      ]);

      unblockedWorkOrders.push({
        id: depWO.id,
        workOrderNumber: depWO.work_order_number,
        previousStatus: 'WAITING',
        newStatus: 'SCHEDULED',
        previousBlockedReason: depWO.blocked_reason
      });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Phase signed off successfully${unblockedWorkOrders.length > 0 ? `, ${unblockedWorkOrders.length} dependent work order(s) unblocked` : ''}`,
      data: {
        workOrderId: signedOffWO.id,
        workOrderNumber: signedOffWO.work_order_number,
        phaseType: signedOffWO.phase_type,
        phaseSequence: signedOffWO.phase_sequence,
        phaseSignedOffAt: signedOffWO.phase_signed_off_at,
        phaseSignedOffBy: userId,
        unblockedWorkOrders
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[WorkOrder] Sign-off error:', error);
    next(error);
  } finally {
    client.release();
  }
});

// DELETE /api/work-orders/:id/parts/:partId - Remove part from work order
// Also restores quantity to truck inventory and creates reversal transaction
router.delete('/:id/parts/:partId', async (req, res, next) => {
  try {
    const { id, partId } = req.params;
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    // Get part details before deletion (for inventory restoration)
    const partResult = await query(`
      SELECT inventory_item_id, quantity, source FROM work_order_parts
      WHERE tenant_id = $1 AND work_order_id = $2 AND id = $3
    `, [tenantId, id, partId]);

    if (partResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Part not found' });
    }

    const { inventory_item_id, quantity: qtyRaw, source } = partResult.rows[0];
    const quantity = parseFloat(qtyRaw);

    // Only restore inventory if part came from truck
    if (source === 'truck') {
      // Find the tech's assigned truck
      const vehicleResult = await query(
        'SELECT id FROM vehicles WHERE assigned_technician_id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1',
        [userId, tenantId]
      );
      const vehicleId = vehicleResult.rows[0]?.id;

      // Restore to truck inventory if tech has an assigned truck
      if (vehicleId) {
      // Update vehicle_inventory (restore quantity)
      await query(`
        UPDATE vehicle_inventory
        SET quantity_current = quantity_current + $1,
            updated_at = NOW()
        WHERE vehicle_id = $2 AND inventory_item_id = $3 AND tenant_id = $4
      `, [quantity, vehicleId, inventory_item_id, tenantId]);

      // Create reversal transaction for audit trail
      await query(`
        INSERT INTO inventory_transactions (
          tenant_id, inventory_item_id, transaction_type, quantity,
          location_id, reference_type, reference_id,
          work_order_id, performed_by, notes
        ) VALUES ($1, $2, 'return_from_job', $3, $4, 'vehicle', $4, $5, $6, 'Part removed from work order - returned to truck')
      `, [tenantId, inventory_item_id, quantity, vehicleId, id, userId]);
      }
    }

    // Delete the work order part
    await query(`
      DELETE FROM work_order_parts
      WHERE tenant_id = $1 AND work_order_id = $2 AND id = $3
    `, [tenantId, id, partId]);

    res.json({
      success: true,
      message: 'Part removed from work order'
    });
  } catch (error) {
    console.error('[WO_PARTS] Error removing part:', error);
    next(error);
  }
});

// ============================================================================
// POST /api/work-orders/:id/split - Split work order into multiple WOs
// ============================================================================
/**
 * Split a work order into multiple parallel work orders.
 * Used when a phase work order is too large for one technician.
 *
 * Supports TWO split modes:
 *
 * 1. WHOLE-ITEM SPLIT: Move entire line items between work orders
 * {
 *   splits: [
 *     {
 *       title: "Rough-In Alpha",
 *       technician_id: "uuid",
 *       scheduled_date: "2026-02-01",
 *       line_item_ids: ["uuid-1", "uuid-2"]
 *     },
 *     { ... }
 *   ]
 * }
 *
 * 2. QUANTITY SPLIT: Divide a single line item's quantity across work orders
 * {
 *   splits: [
 *     {
 *       title: "Rough-In Alpha",
 *       technician_id: "uuid",
 *       scheduled_date: "2026-02-01",
 *       line_item_ids: ["uuid-1"],  // Whole items
 *       quantity_splits: {          // Quantity-split items
 *         "uuid-3": 0.6             // 60% of this item's quantity
 *       }
 *     },
 *     {
 *       title: "Rough-In Beta",
 *       technician_id: "uuid",
 *       scheduled_date: "2026-02-01",
 *       line_item_ids: ["uuid-2"],
 *       quantity_splits: {
 *         "uuid-3": 0.4             // 40% of this item's quantity
 *       }
 *     }
 *   ]
 * }
 *
 * When using quantity_splits:
 * - Ratios for each line item across all splits must sum to 1.0
 * - Creates child line items with proportional quantities and BOM
 * - Parent line item becomes non-assignable (is_split_parent = true)
 *
 * This endpoint:
 * 1. Validates the WO is splittable (not completed/cancelled)
 * 2. For quantity splits: calls split_line_item_by_quantity()
 * 3. Creates new WOs with same phase, project, split_group_id
 * 4. Moves/assigns line items to new WOs
 * 5. Creates SPLIT_INTO lineage edges
 * 6. Copies dependencies to new WOs
 * 7. Archives/cancels original WO
 */
router.post('/:id/split', requireRole('admin', 'manager', 'dispatcher'), async (req, res, next) => {
  const client = await getClient();

  try {
    const { id } = req.params;
    const { splits } = req.body;
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    // Validate request
    if (!splits || !Array.isArray(splits) || splits.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Must provide at least 2 splits',
        errorCode: 'INVALID_SPLITS'
      });
    }

    await client.query('BEGIN');

    // Get the original work order
    const woResult = await client.query(`
      SELECT wo.*, p.project_number, p.title as project_title
      FROM work_orders wo
      LEFT JOIN projects p ON p.id = wo.project_id
      WHERE wo.id = $1 AND wo.tenant_id = $2 AND wo.deleted_at IS NULL
    `, [id, tenantId]);

    if (woResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    const originalWO = woResult.rows[0];

    // Validate status allows splitting
    const nonSplittableStatuses = ['COMPLETED', 'completed', 'CANCELLED', 'cancelled'];
    if (nonSplittableStatuses.includes(originalWO.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `Cannot split work order with status: ${originalWO.status}`,
        errorCode: 'INVALID_STATUS_FOR_SPLIT'
      });
    }

    // Get line items assigned to this work order
    const lineItemsResult = await client.query(`
      SELECT eli.* FROM estimate_line_items eli
      WHERE eli.assigned_work_order_id = $1
    `, [id]);

    const assignedLineItems = lineItemsResult.rows;

    // ==========================================================================
    // VALIDATION: Collect and validate both whole-item and quantity splits
    // ==========================================================================
    const allLineItemIds = new Set(assignedLineItems.map(li => li.id));
    const wholeItemIds = new Set();        // Items being moved whole
    const quantitySplitItems = new Map();  // lineItemId -> { splitIndex: ratio }

    for (let splitIdx = 0; splitIdx < splits.length; splitIdx++) {
      const split = splits[splitIdx];

      // Validate line_item_ids array (whole item moves)
      if (!split.line_item_ids) {
        split.line_item_ids = [];
      }
      if (!Array.isArray(split.line_item_ids)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'line_item_ids must be an array',
          errorCode: 'INVALID_LINE_ITEM_IDS'
        });
      }

      // Track whole-item assignments
      for (const lineItemId of split.line_item_ids) {
        if (!allLineItemIds.has(lineItemId)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            error: `Line item ${lineItemId} is not assigned to this work order`,
            errorCode: 'INVALID_LINE_ITEM'
          });
        }
        if (wholeItemIds.has(lineItemId)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            error: `Line item ${lineItemId} appears in multiple splits as whole item`,
            errorCode: 'DUPLICATE_LINE_ITEM'
          });
        }
        wholeItemIds.add(lineItemId);
      }

      // Track quantity split assignments
      if (split.quantity_splits && typeof split.quantity_splits === 'object') {
        for (const [lineItemId, ratio] of Object.entries(split.quantity_splits)) {
          if (!allLineItemIds.has(lineItemId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              error: `Line item ${lineItemId} is not assigned to this work order`,
              errorCode: 'INVALID_LINE_ITEM'
            });
          }
          if (wholeItemIds.has(lineItemId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              error: `Line item ${lineItemId} cannot be both whole-item and quantity-split`,
              errorCode: 'CONFLICTING_SPLIT_TYPE'
            });
          }

          // Validate ratio
          const numRatio = parseFloat(ratio);
          if (isNaN(numRatio) || numRatio <= 0 || numRatio > 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              error: `Invalid ratio ${ratio} for line item ${lineItemId}. Must be between 0 and 1.`,
              errorCode: 'INVALID_RATIO'
            });
          }

          // Track for ratio sum validation
          if (!quantitySplitItems.has(lineItemId)) {
            quantitySplitItems.set(lineItemId, new Map());
          }
          quantitySplitItems.get(lineItemId).set(splitIdx, numRatio);
        }
      }
    }

    // Validate quantity split ratios sum to 1.0 for each line item
    for (const [lineItemId, splitRatios] of quantitySplitItems) {
      const totalRatio = Array.from(splitRatios.values()).reduce((sum, r) => sum + r, 0);
      if (totalRatio < 0.99 || totalRatio > 1.01) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: `Quantity split ratios for line item must sum to 1.0 (got ${totalRatio.toFixed(2)})`,
          errorCode: 'INVALID_RATIO_SUM'
        });
      }
    }

    // All line items must be assigned (either whole or quantity-split)
    const assignedCount = wholeItemIds.size + quantitySplitItems.size;
    if (assignedCount !== allLineItemIds.size) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'All line items must be assigned to a split (whole or quantity)',
        errorCode: 'UNASSIGNED_LINE_ITEMS'
      });
    }

    // Get the lineage service
    const lineageService = require('../services/workLineage.service');

    // ==========================================================================
    // PHASE 1: Process quantity splits to create child line items
    // ==========================================================================
    // For items being quantity-split, we need to create child line items BEFORE
    // creating work orders, so we can assign the children to the new WOs.
    //
    // We'll temporarily use placeholder work order IDs, then update them after
    // creating the actual work orders.
    // ==========================================================================
    const quantitySplitResults = new Map();  // parentId -> { splitIdx -> childId }

    if (quantitySplitItems.size > 0) {
      // We need to create placeholder WO entries first since split_line_item_by_quantity
      // requires work_order_id. Instead, we'll do the split manually here since we
      // don't have WO IDs yet, or we split first with NULL WO IDs then assign.
      //
      // Alternative: Split manually without calling DB function, matching its logic
      for (const [parentLineItemId, splitRatiosByIdx] of quantitySplitItems) {
        const parentItem = assignedLineItems.find(li => li.id === parentLineItemId);
        if (!parentItem) continue;

        const childIdsBySplit = new Map();

        // Mark parent as split
        await client.query(`
          UPDATE estimate_line_items
          SET is_split_parent = true,
              original_quantity = quantity,
              assignment_status = 'split',
              assigned_work_order_id = NULL,
              updated_at = NOW()
          WHERE id = $1
        `, [parentLineItemId]);

        // Create child line items for each split allocation
        for (const [splitIdx, ratio] of splitRatiosByIdx) {
          const newQuantity = Math.round((parseFloat(parentItem.quantity) * ratio) * 100) / 100;
          const newLaborHours = Math.round((parseFloat(parentItem.labor_hours || 0) * ratio) * 100) / 100;
          const newDefaultLaborHours = Math.round((parseFloat(parentItem.default_labor_hours || 0) * ratio) * 100) / 100;
          const newLineTotal = Math.round((parseFloat(parentItem.unit_price || 0) * newQuantity) * 100) / 100;

          // Create child line item (WO assignment will happen later)
          const childResult = await client.query(`
            INSERT INTO estimate_line_items (
              tenant_id, estimate_id, area_id, line_item_id,
              line_number, name, description, quantity, unit_of_measure,
              material_cost, labor_hours, labor_rate, labor_cost,
              difficulty_multiplier, unit_price, line_total,
              item_type, phase, procurement_status,
              assignment_status, project_id,
              parent_line_item_id, split_ratio, original_quantity,
              default_labor_hours
            )
            VALUES (
              $1, $2, $3, $4,
              $5, $6, $7, $8, $9,
              $10, $11, $12, $13,
              $14, $15, $16,
              $17, $18, $19,
              'pending', $20,
              $21, $22, $23,
              $24
            )
            RETURNING id
          `, [
            parentItem.tenant_id, parentItem.estimate_id, parentItem.area_id, parentItem.line_item_id,
            parentItem.line_number, parentItem.name, parentItem.description,
            newQuantity, parentItem.unit_of_measure,
            parentItem.material_cost,
            newLaborHours,
            parentItem.labor_rate, parentItem.labor_cost,
            parentItem.difficulty_multiplier,
            parentItem.unit_price, newLineTotal,
            parentItem.item_type, parentItem.phase, parentItem.procurement_status,
            parentItem.project_id,
            parentLineItemId, ratio, parentItem.quantity,
            newDefaultLaborHours
          ]);

          const childId = childResult.rows[0].id;
          childIdsBySplit.set(splitIdx, childId);

          // Copy and split BOM items proportionally
          const bomItems = await client.query(`
            SELECT * FROM estimate_bom_items
            WHERE estimate_id = $1
              AND (line_item_id = $2 OR line_item_id IS NULL)
          `, [parentItem.estimate_id, parentLineItemId]);

          for (const bomItem of bomItems.rows) {
            const newBomQty = Math.round((parseFloat(bomItem.quantity) * ratio) * 100) / 100;
            const newBomCost = Math.round((parseFloat(bomItem.total_cost || 0) * ratio) * 100) / 100;

            await client.query(`
              INSERT INTO estimate_bom_items (
                tenant_id, estimate_id, line_item_id,
                inventory_item_id, sku, name, description,
                quantity, unit_of_measure, unit_cost, total_cost,
                source_bom_item_id
              )
              VALUES (
                $1, $2, $3,
                $4, $5, $6, $7,
                $8, $9, $10, $11,
                $12
              )
            `, [
              bomItem.tenant_id, bomItem.estimate_id, childId,
              bomItem.inventory_item_id, bomItem.sku, bomItem.name, bomItem.description,
              newBomQty, bomItem.unit_of_measure, bomItem.unit_cost, newBomCost,
              bomItem.id
            ]);
          }

          // Log the split creation in assignment_history
          await client.query(`
            UPDATE estimate_line_items
            SET assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $1::jsonb
            WHERE id = $2
          `, [
            JSON.stringify({
              action: 'split_created',
              timestamp: new Date().toISOString(),
              performed_by: userId,
              parent_line_item_id: parentLineItemId,
              split_ratio: ratio,
              quantity: newQuantity
            }),
            childId
          ]);
        }

        quantitySplitResults.set(parentLineItemId, childIdsBySplit);

        // Log the split on the parent
        const childIds = Array.from(childIdsBySplit.values());
        await client.query(`
          UPDATE estimate_line_items
          SET assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $1::jsonb
          WHERE id = $2
        `, [
          JSON.stringify({
            action: 'split_into_children',
            timestamp: new Date().toISOString(),
            performed_by: userId,
            child_line_item_ids: childIds,
            split_ratios: Object.fromEntries(splitRatiosByIdx)
          }),
          parentLineItemId
        ]);
      }
    }

    // ==========================================================================
    // PHASE 2: Create work orders and assign line items
    // ==========================================================================

    // Get or create the original WO's lineage node
    let originalNode = await lineageService.getNodeByEntity(tenantId, 'work_order', id);
    if (!originalNode) {
      originalNode = await lineageService.upsertWorkOrderNode({
        tenant_id: tenantId,
        work_order_id: id,
        work_order_number: originalWO.work_order_number,
        customer_id: originalWO.customer_id,
        site_id: originalWO.site_id,
        status: originalWO.status
      });
    }

    // Get dependencies that need to be copied to new WOs
    const depsResult = await client.query(`
      SELECT * FROM work_order_dependencies
      WHERE work_order_id = $1 AND tenant_id = $2
    `, [id, tenantId]);
    const originalDependencies = depsResult.rows;

    // Generate a new split_group_id if original doesn't have one
    const splitGroupId = originalWO.split_group_id || require('crypto').randomUUID();

    const newWorkOrders = [];
    const edgeIds = [];

    // Create each new work order
    for (let i = 0; i < splits.length; i++) {
      const split = splits[i];
      const crewLabel = String.fromCharCode(65 + i); // A, B, C, etc.

      // Generate work order number
      const countResult = await client.query(
        'SELECT COUNT(*) FROM work_orders WHERE tenant_id = $1',
        [tenantId]
      );
      const workOrderNumber = `WO-${String(parseInt(countResult.rows[0].count) + 1).padStart(6, '0')}`;

      // Calculate estimated hours for this split
      // Include whole items + proportion from quantity splits
      const wholeItems = assignedLineItems.filter(li => split.line_item_ids.includes(li.id));
      let estimatedHours = wholeItems.reduce((sum, li) => {
        const hours = parseFloat(li.labor_hours || li.default_labor_hours || 0);
        const qty = parseFloat(li.quantity || 1);
        return sum + (hours * qty);
      }, 0);

      // Add hours from quantity-split items assigned to this split
      for (const [parentId, splitRatios] of quantitySplitItems) {
        if (splitRatios.has(i)) {
          const parentItem = assignedLineItems.find(li => li.id === parentId);
          if (parentItem) {
            const ratio = splitRatios.get(i);
            const hours = parseFloat(parentItem.labor_hours || parentItem.default_labor_hours || 0);
            const qty = parseFloat(parentItem.quantity || 1);
            estimatedHours += (hours * qty * ratio);
          }
        }
      }

      // Create the new work order
      const newWOResult = await client.query(`
        INSERT INTO work_orders (
          tenant_id, work_order_number, customer_id, technician_id, created_by,
          title, description, priority, status, work_type,
          scheduled_start, scheduled_end,
          service_address_line1, service_address_line2, service_city, service_state,
          service_postal_code, service_country,
          estimated_hours, estimated_amount,
          phase, phase_type, phase_sequence, split_group_id, source_estimate_id,
          project_id, crew_assignment, depends_on_work_order_id
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12,
          $13, $14, $15, $16, $17, $18,
          $19, $20,
          $21, $22, $23, $24, $25,
          $26, $27, $28
        )
        RETURNING *
      `, [
        tenantId,
        workOrderNumber,
        originalWO.customer_id,
        split.technician_id || null,
        userId,
        split.title || `${originalWO.title} - ${crewLabel}`,
        originalWO.description,
        originalWO.priority,
        split.technician_id ? 'SCHEDULED' : 'DRAFT',
        originalWO.work_type,
        split.scheduled_date || originalWO.scheduled_start,
        split.scheduled_end || originalWO.scheduled_end,
        originalWO.service_address_line1,
        originalWO.service_address_line2,
        originalWO.service_city,
        originalWO.service_state,
        originalWO.service_postal_code,
        originalWO.service_country,
        estimatedHours,
        (estimatedHours / (originalWO.estimated_hours || 1)) * (originalWO.estimated_amount || 0),
        originalWO.phase,
        originalWO.phase_type,
        originalWO.phase_sequence,
        splitGroupId,
        originalWO.source_estimate_id,
        originalWO.project_id,
        crewLabel.toLowerCase(), // alpha, beta, etc.
        originalWO.depends_on_work_order_id
      ]);

      const newWO = newWOResult.rows[0];
      newWorkOrders.push(newWO);

      // Update WHOLE line items to point to new work order
      if (split.line_item_ids && split.line_item_ids.length > 0) {
        await client.query(`
          UPDATE estimate_line_items
          SET assigned_work_order_id = $1,
              assignment_status = 'assigned',
              assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $2::jsonb,
              updated_at = NOW()
          WHERE id = ANY($3)
        `, [
          newWO.id,
          JSON.stringify({
            action: 'assigned_via_split',
            work_order_id: newWO.id,
            work_order_number: newWO.work_order_number,
            assigned_at: new Date().toISOString(),
            reason: 'split_from_' + originalWO.work_order_number,
            split_type: 'whole_item'
          }),
          split.line_item_ids
        ]);
      }

      // Update QUANTITY-SPLIT child line items to point to new work order
      const childLineItemIds = [];
      for (const [parentId, childIdsBySplit] of quantitySplitResults) {
        if (childIdsBySplit.has(i)) {
          childLineItemIds.push(childIdsBySplit.get(i));
        }
      }

      if (childLineItemIds.length > 0) {
        await client.query(`
          UPDATE estimate_line_items
          SET assigned_work_order_id = $1,
              assignment_status = 'assigned',
              assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $2::jsonb,
              updated_at = NOW()
          WHERE id = ANY($3)
        `, [
          newWO.id,
          JSON.stringify({
            action: 'assigned_via_split',
            work_order_id: newWO.id,
            work_order_number: newWO.work_order_number,
            assigned_at: new Date().toISOString(),
            reason: 'split_from_' + originalWO.work_order_number,
            split_type: 'quantity_split'
          }),
          childLineItemIds
        ]);
      }

      // Copy dependencies to new work order
      for (const dep of originalDependencies) {
        await client.query(`
          INSERT INTO work_order_dependencies (tenant_id, work_order_id, depends_on_work_order_id, dependency_type)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [tenantId, newWO.id, dep.depends_on_work_order_id, dep.dependency_type]);
      }

      // Create lineage node for new WO
      const newNode = await lineageService.upsertWorkOrderNode({
        tenant_id: tenantId,
        work_order_id: newWO.id,
        work_order_number: newWO.work_order_number,
        customer_id: newWO.customer_id,
        site_id: newWO.site_id,
        status: newWO.status
      });

      // Collect quantity split info for metadata
      const quantitySplitInfo = [];
      for (const [parentId, childIdsBySplit] of quantitySplitResults) {
        if (childIdsBySplit.has(i)) {
          const parentItem = assignedLineItems.find(li => li.id === parentId);
          const ratio = quantitySplitItems.get(parentId)?.get(i) || 0;
          quantitySplitInfo.push({
            parentLineItemId: parentId,
            parentName: parentItem?.name,
            childLineItemId: childIdsBySplit.get(i),
            ratio: ratio
          });
        }
      }

      // Create SPLIT_INTO edge from original to new
      const edge = await lineageService.createEdge({
        tenant_id: tenantId,
        from_node_id: originalNode.id,
        to_node_id: newNode.id,
        edge_type: 'SPLIT_INTO',
        reason: `Split for parallel work - Crew ${crewLabel}`,
        metadata: {
          whole_item_count: split.line_item_ids?.length || 0,
          quantity_split_count: childLineItemIds.length,
          total_line_item_count: (split.line_item_ids?.length || 0) + childLineItemIds.length,
          estimated_hours: estimatedHours,
          crew_assignment: crewLabel.toLowerCase(),
          split_type: childLineItemIds.length > 0 ? 'mixed' : 'whole_items',
          quantity_splits: quantitySplitInfo.length > 0 ? quantitySplitInfo : undefined
        },
        created_by_user_id: userId
      });

      if (edge) {
        edgeIds.push(edge.id);
      }
    }

    // Cancel the original work order
    await client.query(`
      UPDATE work_orders
      SET status = 'CANCELLED',
          cancellation_reason = 'Split into ${splits.length} work orders',
          updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
    `, [id, tenantId]);

    // Update original lineage node status
    await lineageService.upsertWorkOrderNode({
      tenant_id: tenantId,
      work_order_id: id,
      work_order_number: originalWO.work_order_number,
      customer_id: originalWO.customer_id,
      site_id: originalWO.site_id,
      status: 'CANCELLED'
    });

    // Record the split event
    await lineageService.recordLineageEvent({
      tenant_id: tenantId,
      event_type: 'work_order_split',
      source_entity_ids: [id],
      target_entity_ids: newWorkOrders.map(wo => wo.id),
      event_reason: `Split into ${splits.length} parallel work orders for multiple technicians`,
      event_payload: {
        original_work_order: {
          id: originalWO.id,
          work_order_number: originalWO.work_order_number,
          phase_type: originalWO.phase_type,
          estimated_hours: originalWO.estimated_hours
        },
        new_work_orders: newWorkOrders.map(wo => ({
          id: wo.id,
          work_order_number: wo.work_order_number,
          crew_assignment: wo.crew_assignment,
          estimated_hours: wo.estimated_hours
        }))
      },
      triggered_by_user_id: userId,
      edge_ids: edgeIds
    });

    // Log to status history
    await client.query(`
      INSERT INTO work_order_status_history (
        tenant_id, work_order_id, from_status, to_status,
        changed_by, reason, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      tenantId,
      id,
      originalWO.status,
      'CANCELLED',
      userId,
      `Split into ${splits.length} work orders`,
      JSON.stringify({
        trigger: 'split_endpoint',
        new_work_order_ids: newWorkOrders.map(wo => wo.id),
        new_work_order_numbers: newWorkOrders.map(wo => wo.work_order_number)
      })
    ]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Work order split into ${splits.length} work orders`,
      data: {
        originalWorkOrderId: id,
        originalWorkOrderNumber: originalWO.work_order_number,
        originalStatus: 'CANCELLED',
        newWorkOrders: newWorkOrders.map(wo => ({
          id: wo.id,
          workOrderNumber: wo.work_order_number,
          title: wo.title,
          crewAssignment: wo.crew_assignment,
          technicianId: wo.technician_id,
          status: wo.status,
          estimatedHours: wo.estimated_hours
        })),
        lineageEdgeIds: edgeIds
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[WorkOrder] Split error:', error);
    next(error);
  } finally {
    client.release();
  }
});

// ============================================================================
// GET /api/work-orders/:id/line-items - Get line items for a work order
// ============================================================================
/**
 * Get all estimate line items assigned to this work order.
 * Used by the split modal to show what can be split.
 */
router.get('/:id/line-items', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    // Verify work order exists
    const woResult = await query(
      'SELECT id, work_order_number FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );

    if (woResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Work order not found',
        errorCode: 'WORK_ORDER_NOT_FOUND'
      });
    }

    // Get line items assigned to this work order
    const result = await query(`
      SELECT
        eli.id,
        eli.name,
        eli.description,
        eli.quantity,
        eli.unit_of_measure,
        eli.labor_hours,
        eli.default_labor_hours,
        eli.unit_price,
        eli.line_total,
        eli.item_type,
        eli.phase,
        eli.assignment_status,
        eli.estimate_id,
        ea.name as area_name
      FROM estimate_line_items eli
      LEFT JOIN estimate_areas ea ON eli.area_id = ea.id
      WHERE eli.assigned_work_order_id = $1
      ORDER BY ea.name, eli.name
    `, [id]);

    res.json({
      success: true,
      data: {
        workOrderId: id,
        workOrderNumber: woResult.rows[0].work_order_number,
        lineItems: result.rows.map(li => ({
          id: li.id,
          name: li.name,
          description: li.description,
          quantity: parseFloat(li.quantity || 1),
          unitOfMeasure: li.unit_of_measure,
          laborHours: parseFloat(li.labor_hours || li.default_labor_hours || 0),
          unitPrice: parseFloat(li.unit_price || 0),
          lineTotal: parseFloat(li.line_total || 0),
          itemType: li.item_type,
          phase: li.phase,
          assignmentStatus: li.assignment_status,
          estimateId: li.estimate_id,
          areaName: li.area_name
        })),
        totalItems: result.rows.length
      }
    });
  } catch (error) {
    console.error('[WorkOrder] Get line items error:', error);
    next(error);
  }
});

// ============================================================================
// PARTS SCHEDULING ENDPOINTS
// ============================================================================

// GET /api/work-orders/:id/parts-status - Get parts availability status for a work order
router.get('/:id/parts-status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    const status = await partsSchedulingService.getWorkOrderPartsStatus(id, tenantId);

    if (!status) {
      return res.status(404).json({
        success: false,
        message: 'Work order not found'
      });
    }

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('[WorkOrder] Get parts status error:', error);
    next(error);
  }
});

// GET /api/work-orders/:id/parts - Get detailed parts list with procurement info
router.get('/:id/parts', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    // Verify WO exists
    const woResult = await query(
      'SELECT id, work_order_number FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );

    if (woResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work order not found'
      });
    }

    const parts = await partsSchedulingService.getWorkOrderPartsDetails(id, tenantId);
    const status = await partsSchedulingService.getWorkOrderPartsStatus(id, tenantId);

    res.json({
      success: true,
      data: {
        workOrderId: id,
        workOrderNumber: woResult.rows[0].work_order_number,
        partsStatus: status,
        parts
      }
    });
  } catch (error) {
    console.error('[WorkOrder] Get parts error:', error);
    next(error);
  }
});

// POST /api/work-orders/:id/parts/check-availability - Trigger parts availability check
router.post('/:id/parts/check-availability', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    // Verify WO exists
    const woResult = await query(
      'SELECT id FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );

    if (woResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work order not found'
      });
    }

    const result = await partsSchedulingService.checkPartsAvailability(id, tenantId);

    res.json({
      success: true,
      data: result,
      message: `Parts availability checked. Status: ${result.newStatus?.parts_status || 'unknown'}`
    });
  } catch (error) {
    console.error('[WorkOrder] Check parts availability error:', error);
    next(error);
  }
});

// POST /api/work-orders/:id/parts/:partId/link-po - Link a work order part to a PO item
router.post('/:id/parts/:partId/link-po',
  requireRole('admin', 'manager', 'dispatcher', 'procurement'),
  [
    body('purchaseOrderItemId').isUUID().withMessage('Purchase order item ID is required'),
    body('quantity').isFloat({ min: 0.01 }).optional()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { id, partId } = req.params;
      const { purchaseOrderItemId, quantity } = req.body;
      const tenantId = req.user.tenant_id;

      // Verify WO exists
      const woResult = await query(
        'SELECT id FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
        [id, tenantId]
      );

      if (woResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Work order not found'
        });
      }

      // Verify part exists
      const partResult = await query(
        'SELECT id, quantity FROM work_order_parts WHERE id = $1 AND work_order_id = $2',
        [partId, id]
      );

      if (partResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Work order part not found'
        });
      }

      const result = await partsSchedulingService.linkWorkOrderPartToPurchaseOrder({
        workOrderPartId: partId,
        purchaseOrderItemId,
        quantity: quantity || partResult.rows[0].quantity,
        tenantId
      });

      // Queue async status update
      await sendCheckWorkOrderPartsAvailability({
        workOrderId: id,
        tenantId,
        triggeredBy: 'link_to_po'
      });

      res.json({
        success: true,
        data: result,
        message: 'Part linked to purchase order successfully'
      });
    } catch (error) {
      console.error('[WorkOrder] Link part to PO error:', error);
      next(error);
    }
  }
);

// POST /api/work-orders/:id/parts/link-po-bulk - Bulk link parts to a PO
router.post('/:id/parts/link-po-bulk',
  requireRole('admin', 'manager', 'dispatcher', 'procurement'),
  [
    body('purchaseOrderId').isUUID().withMessage('Purchase order ID is required'),
    body('allocations').isArray({ min: 1 }).withMessage('Allocations array is required'),
    body('allocations.*.workOrderPartId').isUUID().withMessage('Work order part ID is required'),
    body('allocations.*.purchaseOrderItemId').isUUID().withMessage('Purchase order item ID is required'),
    body('allocations.*.quantity').isFloat({ min: 0.01 }).withMessage('Quantity is required')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { id } = req.params;
      const { purchaseOrderId, allocations } = req.body;
      const tenantId = req.user.tenant_id;

      // Verify WO exists
      const woResult = await query(
        'SELECT id FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
        [id, tenantId]
      );

      if (woResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Work order not found'
        });
      }

      const result = await partsSchedulingService.linkMultiplePartsToPurchaseOrder({
        workOrderId: id,
        purchaseOrderId,
        allocations,
        tenantId
      });

      // Queue async status update
      await sendCheckWorkOrderPartsAvailability({
        workOrderId: id,
        tenantId,
        triggeredBy: 'bulk_link_to_po'
      });

      res.json({
        success: true,
        data: result,
        message: `${result.partsLinked} parts linked to purchase order successfully`
      });
    } catch (error) {
      console.error('[WorkOrder] Bulk link parts to PO error:', error);
      next(error);
    }
  }
);

// GET /api/work-orders/schedulable - Get work orders ready to schedule (parts available)
router.get('/parts/schedulable', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { page = 1, limit = 50, includeScheduled = 'false' } = req.query;
    const offset = (page - 1) * limit;

    const workOrders = await partsSchedulingService.getSchedulableWorkOrders(tenantId, {
      limit: parseInt(limit),
      offset,
      includeScheduled: includeScheduled === 'true'
    });

    res.json({
      success: true,
      data: {
        workOrders,
        total: workOrders.length
      }
    });
  } catch (error) {
    console.error('[WorkOrder] Get schedulable work orders error:', error);
    next(error);
  }
});

// GET /api/work-orders/parts/waiting - Get work orders waiting on parts
router.get('/parts/waiting', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { page = 1, limit = 50, parts_status } = req.query;
    const offset = (page - 1) * limit;

    const workOrders = await partsSchedulingService.getWorkOrdersWaitingOnParts(tenantId, {
      limit: parseInt(limit),
      offset,
      partsStatus: parts_status
    });

    res.json({
      success: true,
      data: {
        workOrders,
        total: workOrders.length
      }
    });
  } catch (error) {
    console.error('[WorkOrder] Get work orders waiting on parts error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/work-orders/:id/assets - Get assets checked out to a work order
// ============================================================================
router.get('/:id/assets', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    const result = await query(
      `SELECT ca.id, ca.name, ca.asset_tag, ca.status, ca.category
       FROM company_assets ca
       WHERE ca.checkout_work_order_id = $1 AND ca.tenant_id = $2
         AND ca.deleted_at IS NULL
       ORDER BY ca.name`,
      [id, tenantId]
    );

    res.json({
      success: true,
      data: {
        assets: result.rows
      }
    });
  } catch (error) {
    console.error('[WorkOrder] Get work order assets error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/work-orders/:id/tasks - Get tasks for a work order
// ============================================================================
router.get('/:id/tasks', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    const result = await query(
      `SELECT id, description, is_completed, estimated_hours,
              completed_at, completed_by, sequence_number as sort_order, notes as task_notes
       FROM tasks
       WHERE work_order_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       ORDER BY sequence_number ASC, created_at ASC`,
      [id, tenantId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('[WorkOrder] Get tasks error:', error);
    next(error);
  }
});

// ============================================================================
// PATCH /api/work-orders/:id/tasks/:taskId - Update task (toggle completion)
// ============================================================================
router.patch('/:id/tasks/:taskId', async (req, res, next) => {
  try {
    const { id, taskId } = req.params;
    const tenantId = req.user.tenant_id;
    const { is_completed, notes } = req.body;

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (is_completed !== undefined) {
      updates.push(`is_completed = $${paramIndex++}`);
      values.push(is_completed);
      if (is_completed) {
        updates.push(`completed_at = NOW()`);
        updates.push(`completed_by = $${paramIndex++}`);
        values.push(req.user.userId);
      } else {
        updates.push(`completed_at = NULL`);
        updates.push(`completed_by = NULL`);
      }
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(notes);
    }

    updates.push(`updated_at = NOW()`);

    values.push(taskId, id, tenantId);

    const result = await query(
      `UPDATE tasks SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND work_order_id = $${paramIndex++} AND tenant_id = $${paramIndex}
       RETURNING id, description, is_completed, estimated_hours, completed_at, completed_by,
                 sequence_number as sort_order, notes as task_notes`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[WorkOrder] Update task error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/work-orders/:id/crew - Get crew assignments
// ============================================================================
router.get('/:id/crew', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    // Verify WO exists and belongs to tenant
    const woResult = await query(
      'SELECT id, technician_id, crew_size, source_estimate_id FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );

    if (woResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    const wo = woResult.rows[0];

    // Get active crew members with technician details + clock-in status
    const crewResult = await query(
      `SELECT woc.id, woc.technician_id, woc.role as crew_role,
              woc.assigned_at,
              u.first_name, u.last_name, u.phone, u.email,
              CASE WHEN woc.technician_id = $3 THEN true ELSE false END as is_lead,
              CASE WHEN te.id IS NOT NULL THEN true ELSE false END as is_clocked_in,
              te.start_time as clock_in_time
       FROM work_order_crew woc
       JOIN users u ON u.id = woc.technician_id
       LEFT JOIN time_entries te ON te.user_id = woc.technician_id
         AND te.work_order_id = $1
         AND te.end_time IS NULL
       WHERE woc.work_order_id = $1 AND woc.tenant_id = $2 AND woc.removed_at IS NULL
       ORDER BY woc.role = 'lead' DESC, u.first_name ASC`,
      [id, tenantId, wo.technician_id]
    );

    // Get suggested crew size from estimate labor codes if available
    let suggestedCrewSize = null;
    if (wo.source_estimate_id) {
      const laborResult = await query(
        `SELECT MAX(
           CASE
             WHEN eli.labor_code = 'LAB4' THEN 4
             WHEN eli.labor_code = 'LAB3' THEN 3
             WHEN eli.labor_code = 'LAB2' THEN 2
             ELSE 1
           END
         ) as max_crew
         FROM estimate_line_items eli
         WHERE eli.estimate_id = $1`,
        [wo.source_estimate_id]
      ).catch(() => ({ rows: [{ max_crew: null }] }));

      suggestedCrewSize = laborResult.rows[0]?.max_crew || null;
    }

    res.json({
      success: true,
      data: {
        crew: crewResult.rows,
        crew_size: wo.crew_size || 1,
        suggested_crew_size: suggestedCrewSize
      }
    });
  } catch (error) {
    console.error('[WorkOrder] Get crew error:', error);
    next(error);
  }
});

// ============================================================================
// PUT /api/work-orders/:id/crew - Manage crew assignments
// ============================================================================
router.put('/:id/crew', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { crew = [] } = req.body;

    // Validate: no duplicate technician_ids
    const techIds = crew.map(c => c.technician_id);
    const uniqueTechIds = new Set(techIds);
    if (uniqueTechIds.size !== techIds.length) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate technician_id entries in crew list'
      });
    }

    // Verify WO exists and belongs to tenant
    const woResult = await query(
      'SELECT id, tenant_id, technician_id FROM work_orders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [id, tenantId]
    );

    if (woResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    const wo = woResult.rows[0];
    const leadTechId = wo.technician_id;

    // Soft-delete existing crew members not in the new list
    const newTechIds = crew.map(c => c.technician_id);
    // Also keep the lead tech if they exist
    const keepIds = leadTechId ? [...newTechIds, leadTechId] : newTechIds;

    if (keepIds.length > 0) {
      await query(
        `UPDATE work_order_crew
         SET removed_at = NOW(), removed_by = $4
         WHERE work_order_id = $1 AND tenant_id = $2 AND removed_at IS NULL
           AND technician_id != ALL($3::uuid[])`,
        [id, tenantId, keepIds, userId]
      );
    } else {
      await query(
        `UPDATE work_order_crew
         SET removed_at = NOW(), removed_by = $3
         WHERE work_order_id = $1 AND tenant_id = $2 AND removed_at IS NULL`,
        [id, tenantId, userId]
      );
    }

    // Auto-include lead tech if WO has a technician_id
    const allCrew = [];
    if (leadTechId) {
      const leadResult = await query(
        `INSERT INTO work_order_crew (tenant_id, work_order_id, technician_id, role, assigned_by)
         VALUES ($1, $2, $3, 'lead', $4)
         ON CONFLICT (work_order_id, technician_id)
         DO UPDATE SET role = 'lead', removed_at = NULL, removed_by = NULL, updated_at = NOW()
         RETURNING id, technician_id, role as crew_role, true as is_lead`,
        [tenantId, id, leadTechId, userId]
      );
      allCrew.push(...leadResult.rows);
    }

    // Insert/upsert each crew member
    for (const member of crew) {
      // Skip if this is the lead tech (already handled above)
      if (member.technician_id === leadTechId) continue;

      const role = member.crew_role || member.role || 'member';
      const memberResult = await query(
        `INSERT INTO work_order_crew (tenant_id, work_order_id, technician_id, role, assigned_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (work_order_id, technician_id)
         DO UPDATE SET role = $4, removed_at = NULL, removed_by = NULL, updated_at = NOW()
         RETURNING id, technician_id, role as crew_role`,
        [tenantId, id, member.technician_id, role, userId]
      );
      allCrew.push(...memberResult.rows);
    }

    // Update crew_size on work order (lead + crew members)
    const crewSize = allCrew.length;
    const updateResult = await query(
      'UPDATE work_orders SET crew_size = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id, crew_size',
      [crewSize, id, tenantId]
    );

    res.json({
      success: true,
      data: {
        crew: allCrew,
        crew_size: updateResult.rows[0]?.crew_size || crewSize
      }
    });
  } catch (error) {
    console.error('[WorkOrder] Update crew error:', error);
    next(error);
  }
});

// ============================================================================
// CLOCK-IN SESSION (QR Code)
// ============================================================================

/**
 * @route   POST /api/work-orders/:id/clock-in-session
 * @desc    Lead tech creates a short-lived clock-in session for QR code
 * @access  Private (lead tech only)
 */
router.post('/:id/clock-in-session', async (req, res, next) => {
  try {
    const workOrderId = req.params.id;
    const { userId, tenantId } = req.user;
    const crypto = require('crypto');

    // Validate requester is lead tech or assigned tech
    const woResult = await query(
      'SELECT technician_id FROM work_orders WHERE id = $1 AND tenant_id = $2',
      [workOrderId, tenantId]
    );
    if (woResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found' });
    }

    // Allow lead tech or any crew member with 'lead' role
    const isLeadTech = woResult.rows[0].technician_id === userId;
    if (!isLeadTech) {
      const crewCheck = await query(
        "SELECT role FROM work_order_crew WHERE work_order_id = $1 AND technician_id = $2 AND role = 'lead' AND removed_at IS NULL",
        [workOrderId, userId]
      );
      if (crewCheck.rows.length === 0) {
        return res.status(403).json({ success: false, error: 'Only the lead tech can create clock-in sessions' });
      }
    }

    // Deactivate any existing active sessions for this WO
    await query(
      'UPDATE clock_in_sessions SET is_active = false WHERE work_order_id = $1 AND is_active = true',
      [workOrderId]
    );

    // Create new session (5 minute expiry)
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const result = await query(`
      INSERT INTO clock_in_sessions (tenant_id, work_order_id, created_by, session_token, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, session_token, expires_at, created_at
    `, [tenantId, workOrderId, userId, sessionToken, expiresAt]);

    res.status(201).json({
      success: true,
      session: {
        id: result.rows[0].id,
        token: result.rows[0].session_token,
        expiresAt: result.rows[0].expires_at,
        qrUrl: `https://tech.numeruspro.com/clock-in/?token=${sessionToken}`,
      },
    });
  } catch (error) {
    console.error('[WorkOrder] Create clock-in session error:', error);
    next(error);
  }
});

module.exports = router;
