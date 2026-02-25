package architect

import (
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/steveyegge/gastown/internal/beads"
	"github.com/steveyegge/gastown/internal/config"
	"github.com/steveyegge/gastown/internal/constants"
	"github.com/steveyegge/gastown/internal/rig"
	"github.com/steveyegge/gastown/internal/runtime"
	"github.com/steveyegge/gastown/internal/session"
	"github.com/steveyegge/gastown/internal/tmux"
	"github.com/steveyegge/gastown/internal/workspace"
)

// Common errors
var (
	ErrNotRunning     = errors.New("architect not running")
	ErrAlreadyRunning = errors.New("architect already running")
)

// Manager handles architect lifecycle.
// ZFC-compliant: tmux session is the source of truth for running state.
type Manager struct {
	rig *rig.Rig
}

// NewManager creates a new architect manager for a rig.
func NewManager(r *rig.Rig) *Manager {
	return &Manager{
		rig: r,
	}
}

// IsRunning checks if the architect session is active.
// ZFC: tmux session existence is the source of truth.
func (m *Manager) IsRunning() (bool, error) {
	t := tmux.NewTmux()
	return t.HasSession(m.SessionName())
}

// SessionName returns the tmux session name for this architect.
func (m *Manager) SessionName() string {
	return fmt.Sprintf("gt-%s-architect", m.rig.Name)
}

// Status returns information about the architect session.
// ZFC-compliant: tmux session is the source of truth.
func (m *Manager) Status() (*tmux.SessionInfo, error) {
	t := tmux.NewTmux()
	sessionID := m.SessionName()

	running, err := t.HasSession(sessionID)
	if err != nil {
		return nil, fmt.Errorf("checking session: %w", err)
	}
	if !running {
		return nil, ErrNotRunning
	}

	return t.GetSessionInfo(sessionID)
}

// Start starts the architect session.
// Spawns a Claude agent in a tmux session.
// agentOverride optionally specifies a different agent alias to use.
// envOverrides are KEY=VALUE pairs that override all other env var sources.
// ZFC-compliant: no state file, tmux session is source of truth.
func (m *Manager) Start(agentOverride string, envOverrides []string) error {
	t := tmux.NewTmux()
	sessionID := m.SessionName()

	// Check if session already exists
	running, _ := t.HasSession(sessionID)
	if running {
		// Session exists - check if Claude is actually running (healthy vs zombie)
		if t.IsAgentAlive(sessionID) {
			// Healthy - Claude is running
			return ErrAlreadyRunning
		}
		// Zombie - tmux alive but Claude dead. Kill and recreate.
		if err := t.KillSession(sessionID); err != nil {
			return fmt.Errorf("killing zombie session: %w", err)
		}
	}

	// Ensure agent bead exists for mail routing
	townRoot := m.townRoot()
	if err := m.ensureAgentBead(townRoot); err != nil {
		log.Printf("warning: could not ensure architect agent bead: %v", err)
	}

	// Working directory: rig root (architect operates cross-rig from rig home)
	workDir := m.rig.Path

	// Ensure runtime settings
	runtimeConfig := config.ResolveRoleAgentConfig("architect", townRoot, m.rig.Path)
	architectSettingsDir := config.RoleSettingsDir("architect", m.rig.Path)
	if err := runtime.EnsureSettingsForRole(architectSettingsDir, workDir, "architect", runtimeConfig); err != nil {
		return fmt.Errorf("ensuring runtime settings: %w", err)
	}

	// Ensure .gitignore has required Gas Town patterns
	if err := rig.EnsureGitignorePatterns(workDir); err != nil {
		fmt.Printf("Warning: could not update architect .gitignore: %v\n", err)
	}

	// Build startup command
	initialPrompt := session.BuildStartupPrompt(session.BeaconConfig{
		Recipient: fmt.Sprintf("%s/architect", m.rig.Name),
		Sender:    "mayor",
		Topic:     "review",
	}, "Run `gt prime` and check mail for review requests.")

	var command string
	var err error
	if agentOverride != "" {
		command, err = config.BuildAgentStartupCommandWithAgentOverride("architect", m.rig.Name, townRoot, m.rig.Path, initialPrompt, agentOverride)
		if err != nil {
			return fmt.Errorf("building startup command with agent override: %w", err)
		}
	} else {
		command = config.BuildAgentStartupCommand("architect", m.rig.Name, townRoot, m.rig.Path, initialPrompt)
	}

	// Create session with command directly
	if err := t.NewSessionWithCommand(sessionID, workDir, command); err != nil {
		return fmt.Errorf("creating tmux session: %w", err)
	}

	// Set environment variables (non-fatal)
	envVars := config.AgentEnv(config.AgentEnvConfig{
		Role:     "architect",
		Rig:      m.rig.Name,
		TownRoot: townRoot,
	})
	for k, v := range envVars {
		_ = t.SetEnvironment(sessionID, k, v)
	}

	// Apply CLI env overrides (highest priority, non-fatal)
	for _, override := range envOverrides {
		if key, value, ok := strings.Cut(override, "="); ok {
			_ = t.SetEnvironment(sessionID, key, value)
		}
	}

	// Apply Gas Town theming (non-fatal)
	theme := tmux.AssignTheme(m.rig.Name)
	_ = t.ConfigureGasTownSession(sessionID, theme, m.rig.Name, "architect", "architect")

	// Wait for Claude to start - fatal if Claude fails to launch
	if err := t.WaitForCommand(sessionID, constants.SupportedShells, constants.ClaudeStartTimeout); err != nil {
		_ = t.KillSessionWithProcesses(sessionID)
		return fmt.Errorf("waiting for architect to start: %w", err)
	}

	// Accept bypass permissions warning dialog if it appears
	if err := t.AcceptBypassPermissionsWarning(sessionID); err != nil {
		log.Printf("warning: accepting bypass permissions for %s: %v", sessionID, err)
	}

	// Track PID for defense-in-depth orphan cleanup (non-fatal)
	if err := session.TrackSessionPID(townRoot, sessionID, t); err != nil {
		log.Printf("warning: tracking session PID for %s: %v", sessionID, err)
	}

	time.Sleep(constants.ShutdownNotifyDelay)

	return nil
}

// Stop stops the architect session.
// ZFC-compliant: tmux session is the source of truth.
func (m *Manager) Stop() error {
	t := tmux.NewTmux()
	sessionID := m.SessionName()

	// Check if tmux session exists
	running, _ := t.HasSession(sessionID)
	if !running {
		return ErrNotRunning
	}

	// Kill the tmux session
	return t.KillSession(sessionID)
}

func (m *Manager) townRoot() string {
	townRoot, err := workspace.Find(m.rig.Path)
	if err != nil || townRoot == "" {
		return m.rig.Path
	}
	return townRoot
}

// ensureAgentBead creates the architect agent bead if it doesn't already exist.
// This enables mail routing to the architect address (e.g., copperhead/architect).
func (m *Manager) ensureAgentBead(townRoot string) error {
	prefix := beads.GetPrefixForRig(townRoot, m.rig.Name)
	if prefix == "" {
		prefix = "gt"
	}
	agentID := beads.AgentBeadIDWithPrefix(prefix, m.rig.Name, "architect", "")
	bd := beads.New(townRoot)

	// Check if already exists
	if _, err := bd.Show(agentID); err == nil {
		return nil
	}

	fields := &beads.AgentFields{
		RoleType:   "architect",
		Rig:        m.rig.Name,
		AgentState: "idle",
	}

	_, err := bd.CreateAgentBead(agentID, fmt.Sprintf("Architect for %s - independent quality authority.", m.rig.Name), fields)
	return err
}
