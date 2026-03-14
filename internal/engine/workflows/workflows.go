// Package workflows implements Inngest-powered durable workflows for the Town Engine.
//
// This is the nervous system: event-driven pipelines, cron-based monitoring,
// dead man's switch, and multi-step orchestration.
//
// Uses inngest/inngestgo for durable execution.
package workflows

import (
	"context"
	"fmt"
	"time"

	"github.com/inngest/inngestgo"
	"github.com/inngest/inngestgo/step"
	"github.com/FrankAtGHub/night-city/internal/engine/accountability"
)

// Event names used by the Town Engine.
const (
	EventAgentStarted   = "town/agent.started"
	EventAgentStopped   = "town/agent.stopped"
	EventAgentHeartbeat = "town/agent.heartbeat"
	EventAgentStuck     = "town/agent.stuck"

	EventTaskAssigned  = "town/task.assigned"
	EventTaskCompleted = "town/task.completed"
	EventTaskFailed    = "town/task.failed"

	EventCodeCommitted   = "town/pipeline.code_committed"
	EventMergeCompleted  = "town/pipeline.merge_completed"
	EventDeployCompleted = "town/pipeline.deploy_completed"
	EventVerifyCompleted = "town/pipeline.verify_completed"
	EventReportReady     = "town/pipeline.report_ready"
)

// AgentEventData is the payload for agent lifecycle events.
type AgentEventData struct {
	Agent   string `json:"agent"`
	State   string `json:"state"`
	Context string `json:"context,omitempty"`
}

// TaskEventData is the payload for task-related events.
type TaskEventData struct {
	TaskID string `json:"task_id"`
	Agent  string `json:"agent"`
	Title  string `json:"title"`
	Result string `json:"result,omitempty"`
}

// PipelineEventData is the payload for pipeline stage transitions.
type PipelineEventData struct {
	PipelineID string `json:"pipeline_id"`
	Stage      string `json:"stage"`
	Agent      string `json:"agent"`
	Artifact   string `json:"artifact,omitempty"`
}

// Engine holds the Inngest client and registered functions.
type Engine struct {
	client     inngestgo.Client
	store      *accountability.Store
	functions  []inngestgo.ServableFunction
}

// NewEngine creates a new workflow engine with Inngest.
func NewEngine(store *accountability.Store) (*Engine, error) {
	client, err := inngestgo.NewClient(inngestgo.ClientOpts{
		AppID: "night-city",
	})
	if err != nil {
		return nil, fmt.Errorf("creating inngest client: %w", err)
	}

	e := &Engine{
		client: client,
		store:  store,
	}

	if err := e.registerFunctions(); err != nil {
		return nil, err
	}

	return e, nil
}

// Functions returns all registered Inngest functions for serving.
func (e *Engine) Functions() []inngestgo.ServableFunction {
	return e.functions
}

// registerFunctions sets up all workflow functions.
func (e *Engine) registerFunctions() error {
	// Dead man's switch: check heartbeats every 2 minutes
	deadManSwitch, err := inngestgo.CreateFunction(
		e.client,
		inngestgo.FunctionOpts{
			ID:   "dead-mans-switch",
			Name: "Dead Man's Switch",
		},
		inngestgo.CronTrigger("*/2 * * * *"),
		func(ctx context.Context, input inngestgo.Input[any]) (any, error) {
			return e.deadMansSwitchHandler(ctx, input)
		},
	)
	if err != nil {
		return fmt.Errorf("creating dead mans switch: %w", err)
	}
	e.functions = append(e.functions, deadManSwitch)

	// Pipeline orchestrator: triggered when code is committed
	pipeline, err := inngestgo.CreateFunction(
		e.client,
		inngestgo.FunctionOpts{
			ID:   "pipeline-orchestrator",
			Name: "Pipeline Orchestrator",
		},
		inngestgo.EventTrigger(EventCodeCommitted, nil),
		func(ctx context.Context, input inngestgo.Input[PipelineEventData]) (any, error) {
			return e.pipelineHandler(ctx, input)
		},
	)
	if err != nil {
		return fmt.Errorf("creating pipeline: %w", err)
	}
	e.functions = append(e.functions, pipeline)

	// Agent lifecycle: triggered when an agent starts
	agentLifecycle, err := inngestgo.CreateFunction(
		e.client,
		inngestgo.FunctionOpts{
			ID:   "agent-lifecycle",
			Name: "Agent Lifecycle Monitor",
		},
		inngestgo.EventTrigger(EventAgentStarted, nil),
		func(ctx context.Context, input inngestgo.Input[AgentEventData]) (any, error) {
			return e.agentLifecycleHandler(ctx, input)
		},
	)
	if err != nil {
		return fmt.Errorf("creating agent lifecycle: %w", err)
	}
	e.functions = append(e.functions, agentLifecycle)

	return nil
}

