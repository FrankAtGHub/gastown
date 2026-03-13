package cmd

import (
	"encoding/json"
	"io"
	"time"

	"github.com/spf13/cobra"
)

// agentStartResult holds the result of starting an agent.
type agentStartResult struct {
	name   string // Display name like "Witness (gastown)"
	ok     bool   // Whether start succeeded
	detail string // Status detail (session name or error)
}

// UpOutput represents the JSON output of the up command.
type UpOutput struct {
	Success  bool            `json:"success"`
	Services []ServiceStatus `json:"services"`
	Summary  UpSummary       `json:"summary"`
}

// ServiceStatus represents the status of a single service.
type ServiceStatus struct {
	Name   string `json:"name"`
	Type   string `json:"type"` // daemon, deacon, mayor, witness, refinery, crew, polecat
	Rig    string `json:"rig,omitempty"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

// UpSummary provides counts for the up command output.
type UpSummary struct {
	Total   int `json:"total"`
	Started int `json:"started"`
	Failed  int `json:"failed"`
}

func buildUpSummary(services []ServiceStatus) UpSummary {
	started := 0
	failed := 0
	for _, svc := range services {
		if svc.OK {
			started++
		} else {
			failed++
		}
	}
	return UpSummary{
		Total:   len(services),
		Started: started,
		Failed:  failed,
	}
}

func emitUpJSON(w io.Writer, services []ServiceStatus) error {
	summary := buildUpSummary(services)
	output := UpOutput{
		Success:  summary.Failed == 0,
		Services: services,
		Summary:  summary,
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(output); err != nil {
		return err
	}
	if summary.Failed > 0 {
		return NewSilentExit(1)
	}
	return nil
}

// maxConcurrentAgentStarts limits parallel agent startups to avoid resource
// exhaustion. Each agent start spawns a tmux session and runs gt prime, so
// more than ~10 concurrent starts can saturate CPU and cause timeouts.
const maxConcurrentAgentStarts = 10

// daemonStartupGrace is how long to wait after spawning the daemon process
// before verifying it started. The daemon needs time to write its PID file.
const daemonStartupGrace = 300 * time.Millisecond

var upCmd = &cobra.Command{
	Use:     "up",
	GroupID: GroupServices,
	Short:   "Bring up all Gas Town services",
	Long: `Start all Gas Town long-lived services.

This is the idempotent "boot" command for Gas Town. It ensures all
infrastructure agents are running:

  • Dolt       - Shared SQL database server for beads
  • Daemon     - Go background process that pokes agents
  • Deacon     - Health orchestrator (monitors Mayor/Witnesses)
  • Mayor      - Global work coordinator
  • Witnesses  - Per-rig polecat managers
  • Refineries - Per-rig merge queue processors

Polecats are NOT started by this command - they are transient workers
spawned on demand by the Mayor or Witnesses.

Use --restore to also start:
  • Crew       - Per rig settings (settings/config.json crew.startup)
  • Polecats   - Those with pinned beads (work attached)

Running 'gt up' multiple times is safe - it only starts services that
aren't already running.`,
	RunE: runUp,
}

var (
	upQuiet   bool
	upRestore bool
	upJSON    bool
)

func init() {
	upCmd.Flags().BoolVarP(&upQuiet, "quiet", "q", false, "Only show errors (ignored with --json)")
	upCmd.Flags().BoolVar(&upRestore, "restore", false, "Also restore crew (from settings) and polecats (from hooks)")
	upCmd.Flags().BoolVar(&upJSON, "json", false, "Output as JSON")
	rootCmd.AddCommand(upCmd)
}

func runUp(cmd *cobra.Command, args []string) error {
	return errNotImplemented("gt up (Night City rewrite needed)")
}


func printStatus(name string, ok bool, detail string) {}
func ensureDaemon(townRoot string) error { return nil }
func waitForDoltReady(townRoot string) {}
func IsRigParkedOrDocked(townRoot, name string) bool { return false }
