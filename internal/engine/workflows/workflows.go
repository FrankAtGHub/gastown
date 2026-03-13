// Package workflows implements Inngest-powered durable workflows for the Town Engine.
//
// This is the nervous system — event-driven pipelines, cron-based monitoring,
// dead man's switch, and multi-step orchestration (implement → merge → deploy → verify → report).
//
// Uses inngest/inngestgo for durable execution.
package workflows

// Event names used by the Town Engine.
const (
	// Agent lifecycle events
	EventAgentStarted    = "agent/started"
	EventAgentStopped    = "agent/stopped"
	EventAgentHeartbeat  = "agent/heartbeat"
	EventAgentStuck      = "agent/stuck"

	// Task events
	EventTaskAssigned    = "task/assigned"
	EventTaskCompleted   = "task/completed"
	EventTaskFailed      = "task/failed"

	// Pipeline events
	EventCodeCommitted   = "pipeline/code.committed"
	EventMergeCompleted  = "pipeline/merge.completed"
	EventDeployCompleted = "pipeline/deploy.completed"
	EventVerifyCompleted = "pipeline/verify.completed"
	EventReportReady     = "pipeline/report.ready"
)

// AgentEvent is the payload for agent lifecycle events.
type AgentEvent struct {
	Agent   string `json:"agent"`
	State   string `json:"state"`
	Context string `json:"context,omitempty"`
}

// TaskEvent is the payload for task-related events.
type TaskEvent struct {
	TaskID  string `json:"task_id"`
	Agent   string `json:"agent"`
	Title   string `json:"title"`
	Result  string `json:"result,omitempty"`
}

// PipelineEvent is the payload for pipeline stage transitions.
type PipelineEvent struct {
	PipelineID string `json:"pipeline_id"`
	Stage      string `json:"stage"`
	Agent      string `json:"agent"`
	Artifact   string `json:"artifact,omitempty"` // commit hash, PR URL, deploy ID, etc.
}

// TODO: Wire up Inngest functions:
// - DeadMansSwitch: CronTrigger every 2min, check heartbeats, alert on stale
// - PipelineOrchestrator: EventTrigger on code.committed, step through merge→deploy→verify→report
// - HeartbeatMonitor: WaitForEvent with timeout for individual agent health
// - CleanupJob: CronTrigger daily, prune old work logs, archive scorecards
