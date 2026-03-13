package cmd

import (

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/git"
	"github.com/FrankAtGHub/night-city/internal/polecat"
	"github.com/FrankAtGHub/night-city/internal/rig"
	"github.com/FrankAtGHub/night-city/internal/tmux"
)

// Polecat command flags
var (
	polecatListJSON  bool
	polecatListAll   bool
	polecatForce     bool
	polecatRemoveAll bool
)

var polecatCmd = &cobra.Command{
	Use:     "polecat",
	Aliases: []string{"polecats"},
	GroupID: GroupAgents,
	Short:   "Manage polecats (persistent identity, ephemeral sessions)",
	RunE:    requireSubcommand,
	Long: `Manage polecat lifecycle in rigs.

Polecats have PERSISTENT IDENTITY but EPHEMERAL SESSIONS. Each polecat has
a permanent agent bead and CV chain that accumulates work history across
assignments. Sessions and sandboxes are ephemeral — spawned for specific
tasks, cleaned up on completion — but the identity persists.

A polecat is either:
  - Working: Actively doing assigned work
  - Stalled: Session crashed mid-work (needs Witness intervention)
  - Zombie: Finished but gt done failed (needs cleanup)
  - Nuked: Session ended, identity persists (ready for next assignment)

Self-cleaning model: When work completes, the polecat runs 'gt done',
which pushes the branch, submits to the merge queue, and exits. The
Witness then nukes the sandbox. The polecat's identity (agent bead)
persists with agent_state=nuked, preserving work history.

Session vs sandbox: The Claude session cycles frequently (handoffs,
compaction). The git worktree (sandbox) persists until nuke. Work
survives session restarts.

Cats build features. Dogs clean up messes.`,
}

var polecatListCmd = &cobra.Command{
	Use:   "list [rig]",
	Short: "List polecats in a rig",
	Long: `List polecats in a rig or all rigs.

In the transient model, polecats exist only while working. The list shows
all polecats with their states:
  - working: Actively working on an issue
  - done: Completed work, waiting for cleanup
  - stuck: Needs assistance

Examples:
  gt polecat list greenplace
  gt polecat list --all
  gt polecat list greenplace --json`,
	RunE: runPolecatList,
}

var polecatAddCmd = &cobra.Command{
	Use:        "add <rig> <name>",
	Short:      "Add a new polecat to a rig (DEPRECATED)",
	Deprecated: "use 'gt polecat identity add' instead. This command will be removed in v1.0.",
	Long: `Add a new polecat to a rig.

DEPRECATED: Use 'gt polecat identity add' instead. This command will be removed in v1.0.

Creates a polecat directory, clones the rig repo, creates a work branch,
and initializes state.

Example:
  gt polecat identity add greenplace Toast  # Preferred
  gt polecat add greenplace Toast           # Deprecated`,
	Args: cobra.ExactArgs(2),
	RunE: runPolecatAdd,
}

var polecatRemoveCmd = &cobra.Command{
	Use:   "remove <rig>/<polecat>... | <rig> --all",
	Short: "Remove polecats from a rig",
	Long: `Remove one or more polecats from a rig.

Fails if session is running (stop first).
Warns if uncommitted changes exist.
Use --force to bypass checks.

Examples:
  gt polecat remove greenplace/Toast
  gt polecat remove greenplace/Toast greenplace/Furiosa
  gt polecat remove greenplace --all
  gt polecat remove greenplace --all --force`,
	Args: cobra.MinimumNArgs(1),
	RunE: runPolecatRemove,
}

var polecatStatusCmd = &cobra.Command{
	Use:   "status <rig>/<polecat>",
	Short: "Show detailed status for a polecat",
	Long: `Show detailed status for a polecat.

Displays comprehensive information including:
  - Current lifecycle state (working, done, stuck, idle)
  - Assigned issue (if any)
  - Session status (running/stopped, attached/detached)
  - Session creation time
  - Last activity time

NOTE: The argument is <rig>/<polecat> — a single argument with a slash
separator, NOT two separate arguments. For example: greenplace/Toast

Examples:
  gt polecat status greenplace/Toast
  gt polecat status greenplace/Toast --json`,
	Args: cobra.ExactArgs(1),
	RunE: runPolecatStatus,
}