// deadMansSwitchHandler checks all agent heartbeats and alerts on stale ones.
func (e *Engine) deadMansSwitchHandler(ctx context.Context, _ inngestgo.Input[any]) (any, error) {
	// Read all heartbeat files
	agents := []string{} // TODO: get from config/registry
	stale := []string{}

	for _, agent := range agents {
		hb, err := e.store.ReadHeartbeat(agent)
		if err != nil {
			stale = append(stale, agent+" (no heartbeat)")
			continue
		}
		if time.Since(hb.Timestamp) > 5*time.Minute {
			stale = append(stale, fmt.Sprintf("%s (last seen %s ago)", agent, time.Since(hb.Timestamp).Round(time.Second)))
		}
	}

	if len(stale) > 0 {
		// Log alert, send event for escalation
		e.store.AppendWorkLog(accountability.WorkLogEntry{
			Agent:  "workflows",
			Action: "alert",
			Detail: fmt.Sprintf("dead mans switch: stale agents: %v", stale),
		})
	}

	return map[string]any{"stale": stale}, nil
}

// pipelineHandler orchestrates the implement → merge → deploy → verify → report pipeline.
func (e *Engine) pipelineHandler(ctx context.Context, input inngestgo.Input[PipelineEventData]) (any, error) {
	pipelineID := input.Event.Data.PipelineID

	// Step 1: Wait for merge
	_, err := step.WaitForEvent[PipelineEventData](ctx, "wait-merge", step.WaitForEventOpts{
		Event:   EventMergeCompleted,
		Timeout: 30 * time.Minute,
		If:      inngestgo.StrPtr(fmt.Sprintf("async.data.pipeline_id == '%s'", pipelineID)),
	})
	if err != nil {
		return nil, fmt.Errorf("merge timeout for pipeline %s: %w", pipelineID, err)
	}

	// Step 2: Wait for deploy
	_, err = step.WaitForEvent[PipelineEventData](ctx, "wait-deploy", step.WaitForEventOpts{
		Event:   EventDeployCompleted,
		Timeout: 15 * time.Minute,
		If:      inngestgo.StrPtr(fmt.Sprintf("async.data.pipeline_id == '%s'", pipelineID)),
	})
	if err != nil {
		return nil, fmt.Errorf("deploy timeout for pipeline %s: %w", pipelineID, err)
	}

	// Step 3: Wait for verification
	_, err = step.WaitForEvent[PipelineEventData](ctx, "wait-verify", step.WaitForEventOpts{
		Event:   EventVerifyCompleted,
		Timeout: 20 * time.Minute,
		If:      inngestgo.StrPtr(fmt.Sprintf("async.data.pipeline_id == '%s'", pipelineID)),
	})
	if err != nil {
		return nil, fmt.Errorf("verify timeout for pipeline %s: %w", pipelineID, err)
	}

	// Step 4: Generate report
	_, err = step.Run(ctx, "generate-report", func(ctx context.Context) (any, error) {
		e.store.AppendWorkLog(accountability.WorkLogEntry{
			Agent:  "workflows",
			Action: "report",
			Detail: fmt.Sprintf("pipeline %s completed: all stages passed", pipelineID),
		})
		return map[string]string{"status": "complete"}, nil
	})
	if err != nil {
		return nil, err
	}

	return map[string]string{"pipeline": pipelineID, "status": "complete"}, nil
}

// agentLifecycleHandler monitors an agent after it starts, watching for heartbeats.
func (e *Engine) agentLifecycleHandler(ctx context.Context, input inngestgo.Input[AgentEventData]) (any, error) {
	agent := input.Event.Data.Agent

	// Wait for heartbeat with 5-minute timeout, loop until agent stops
	for {
		evt, err := step.WaitForEvent[AgentEventData](ctx, fmt.Sprintf("heartbeat-%s-%d", agent, time.Now().Unix()), step.WaitForEventOpts{
			Event:   EventAgentHeartbeat,
			Timeout: 5 * time.Minute,
			If:      inngestgo.StrPtr(fmt.Sprintf("async.data.agent == '%s'", agent)),
		})
		if err != nil {
			// Timeout: agent missed heartbeat
			e.store.AppendWorkLog(accountability.WorkLogEntry{
				Agent:  "workflows",
				Action: "alert",
				Detail: fmt.Sprintf("agent %s missed heartbeat, triggering dead mans switch", agent),
			})
			return map[string]string{"agent": agent, "status": "dead"}, nil
		}

		if evt.State == "exiting" {
			return map[string]string{"agent": agent, "status": "exited"}, nil
		}
	}
}
