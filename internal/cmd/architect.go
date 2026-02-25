package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"

	"github.com/spf13/cobra"
	"github.com/steveyegge/gastown/internal/architect"
	"github.com/steveyegge/gastown/internal/style"
	"github.com/steveyegge/gastown/internal/tmux"
	"github.com/steveyegge/gastown/internal/workspace"
)

// Architect command flags
var (
	architectStatusJSON    bool
	architectAgentOverride string
	architectEnvOverrides  []string
)

var architectCmd = &cobra.Command{
	Use:     "architect",
	Aliases: []string{"arch"},
	GroupID: GroupAgents,
	Short:   "Manage the Architect (independent quality authority)",
	RunE:    requireSubcommand,
	Long: `Manage the Architect - the independent quality authority for a rig.

The Architect is an on-demand reviewer that validates wave output:
  - Independent code review with 30 years of battle scars
  - Screenshot audit (real renders or rejection)
  - Gate artifact verification (anti-fabrication enforcement)
  - Wave planning assistance
  - Cross-rig review authority

The Architect persists between reviews (not self-cleaning like polecats).
Summoned by Mayor or human via mail, executes review protocol, sends verdict.

One Architect per rig. On-demand activation — no patrol, no monitoring.`,
}

var architectStartCmd = &cobra.Command{
	Use:     "start <rig>",
	Aliases: []string{"spawn"},
	Short:   "Start the architect",
	Long: `Start the Architect for a rig.

Launches the quality authority agent which reviews polecat output
and validates wave artifacts before merge.

Examples:
  gt architect start copperhead
  gt architect start copperhead --agent codex
  gt architect start copperhead --env ANTHROPIC_MODEL=claude-3-haiku`,
	Args: cobra.ExactArgs(1),
	RunE: runArchitectStart,
}

var architectStopCmd = &cobra.Command{
	Use:   "stop <rig>",
	Short: "Stop the architect",
	Long: `Stop a running Architect.

Gracefully stops the architect session.`,
	Args: cobra.ExactArgs(1),
	RunE: runArchitectStop,
}

var architectStatusCmd = &cobra.Command{
	Use:   "status <rig>",
	Short: "Show architect status",
	Long: `Show the status of a rig's Architect.

Displays running state and session information.`,
	Args: cobra.ExactArgs(1),
	RunE: runArchitectStatus,
}

var architectAttachCmd = &cobra.Command{
	Use:     "attach [rig]",
	Aliases: []string{"at"},
	Short:   "Attach to architect session",
	Long: `Attach to the Architect tmux session for a rig.

Attaches the current terminal to the architect's tmux session.
Detach with Ctrl-B D.

If the architect is not running, this will start it first.
If rig is not specified, infers it from the current directory.

Examples:
  gt architect attach copperhead
  gt architect attach          # infer rig from cwd`,
	Args: cobra.MaximumNArgs(1),
	RunE: runArchitectAttach,
}

var architectRestartCmd = &cobra.Command{
	Use:   "restart <rig>",
	Short: "Restart the architect",
	Long: `Restart the Architect for a rig.

Stops the current session (if running) and starts a fresh one.

Examples:
  gt architect restart copperhead
  gt architect restart copperhead --agent codex`,
	Args: cobra.ExactArgs(1),
	RunE: runArchitectRestart,
}

func init() {
	// Start flags
	architectStartCmd.Flags().StringVar(&architectAgentOverride, "agent", "", "Agent alias to run the Architect with (overrides town default)")
	architectStartCmd.Flags().StringArrayVar(&architectEnvOverrides, "env", nil, "Environment variable override (KEY=VALUE, can be repeated)")

	// Status flags
	architectStatusCmd.Flags().BoolVar(&architectStatusJSON, "json", false, "Output as JSON")

	// Restart flags
	architectRestartCmd.Flags().StringVar(&architectAgentOverride, "agent", "", "Agent alias to run the Architect with (overrides town default)")
	architectRestartCmd.Flags().StringArrayVar(&architectEnvOverrides, "env", nil, "Environment variable override (KEY=VALUE, can be repeated)")

	// Add subcommands
	architectCmd.AddCommand(architectStartCmd)
	architectCmd.AddCommand(architectStopCmd)
	architectCmd.AddCommand(architectRestartCmd)
	architectCmd.AddCommand(architectStatusCmd)
	architectCmd.AddCommand(architectAttachCmd)

	rootCmd.AddCommand(architectCmd)
}

// getArchitectManager creates an architect manager for a rig.
func getArchitectManager(rigName string) (*architect.Manager, error) {
	_, r, err := getRig(rigName)
	if err != nil {
		return nil, err
	}

	mgr := architect.NewManager(r)
	return mgr, nil
}

