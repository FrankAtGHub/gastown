-- Wave 152: QR Clock-In Sessions
-- Short-lived session tokens for QR-based crew clock-in

CREATE TABLE IF NOT EXISTS clock_in_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  work_order_id UUID NOT NULL REFERENCES work_orders(id),
  created_by UUID NOT NULL REFERENCES users(id),
  session_token VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clock_in_sessions_token ON clock_in_sessions(session_token) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_clock_in_sessions_wo ON clock_in_sessions(work_order_id);
