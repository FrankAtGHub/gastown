package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/config"
	"github.com/FrankAtGHub/night-city/internal/git"
	"github.com/FrankAtGHub/night-city/internal/rig"
	"github.com/FrankAtGHub/night-city/internal/session"
	"github.com/FrankAtGHub/night-city/internal/style"
	"github.com/FrankAtGHub/night-city/internal/tmux"
	"github.com/FrankAtGHub/night-city/internal/workspace"
)

// defaultOrphanGraceSecs is the grace period (in seconds) between SIGTERM and SIGKILL
// when automatically cleaning up orphaned Claude processes during shutdown.
// This is shorter than the --cleanup-orphans-grace-secs default (60s) because
// automatic cleanup runs after sessions are already killed, so processes have
// already had time to shut down.
const defaultOrphanGraceSecs = 5

var (
	startAll                    bool
	startAgentOverride          string
	startCrewRig                string
	startCrewAccount            string
	startCrewAgentOverride      string
	startCostTier               string
	shutdownGraceful            bool
	shutdownWait                int
	shutdownAll                 bool
	shutdownForce               bool
	shutdownYes                 bool
	shutdownPolecatsOnly        bool
	shutdownNuclear             bool
	shutdownCleanupOrphans      bool
	shutdownCleanupOrphansGrace int
)

var startCmd = &cobra.Command{
	Use:     "start [path]",
	GroupID: GroupServices,
	Short:   "Start Gas Town or a crew workspace",
	Long: `Start Gas Town by launching the Deacon and Mayor.

The Deacon is the health-check orchestrator that monitors Mayor and Witnesses.
The Mayor is the global coordinator that dispatches work.

By default, other agents (Witnesses, Refineries) are started lazily as needed.
Use --all to start Witnesses and Refineries for all registered rigs immediately.

Crew shortcut:
  If a path like "rig/crew/name" is provided, starts that crew workspace.
  This is equivalent to 'gt start crew rig/name'.

To stop Gas Town, use 'gt shutdown'.`,
	Args: cobra.MaximumNArgs(1),
	RunE: runStart,
}

var shutdownCmd = &cobra.Command{
	Use:     "shutdown",
	GroupID: GroupServices,
	Short:   "Shutdown Gas Town with cleanup",
	Long: `Shutdown Gas Town by stopping agents and cleaning up polecats.

This is the "done for the day" command - it stops everything AND removes
polecat worktrees/branches. For a reversible pause, use 'gt down' instead.

Comparison:
  gt down      - Pause (stop processes, keep worktrees) - reversible
  gt shutdown  - Done (stop + cleanup worktrees) - permanent cleanup

After killing sessions, polecats are cleaned up:
  - Worktrees are removed
  - Polecat branches are deleted
  - Polecats with uncommitted work are SKIPPED (protected)

Shutdown levels (progressively more aggressive):
  (default)       - Stop infrastructure + polecats + cleanup
  --all           - Also stop crew sessions
  --polecats-only - Only stop polecats (leaves infrastructure running)

Use --force or --yes to skip confirmation prompt.
Use --graceful to allow agents time to save state before killing.
Use --nuclear to force cleanup even if polecats have uncommitted work (DANGER).
Use --cleanup-orphans to use a longer grace period for orphan cleanup (default 60s).
Use --cleanup-orphans-grace-secs to set that grace period.

Orphaned Claude processes are always cleaned up after session termination.
By default, a 5-second grace period is used. The --cleanup-orphans flag
extends this to --cleanup-orphans-grace-secs (default 60s) for stubborn processes.`,
	RunE: runShutdown,
}

var startCrewCmd = &cobra.Command{
	Use:   "crew <name>",
	Short: "Start a crew workspace (creates if needed)",
	Long: `Start a crew workspace, creating it if it doesn't exist.

This is a convenience command that combines 'gt crew add' and 'gt crew at --detached'.
The crew session starts in the background with Claude running and ready.

The name can include the rig in slash format (e.g., greenplace/joe).
If not specified, the rig is inferred from the current directory.

Examples:
  gt start crew joe                    # Start joe in current rig
  gt start crew greenplace/joe            # Start joe in gastown rig
  gt start crew joe --rig beads        # Start joe in beads rig`,
	Args: cobra.ExactArgs(1),
	RunE: runStartCrew,
}