func runArchitectStart(cmd *cobra.Command, args []string) error {
	rigName := args[0]

	if err := checkRigNotParkedOrDocked(rigName); err != nil {
		return err
	}

	mgr, err := getArchitectManager(rigName)
	if err != nil {
		return err
	}

	fmt.Printf("Starting architect for %s...\n", rigName)

	if err := mgr.Start(architectAgentOverride, architectEnvOverrides); err != nil {
		if err == architect.ErrAlreadyRunning {
			fmt.Printf("%s Architect is already running\n", style.Dim.Render("⚠"))
			fmt.Printf("  %s\n", style.Dim.Render("Use 'gt architect attach' to connect"))
			return nil
		}
		return fmt.Errorf("starting architect: %w", err)
	}

	fmt.Printf("%s Architect started for %s\n", style.Bold.Render("✓"), rigName)
	fmt.Printf("  %s\n", style.Dim.Render("Use 'gt architect attach' to connect"))
	fmt.Printf("  %s\n", style.Dim.Render("Use 'gt architect status' to check progress"))
	return nil
}

func runArchitectStop(cmd *cobra.Command, args []string) error {
	rigName := args[0]

	mgr, err := getArchitectManager(rigName)
	if err != nil {
		return err
	}

	// Kill tmux session if it exists
	t := tmux.NewTmux()
	sessionName := architectSessionName(rigName)
	running, _ := t.HasSession(sessionName)
	if running {
		if err := t.KillSessionWithProcesses(sessionName); err != nil {
			style.PrintWarning("failed to kill session: %v", err)
		}
	}

	// Update state
	if err := mgr.Stop(); err != nil {
		if err == architect.ErrNotRunning && !running {
			fmt.Printf("%s Architect is not running\n", style.Dim.Render("⚠"))
			return nil
		}
		if !running {
			return fmt.Errorf("stopping architect: %w", err)
		}
	}

	fmt.Printf("%s Architect stopped for %s\n", style.Bold.Render("✓"), rigName)
	return nil
}

// ArchitectStatusOutput is the JSON output format for architect status.
type ArchitectStatusOutput struct {
	Running bool   `json:"running"`
	RigName string `json:"rig_name"`
	Session string `json:"session,omitempty"`
}

func runArchitectStatus(cmd *cobra.Command, args []string) error {
	rigName := args[0]

	mgr, err := getArchitectManager(rigName)
	if err != nil {
		return err
	}

	// ZFC: tmux is source of truth for running state
	running, _ := mgr.IsRunning()
	sessionInfo, _ := mgr.Status()

	// JSON output
	if architectStatusJSON {
		output := ArchitectStatusOutput{
			Running: running,
			RigName: rigName,
		}
		if sessionInfo != nil {
			output.Session = sessionInfo.Name
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(output)
	}

	// Human-readable output
	fmt.Printf("%s Architect: %s\n\n", style.Bold.Render("📐"), rigName)

	if running {
		fmt.Printf("  State: %s\n", style.Bold.Render("● running"))
		if sessionInfo != nil {
			fmt.Printf("  Session: %s\n", sessionInfo.Name)
		}
	} else {
		fmt.Printf("  State: %s\n", style.Dim.Render("○ stopped"))
	}

	return nil
}

// architectSessionName returns the tmux session name for a rig's architect.
func architectSessionName(rigName string) string {
	return fmt.Sprintf("gt-%s-architect", rigName)
}

func runArchitectAttach(cmd *cobra.Command, args []string) error {
	rigName := ""
	if len(args) > 0 {
		rigName = args[0]
	}

	// Infer rig from cwd if not provided
	if rigName == "" {
		townRoot, err := workspace.FindFromCwdOrError()
		if err != nil {
			return fmt.Errorf("not in a Gas Town workspace: %w", err)
		}
		rigName, err = inferRigFromCwd(townRoot)
		if err != nil {
			return fmt.Errorf("could not determine rig: %w\nUsage: gt architect attach <rig>", err)
		}
	}

	// Verify rig exists and get manager
	mgr, err := getArchitectManager(rigName)
	if err != nil {
		return err
	}

	sessionName := architectSessionName(rigName)

	// Ensure session exists (creates if needed)
	if err := mgr.Start("", nil); err != nil && err != architect.ErrAlreadyRunning {
		return err
	} else if err == nil {
		fmt.Printf("Started architect session for %s\n", rigName)
	}

	// Attach to the session
	tmuxPath, err := exec.LookPath("tmux")
	if err != nil {
		return fmt.Errorf("tmux not found: %w", err)
	}

	attachCmd := exec.Command(tmuxPath, "attach-session", "-t", sessionName)
	attachCmd.Stdin = os.Stdin
	attachCmd.Stdout = os.Stdout
	attachCmd.Stderr = os.Stderr
	return attachCmd.Run()
}

func runArchitectRestart(cmd *cobra.Command, args []string) error {
	rigName := args[0]

	if err := checkRigNotParkedOrDocked(rigName); err != nil {
		return err
	}

	mgr, err := getArchitectManager(rigName)
	if err != nil {
		return err
	}

	fmt.Printf("Restarting architect for %s...\n", rigName)

	// Stop existing session (non-fatal: may not be running)
	_ = mgr.Stop()

	// Start fresh
	if err := mgr.Start(architectAgentOverride, architectEnvOverrides); err != nil {
		return fmt.Errorf("starting architect: %w", err)
	}

	fmt.Printf("%s Architect restarted for %s\n", style.Bold.Render("✓"), rigName)
	fmt.Printf("  %s\n", style.Dim.Render("Use 'gt architect attach' to connect"))
	return nil
}
