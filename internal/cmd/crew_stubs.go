package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/rig"
)

// Crew subcommand stubs — TODO: reimplement without beads
func runCrewAdd(cmd *cobra.Command, args []string) error    { return errNotImplemented("crew add") }
func runCrewList(cmd *cobra.Command, args []string) error   { return errNotImplemented("crew list") }
func runCrewAt(cmd *cobra.Command, args []string) error     { return errNotImplemented("crew at") }
func runCrewRemove(cmd *cobra.Command, args []string) error { return errNotImplemented("crew remove") }
func runCrewRefresh(cmd *cobra.Command, args []string) error { return errNotImplemented("crew refresh") }
func runCrewStatus(cmd *cobra.Command, args []string) error  { return errNotImplemented("crew status") }
func runCrewRestart(cmd *cobra.Command, args []string) error { return errNotImplemented("crew restart") }
func runCrewRename(cmd *cobra.Command, args []string) error  { return errNotImplemented("crew rename") }
func runCrewPristine(cmd *cobra.Command, args []string) error { return errNotImplemented("crew pristine") }
func runCrewPrev(cmd *cobra.Command, args []string) error    { return errNotImplemented("crew prev") }
func runCrewStart(cmd *cobra.Command, args []string) error   { return errNotImplemented("crew start") }
func runCrewStop(cmd *cobra.Command, args []string) error    { return errNotImplemented("crew stop") }

func runCrewNext(cmd *cobra.Command, args []string) error {
	return errNotImplemented("crew next")
}

// promptYesNo is a stub for the removed interactive prompt.
func promptYesNo(prompt string) error {
	return nil // auto-approve in Night City
}

var crewCycleSession string


// Memory stubs — TODO: reimplement with file-based storage
const memoryKeyPrefix = "memory:"

func bdKvListJSON() (map[string]string, error) {
	return map[string]string{}, nil
}

func bdKvGet(key string) (string, error) {
	return "", fmt.Errorf("not implemented in Night City")
}

func bdKvClear(key string) error {
	return fmt.Errorf("not implemented in Night City")
}

func sanitizeKey(key string) string {
	return key
}

// Polecat helper stubs
func findRigPolecatSessions(rigName string) ([]string, error) {
	return nil, nil
}
func parsePolecatSessionName(session string) (string, string, bool) {
	return "", "", false
}

type polecatTarget struct {
	r           *rig.Rig
	rigName     string
	polecatName string
}

func resolvePolecatTargets(args []string, all bool) ([]polecatTarget, error) {
	return nil, errNotImplemented("resolve polecat targets")
}

type SafetyCheckResult struct {
	Blocked bool
	Message string
}

func checkPolecatSafety(r *rig.Rig, name string, force bool) *SafetyCheckResult {
	return &SafetyCheckResult{}
}
func displaySafetyCheckBlocked(result *SafetyCheckResult) {}
func displayDryRunSafetyCheck(result *SafetyCheckResult) {}
func polecatBeadIDForRig(r *rig.Rig, name string) string { return "" }

// getRig finds and returns a rig by name or from cwd.
func getRig(name string) (string, *rig.Rig, error) {
	return "", nil, errNotImplemented("getRig")
}

// detectTownRootFromCwd detects town root from cwd or env.
func detectTownRootFromCwd() string {
	if root := os.Getenv("GT_TOWN_ROOT"); root != "" {
		return root
	}
	if root := os.Getenv("GT_ROOT"); root != "" {
		return root
	}
	return ""
}

// CheckBeadsVersion is a no-op in Night City.
func CheckBeadsVersion() error {
	return nil
}

func discoverRigs(townRoot string) []string {
	return nil
}
func detectSender() string { return "unknown" }