func init() {
	startCmd.Flags().BoolVarP(&startAll, "all", "a", false,
		"Also start Witnesses and Refineries for all rigs")
	startCmd.Flags().StringVar(&startAgentOverride, "agent", "", "Agent alias to run Mayor/Deacon with (overrides town default)")
	startCmd.Flags().StringVar(&startCostTier, "cost-tier", "", "Ephemeral cost tier for this session (standard/economy/budget)")

	startCrewCmd.Flags().StringVar(&startCrewRig, "rig", "", "Rig to use")
	startCrewCmd.Flags().StringVar(&startCrewAccount, "account", "", "Claude Code account handle to use")
	startCrewCmd.Flags().StringVar(&startCrewAgentOverride, "agent", "", "Agent alias to run crew worker with (overrides rig/town default)")
	startCmd.AddCommand(startCrewCmd)

	shutdownCmd.Flags().BoolVarP(&shutdownGraceful, "graceful", "g", false,
		"Send ESC to agents and wait for them to handoff before killing")
	shutdownCmd.Flags().IntVarP(&shutdownWait, "wait", "w", 30,
		"Seconds to wait for graceful shutdown (default 30)")
	shutdownCmd.Flags().BoolVarP(&shutdownAll, "all", "a", false,
		"Also stop crew sessions (by default, crew is preserved)")
	shutdownCmd.Flags().BoolVarP(&shutdownForce, "force", "f", false,
		"Skip confirmation prompt (alias for --yes)")
	shutdownCmd.Flags().BoolVarP(&shutdownYes, "yes", "y", false,
		"Skip confirmation prompt")
	shutdownCmd.Flags().BoolVar(&shutdownPolecatsOnly, "polecats-only", false,
		"Only stop polecats (minimal shutdown)")
	shutdownCmd.Flags().BoolVar(&shutdownNuclear, "nuclear", false,
		"Force cleanup even if polecats have uncommitted work (DANGER: may lose work)")
	shutdownCmd.Flags().BoolVar(&shutdownCleanupOrphans, "cleanup-orphans", false,
		"Use longer grace period (--cleanup-orphans-grace-secs) for orphan cleanup instead of default 5s")
	shutdownCmd.Flags().IntVar(&shutdownCleanupOrphansGrace, "cleanup-orphans-grace-secs", 60,
		"Grace period in seconds between SIGTERM and SIGKILL when cleaning orphans (default 60)")

	rootCmd.AddCommand(startCmd)
	rootCmd.AddCommand(shutdownCmd)
}

