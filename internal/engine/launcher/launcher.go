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

	"github.com/GianlucaP106/gotmux/gotmux"
	"gopkg.in/yaml.v3"
)

// Persona defines an agent's configuration, loaded from a YAML file.
type Persona struct {
	Name       string            `yaml:"name"`        // e.g., "mayor", "architect"
	Role       string            `yaml:"role"`        // human-readable role description
	ClaudeMD   string            `yaml:"claude_md"`   // path to CLAUDE.md
	MemoryDir  string            `yaml:"memory_dir"`  // path to memory directory
	ProjectDir string            `yaml:"project_dir"` // working directory for this agent
	Tools      []string          `yaml:"tools"`       // allowed tools
	MCPServers []MCPServer       `yaml:"mcp_servers"` // MCP servers to connect
	Env        map[string]string `yaml:"env"`         // environment variables
	AutoStart  bool              `yaml:"auto_start"`  // start on `town start`
}

// MCPServer defines an MCP server connection for a persona.
type MCPServer struct {
	Name      string   `yaml:"name"`
	Command   string   `yaml:"command"`   // for stdio transport
	Args      []string `yaml:"args"`
	URL       string   `yaml:"url"`       // for SSE transport
	Transport string   `yaml:"transport"` // "stdio" or "sse"
}

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
	tmux       *gotmux.Tmux
	townName   string
	sessions   map[string]*Session // persona name → session
}

// NewManager creates a launcher manager using the default tmux socket.
func NewManager(townName string) (*Manager, error) {
	t, err := gotmux.DefaultTmux()
	if err != nil {
		return nil, fmt.Errorf("connecting to tmux: %w", err)
	}
	return &Manager{
		tmux:     t,
		townName: townName,
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

	// Build environment for the session
	env := make([]string, 0, len(p.Env)+3)
	env = append(env, fmt.Sprintf("GT_ROLE=%s", p.Name))
	env = append(env, fmt.Sprintf("GT_TOWN=%s", m.townName))
	if p.MemoryDir != "" {
		env = append(env, fmt.Sprintf("GT_MEMORY_DIR=%s", p.MemoryDir))
	}
	for k, v := range p.Env {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}

	// Build the claude command
	claudeArgs := []string{"claude", "--dangerously-skip-permissions"}
	if p.ClaudeMD != "" {
		claudeArgs = append(claudeArgs, "--claude-md", p.ClaudeMD)
	}

	workDir := p.ProjectDir
	if workDir == "" {
		workDir = "."
	}

	// Create tmux session with claude code running in it
	cmd := fmt.Sprintf("cd %s && %s %s", workDir, strings.Join(env, " "), strings.Join(claudeArgs, " "))
	sess, err := m.tmux.NewSession(&gotmux.SessionOptions{
		Name:         name,
		ShellCommand: cmd,
		StartDirectory: workDir,
	})
	if err != nil {
		return nil, fmt.Errorf("creating tmux session for %s: %w", p.Name, err)
	}

	session := &Session{
		Persona:  p,
		TmuxName: name,
		TmuxSess: sess,
	}
	m.sessions[p.Name] = session
	return session, nil
}

// Stop kills a running agent session.
func (m *Manager) Stop(persona string) error {
	sess, ok := m.sessions[persona]
	if !ok {
		return fmt.Errorf("no session for persona %q", persona)
	}
	if err := sess.TmuxSess.Kill(); err != nil {
		return fmt.Errorf("killing session %s: %w", sess.TmuxName, err)
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
	sess, ok := m.sessions[persona]
	if !ok {
		return false
	}
	// Check if tmux session still exists
	sessions, err := m.tmux.ListSessions()
	if err != nil {
		return false
	}
	for _, s := range sessions {
		if s.Name == sess.TmuxName {
			return true
		}
	}
	delete(m.sessions, persona)
	return false
}