var (
	polecatStatusJSON        bool
	polecatGitStateJSON      bool
	polecatGCDryRun          bool
	polecatNukeAll           bool
	polecatNukeDryRun        bool
	polecatNukeForce         bool
	polecatCheckRecoveryJSON bool
	polecatPoolInitDryRun    bool
	polecatPoolInitSize      int
)

var polecatGCCmd = &cobra.Command{
	Use:   "gc <rig>",
	Short: "Garbage collect stale polecat branches",
	Long: `Garbage collect stale polecat branches in a rig.

Polecats use unique timestamped branches (polecat/<name>-<timestamp>) to
prevent drift issues. Over time, these branches accumulate when stale
polecats are repaired.

This command removes orphaned branches:
  - Branches for polecats that no longer exist
  - Old timestamped branches (keeps only the current one per polecat)

Examples:
  gt polecat gc greenplace
  gt polecat gc greenplace --dry-run`,
	Args: cobra.ExactArgs(1),
	RunE: runPolecatGC,
}

var polecatNukeCmd = &cobra.Command{
	Use:   "nuke <rig>/<polecat>... | <rig> --all",
	Short: "Completely destroy a polecat (session, worktree, branch, agent bead)",
	Long: `Completely destroy a polecat and all its artifacts.

This is the nuclear option for post-merge cleanup. It:
  1. Kills the Claude session (if running)
  2. Deletes the git worktree (bypassing all safety checks)
  3. Deletes the polecat branch
  4. Closes the agent bead (if exists)

SAFETY CHECKS: The command refuses to nuke a polecat if:
  - Worktree has unpushed/uncommitted changes
  - Polecat has an open merge request (MR bead)
  - Polecat has work on its hook

Use --force to bypass safety checks (LOSES WORK).
Use --dry-run to see what would happen and safety check status.

Examples:
  gt polecat nuke greenplace/Toast
  gt polecat nuke greenplace/Toast greenplace/Furiosa
  gt polecat nuke greenplace --all
  gt polecat nuke greenplace --all --dry-run
  gt polecat nuke greenplace/Toast --force  # bypass safety checks`,
	Args: cobra.MinimumNArgs(1),
	RunE: runPolecatNuke,
}

var polecatGitStateCmd = &cobra.Command{
	Use:   "git-state <rig>/<polecat>",
	Short: "Show git state for pre-kill verification",
	Long: `Show git state for a polecat's worktree.

Used by the Witness for pre-kill verification to ensure no work is lost.
Returns whether the worktree is clean (safe to kill) or dirty (needs cleanup).

Checks:
  - Working tree: uncommitted changes
  - Unpushed commits: commits ahead of origin/main
  - Stashes: stashed changes

Examples:
  gt polecat git-state greenplace/Toast
  gt polecat git-state greenplace/Toast --json`,
	Args: cobra.ExactArgs(1),
	RunE: runPolecatGitState,
}

var polecatCheckRecoveryCmd = &cobra.Command{
	Use:   "check-recovery <rig>/<polecat>",
	Short: "Check if polecat needs recovery vs safe to nuke",
	Long: `Check recovery status of a polecat based on cleanup_status and merge queue state.

Used by the Witness to determine appropriate cleanup action:
  - SAFE_TO_NUKE: cleanup_status is 'clean' AND work submitted to merge queue
  - NEEDS_MQ_SUBMIT: git is clean but work was never submitted to the merge queue
  - NEEDS_RECOVERY: cleanup_status indicates unpushed/uncommitted work

This prevents accidental data loss when cleaning up dormant polecats.
The Witness should escalate NEEDS_RECOVERY and NEEDS_MQ_SUBMIT cases to the Mayor.

Examples:
  gt polecat check-recovery greenplace/Toast
  gt polecat check-recovery greenplace/Toast --json`,
	Args: cobra.ExactArgs(1),
	RunE: runPolecatCheckRecovery,
}

var (
	polecatStaleJSON      bool
	polecatStaleThreshold int
	polecatStaleCleanup   bool
	polecatStaleDryRun    bool
	polecatPruneDryRun    bool
	polecatPruneRemote    bool
)