func runStart(cmd *cobra.Command, args []string) error {
	// Check if arg looks like a crew path (rig/crew/name)
	if len(args) == 1 && strings.Contains(args[0], "/crew/") {
		// Parse rig/crew/name format
		parts := strings.SplitN(args[0], "/crew/", 2)
		if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
			// Route to crew start with rig/name format
			crewArg := parts[0] + "/" + parts[1]
			return runStartCrew(cmd, []string{crewArg})
		}
	}

	// Verify we're in a Gas Town workspace
	townRoot, err := workspace.FindFromCwdOrError()
	if err != nil {
		return fmt.Errorf("not in a Gas Town workspace: %w", err)
	}

	// Apply ephemeral cost tier if specified
	if startCostTier != "" {
		if !config.IsValidTier(startCostTier) {
			return fmt.Errorf("invalid cost tier %q (valid: %s)", startCostTier, strings.Join(config.ValidCostTiers(), ", "))
		}
		os.Setenv("GT_COST_TIER", startCostTier)
		fmt.Printf("Using ephemeral cost tier: %s\n", style.Bold.Render(startCostTier))
	}

	if err := config.EnsureDaemonPatrolConfig(townRoot); err != nil {
		fmt.Printf("  %s Could not ensure daemon config: %v\n", style.Dim.Render("○"), err)
	}

	t := tmux.NewTmux()

	// Clean up orphaned tmux sessions before starting new agents.
	// This prevents session name conflicts and resource accumulation from
	// zombie sessions (tmux alive but Claude dead).
	if cleaned, err := t.CleanupOrphanedSessions(session.IsKnownSession); err != nil {
		fmt.Printf("  %s Could not clean orphaned sessions: %v\n", style.Dim.Render("○"), err)
	} else if cleaned > 0 {
		fmt.Printf("  %s Cleaned up %d orphaned session(s)\n", style.Bold.Render("✓"), cleaned)
	}

	fmt.Printf("Starting Gas Town from %s\n\n", style.Dim.Render(townRoot))
	fmt.Println("Starting all agents in parallel...")
	fmt.Println()

	// Discover rigs once upfront to avoid redundant calls from parallel goroutines
	rigs, rigsErr := discoverAllRigs(townRoot)
	if rigsErr != nil {
		fmt.Printf("  %s Could not discover rigs: %v\n", style.Dim.Render("○"), rigsErr)
		// Continue anyway - core agents don't need rigs
	}

	// Start all agent groups in parallel for maximum speed
	var wg sync.WaitGroup
	var mu sync.Mutex // Protects stdout
	var coreErr error
	

	// Dolt server removed in Night City

	// Start core agents (Mayor and Deacon) in background
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := startCoreAgents(townRoot, startAgentOverride, &mu); err != nil {
			mu.Lock()
			coreErr = err
			mu.Unlock()
		}
	}()

	// Start rig agents (witnesses, refineries) if --all
	if startAll && rigs != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			startRigAgents(rigs, &mu)
		}()
	}

	// Start configured crew
	if rigs != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			startConfiguredCrew(t, rigs, townRoot, &mu)
		}()
	}

	wg.Wait()

	// Dolt metadata removed in Night City

	if coreErr != nil {
		return coreErr
	}

	fmt.Println()
	fmt.Printf("%s Gas Town is running\n", style.Bold.Render("✓"))
	fmt.Println()
	fmt.Printf("  Attach to Mayor:  %s\n", style.Dim.Render("gt mayor attach"))
	fmt.Printf("  Attach to Deacon: %s\n", style.Dim.Render("gt deacon attach"))
	fmt.Printf("  Check status:     %s\n", style.Dim.Render("gt status"))

	return nil
}

// startCoreAgents starts Mayor and Deacon sessions in parallel using the Manager pattern.
// The mutex is used to synchronize output with other parallel startup operations.
func startCoreAgents(args ...interface{}) error {
	return nil // agents removed
}

// startRigAgents starts witness and refinery for all rigs in parallel.
// Called when --all flag is passed to gt start.
func startRigAgents(args ...interface{}) error {
	return nil // agents removed
}

// startWitnessForRig starts the witness for a single rig and returns a status message.

// Functions below stubbed for Night City

func startWitnessForRig(r *rig.Rig) string { return "" }
func startRefineryForRig(r *rig.Rig) string { return "" }
func startOrRestartCrewMember(t *tmux.Tmux, r *rig.Rig, crewName, townRoot string) (string, bool) { return "", false }

func discoverAllRigs(townRoot string) ([]*rig.Rig, error) {
	rigsPath := filepath.Join(townRoot, "mayor", "rigs.json")
	rigsConfig, err := config.LoadRigsConfig(rigsPath)
	if err != nil || rigsConfig == nil {
		return nil, err
	}
	g := git.NewGit(townRoot)
	mgr := rig.NewManager(townRoot, rigsConfig, g)
	return mgr.DiscoverRigs()
}

func runShutdown(cmd *cobra.Command, args []string) error { return errNotImplemented("shutdown") }
func runStartCrew(cmd *cobra.Command, args []string) error { return errNotImplemented("start crew") }
func getMayorSessionName() string { return "gt-mayor" }
func getDeaconSessionName() string { return "gt-deacon" }
func cleanupOrphanedClaude(grace int) {}
func verifyNoOrphans() {}
func crewSessionName(rigName, name string) string { return fmt.Sprintf("gt-%s-crew-%s", rigName, name) }
func startConfiguredCrew(t *tmux.Tmux, rigs []*rig.Rig, townRoot string, mu *sync.Mutex) {}
