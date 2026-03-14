// Package launcher implements Layer 2 of the Town Engine:
// persona YAML config → tmux Claude Code session.
//
// It reads persona definitions and starts Claude Code sessions with the
// correct CLAUDE.md, memory directory, tools, and MCP server configuration.
// Uses gotmux for tmux session management.
package launcher

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"os/exec"
	"time"

	"github.com/GianlucaP106/gotmux/gotmux"
	"github.com/FrankAtGHub/night-city/internal/engine"
	"github.com/FrankAtGHub/night-city/internal/engine/provision"
	"gopkg.in/yaml.v3"
)

// Persona is an alias for engine.Persona for convenience.
type Persona = engine.Persona

// MCPServer is an alias for engine.MCPServer for convenience.
type MCPServer = engine.MCPServer

// LoadPersona reads a persona definition from a YAML file.
func LoadPersona(path string) (*Persona, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading persona %s: %w", path, err)
	}
	var p Persona
	if err := yaml.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("parsing persona %s: %w", path, err)
	}
	return &p, nil
}

// LoadAllPersonas loads all persona YAML files from a directory.
func LoadAllPersonas(dir string) ([]*Persona, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var personas []*Persona
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".yaml" {
			continue
		}
		p, err := LoadPersona(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		personas = append(personas, p)
	}
	return personas, nil
}

// Session represents a running agent session.
type Session struct {
	Persona  *Persona
	TmuxName string          // tmux session name
	TmuxSess *gotmux.Session // gotmux session handle
}

// Manager handles launching and managing agent sessions via tmux.
type Manager struct {
	tmux     *gotmux.Tmux
	townName string
	townDir  string // .town directory for writing launch scripts
	sessions map[string]*Session
}

// NewManager creates a launcher manager using the default tmux socket.
func NewManager(townName, townDir string) (*Manager, error) {
	t, err := gotmux.DefaultTmux()
	if err != nil {
		return nil, fmt.Errorf("connecting to tmux: %w", err)
	}
	return &Manager{
		tmux:     t,
		townName: townName,
		townDir:  townDir,
		sessions: make(map[string]*Session),
	}, nil
}

// sessionName returns the tmux session name for a persona.
func (m *Manager) sessionName(persona string) string {
	return fmt.Sprintf("%s-%s", m.townName, persona)
}

// Launch starts a Claude Code session for the given persona.
func (m *Manager) Launch(p *Persona) (*Session, error) {
	name := m.sessionName(p.Name)

	// Check if session already exists
	existing, err := m.tmux.ListSessions()
	if err == nil {
		for _, s := range existing {
			if s.Name == name {
				return nil, fmt.Errorf("session %q already running", name)
			}
		}
	}

	// Provision agent directory (CLAUDE.md, hooks, memory)
	agentDir, err := provision.Provision(m.townDir, m.townName, p)
	if err != nil {
		return nil, fmt.Errorf("provisioning %s: %w", p.Name, err)
	}

	// Update persona with provisioned paths
	if p.ClaudeMD == "" {
		p.ClaudeMD = agentDir.ClaudeMD
	}
	if p.MemoryDir == "" {
		p.MemoryDir = agentDir.MemoryDir
	}

	// Write a launch script (avoids shell quoting issues with gotmux)
	scriptPath, err := m.writeLaunchScript(p)
	if err != nil {
		return nil, fmt.Errorf("writing launch script: %w", err)
	}

	workDir := p.ProjectDir
	if workDir == "" {
		cwd, _ := os.Getwd()
		workDir = cwd
	}

	// Create tmux session using raw tmux command.
	// gotmux's NewSession single-quotes the ShellCommand which breaks our script.
	// Raw tmux new-session works reliably.
	createCmd := exec.Command("tmux", "new-session", "-d",
		"-s", name,
		"-c", workDir,
		"bash", scriptPath)
	if err := createCmd.Run(); err != nil {
		return nil, fmt.Errorf("creating tmux session for %s: %w", p.Name, err)
	}

	session := &Session{
		Persona:  p,
		TmuxName: name,
	}
	m.sessions[p.Name] = session

	// Handle the workspace trust prompt automatically.
	// Claude Code shows a trust dialog on first run in a directory.
	// We press Enter after a short delay to confirm trust.
	go func() {
		time.Sleep(3 * time.Second)
		exec.Command("tmux", "send-keys", "-t", name, "Enter").Run()
	}()

	return session, nil
}