var polecatStaleCmd = &cobra.Command{
	Use:   "stale <rig>",
	Short: "Detect stale polecats that may need cleanup",
	Long: `Detect stale polecats in a rig that are candidates for cleanup.

A polecat is considered stale if:
  - No active tmux session
  - Way behind main (>threshold commits) OR no agent bead
  - Has no uncommitted work that could be lost

The default threshold is 20 commits behind main.

Use --cleanup to automatically nuke stale polecats that are safe to remove.
Use --dry-run with --cleanup to see what would be cleaned.

Examples:
  gt polecat stale greenplace
  gt polecat stale greenplace --threshold 50
  gt polecat stale greenplace --json
  gt polecat stale greenplace --cleanup
  gt polecat stale greenplace --cleanup --dry-run`,
	Args: cobra.ExactArgs(1),
	RunE: runPolecatStale,
}

var polecatPruneCmd = &cobra.Command{
	Use:   "prune <rig>",
	Short: "Prune stale polecat branches (local and remote)",
	Long: `Prune stale polecat branches in a rig.

Finds and deletes polecat branches that are no longer needed:
  - Branches fully merged to main
  - Branches whose remote tracking branch was deleted (post-merge cleanup)
  - Branches for polecats that no longer exist (orphaned)

Uses safe deletion (git branch -d) — only removes fully merged branches.
Also cleans up remote polecat branches that are fully merged.

Use --dry-run to preview what would be pruned.
Use --remote to also prune remote polecat branches on origin.

Examples:
  gt polecat prune greenplace
  gt polecat prune greenplace --dry-run
  gt polecat prune greenplace --remote`,
	Args: cobra.ExactArgs(1),
	RunE: runPolecatPrune,
}

var polecatPoolInitCmd = &cobra.Command{
	Use:   "pool-init <rig>",
	Short: "Initialize a persistent polecat pool for a rig",
	Long: `Initialize a persistent polecat pool for a rig.

Creates N polecats with identities and worktrees in IDLE state,
ready for immediate work assignment via gt sling.

Pool size is determined by (in priority order):
  1. --size flag
  2. polecat_pool_size in rig config.json
  3. Default: 4

Polecat names come from:
  1. polecat_names in rig config.json (if specified)
  2. The rig's name pool theme (default: mad-max)

Existing polecats are preserved — only new ones are created
to reach the target pool size.

Examples:
  gt polecat pool-init gastown
  gt polecat pool-init gastown --size 6
  gt polecat pool-init gastown --dry-run`,
	Args: cobra.ExactArgs(1),
	RunE: runPolecatPoolInit,
}

func init() {
	// List flags
	polecatListCmd.Flags().BoolVar(&polecatListJSON, "json", false, "Output as JSON")
	polecatListCmd.Flags().BoolVar(&polecatListAll, "all", false, "List polecats in all rigs")

	// Remove flags
	polecatRemoveCmd.Flags().BoolVarP(&polecatForce, "force", "f", false, "Force removal, bypassing checks")
	polecatRemoveCmd.Flags().BoolVar(&polecatRemoveAll, "all", false, "Remove all polecats in the rig")

	// Status flags
	polecatStatusCmd.Flags().BoolVar(&polecatStatusJSON, "json", false, "Output as JSON")

	// Git-state flags
	polecatGitStateCmd.Flags().BoolVar(&polecatGitStateJSON, "json", false, "Output as JSON")

	// GC flags
	polecatGCCmd.Flags().BoolVar(&polecatGCDryRun, "dry-run", false, "Show what would be deleted without deleting")

	// Nuke flags
	polecatNukeCmd.Flags().BoolVar(&polecatNukeAll, "all", false, "Nuke all polecats in the rig")
	polecatNukeCmd.Flags().BoolVar(&polecatNukeDryRun, "dry-run", false, "Show what would be nuked without doing it")
	polecatNukeCmd.Flags().BoolVarP(&polecatNukeForce, "force", "f", false, "Force nuke, bypassing all safety checks (LOSES WORK)")

	// Check-recovery flags
	polecatCheckRecoveryCmd.Flags().BoolVar(&polecatCheckRecoveryJSON, "json", false, "Output as JSON")

	// Stale flags
	polecatStaleCmd.Flags().BoolVar(&polecatStaleJSON, "json", false, "Output as JSON")
	polecatStaleCmd.Flags().IntVar(&polecatStaleThreshold, "threshold", 20, "Commits behind main to consider stale")
	polecatStaleCmd.Flags().BoolVar(&polecatStaleCleanup, "cleanup", false, "Automatically nuke stale polecats")
	polecatStaleCmd.Flags().BoolVar(&polecatStaleDryRun, "dry-run", false, "Show what would be cleaned without doing it")

	// Prune flags
	polecatPruneCmd.Flags().BoolVar(&polecatPruneDryRun, "dry-run", false, "Show what would be pruned without doing it")
	polecatPruneCmd.Flags().BoolVar(&polecatPruneRemote, "remote", false, "Also prune remote polecat branches on origin")

	// Pool-init flags
	polecatPoolInitCmd.Flags().BoolVar(&polecatPoolInitDryRun, "dry-run", false, "Show what would be created without doing it")
	polecatPoolInitCmd.Flags().IntVar(&polecatPoolInitSize, "size", 0, "Pool size (overrides rig config)")

	// Add subcommands
	polecatCmd.AddCommand(polecatListCmd)
	polecatCmd.AddCommand(polecatAddCmd)
	polecatCmd.AddCommand(polecatRemoveCmd)
	polecatCmd.AddCommand(polecatStatusCmd)
	polecatCmd.AddCommand(polecatGitStateCmd)
	polecatCmd.AddCommand(polecatCheckRecoveryCmd)
	polecatCmd.AddCommand(polecatGCCmd)
	polecatCmd.AddCommand(polecatNukeCmd)
	polecatCmd.AddCommand(polecatStaleCmd)
	polecatCmd.AddCommand(polecatPruneCmd)
	polecatCmd.AddCommand(polecatPoolInitCmd)

	rootCmd.AddCommand(polecatCmd)
}

// PolecatListItem represents a polecat in list output.
type PolecatListItem struct {
	Rig            string        `json:"rig"`
	Name           string        `json:"name"`
	State          polecat.State `json:"state"`
	Issue          string        `json:"issue,omitempty"`
	SessionRunning bool          `json:"session_running"`
	Zombie         bool          `json:"zombie,omitempty"`
	SessionName    string        `json:"session_name,omitempty"`
}

// effectivePolecatState returns the observable state used by polecat list output.
// Session liveness is ground truth for working/done transitions. Zombie entries
// are never auto-rewritten.
func effectivePolecatState(item PolecatListItem) polecat.State {
	state := item.State
	if item.SessionRunning && state == polecat.StateDone {
		return polecat.StateWorking
	}
	if !item.SessionRunning && !item.Zombie && state == polecat.StateWorking {
		return polecat.StateDone
	}
	return state
}

// getPolecatManager creates a polecat manager for the given rig.
func getPolecatManager(rigName string) (*polecat.Manager, *rig.Rig, error) {
	_, r, err := getRig(rigName)
	if err != nil {
		return nil, nil, err
	}

	polecatGit := git.NewGit(r.Path)
	t := tmux.NewTmux()
	mgr := polecat.NewManager(r, polecatGit, t)

	return mgr, r, nil
}


// Run functions stubbed for Night City — TODO: reimplement
func runPolecatList(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat list") }
func runPolecatAdd(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat add") }
func runPolecatRemove(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat remove") }
func runPolecatStatus(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat status") }
func runPolecatGitState(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat git-state") }
func runPolecatCheckRecovery(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat check-recovery") }
func runPolecatGC(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat gc") }
func runPolecatNuke(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat nuke") }
func runPolecatStale(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat stale") }
func runPolecatPrune(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat prune") }
func runPolecatPoolInit(cmd *cobra.Command, args []string) error { return errNotImplemented("polecat pool-init") }

func getRepoGitForRig(r *rig.Rig) (*git.Git, error) { return nil, errNotImplemented("getRepoGitForRig") }