// writeLaunchScript creates a bash script that sets env vars and launches claude.
func (m *Manager) writeLaunchScript(p *Persona) (string, error) {
	scriptsDir := filepath.Join(m.townDir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0755); err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString("#!/usr/bin/env bash\n")
	sb.WriteString("# Auto-generated launch script for persona: " + p.Name + "\n\n")

	// Environment variables (persona env can override defaults)
	envMap := map[string]string{
		"GT_ROLE": p.Name,
		"GT_TOWN": m.townName,
	}
	if p.MemoryDir != "" {
		envMap["GT_MEMORY_DIR"] = p.MemoryDir
	}
	for k, v := range p.Env {
		envMap[k] = v
	}
	for k, v := range envMap {
		sb.WriteString(fmt.Sprintf("export %s=%q\n", k, v))
	}
	sb.WriteString("\n")

	// Build claude command
	sb.WriteString("exec claude")
	if p.AllowPerms {
		sb.WriteString(" --dangerously-skip-permissions")
	}
	if p.Model != "" {
		sb.WriteString(fmt.Sprintf(" --model %q", p.Model))
	}

	// Inject persona CLAUDE.md as system prompt
	if p.ClaudeMD != "" {
		sb.WriteString(fmt.Sprintf(" --append-system-prompt-file %q", p.ClaudeMD))
	}

	// Load provisioned settings (hooks for WAL, heartbeat, etc.)
	agentSettingsPath := filepath.Join(m.townDir, "agents", p.Name, ".claude", "settings.json")
	if _, err := os.Stat(agentSettingsPath); err == nil {
		sb.WriteString(fmt.Sprintf(" --settings %q", agentSettingsPath))
	}

	sb.WriteString("\n")

	scriptPath := filepath.Join(scriptsDir, p.Name+".sh")
	if err := os.WriteFile(scriptPath, []byte(sb.String()), 0755); err != nil {
		return "", err
	}

	return scriptPath, nil
}

// Stop kills a running agent session.
func (m *Manager) Stop(persona string) error {
	name := m.sessionName(persona)
	killCmd := exec.Command("tmux", "kill-session", "-t", name)
	if err := killCmd.Run(); err != nil {
		return fmt.Errorf("no session %q to stop", name)
	}
	delete(m.sessions, persona)
	return nil
}

// List returns all active sessions.
func (m *Manager) List() []*Session {
	result := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		result = append(result, s)
	}
	return result
}

// IsRunning checks if a persona's session is still alive.
func (m *Manager) IsRunning(persona string) bool {
	name := m.sessionName(persona)
	checkCmd := exec.Command("tmux", "has-session", "-t", name)
	return checkCmd.Run() == nil
}

// DiscoverSessions scans tmux for existing town sessions and populates the sessions map.
func (m *Manager) DiscoverSessions() {
	prefix := m.townName + "-"
	listCmd := exec.Command("tmux", "list-sessions", "-F", "#{session_name}")
	out, err := listCmd.Output()
	if err != nil {
		return
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if strings.HasPrefix(line, prefix) {
			personaName := strings.TrimPrefix(line, prefix)
			if _, ok := m.sessions[personaName]; !ok {
				m.sessions[personaName] = &Session{
					TmuxName: line,
					Persona:  &Persona{Name: personaName},
				}
			}
		}
	}
}
