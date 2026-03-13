// Package launcher implements Layer 2 of the Town Engine:
// persona YAML config → tmux Claude Code session.
//
// It reads persona definitions and starts Claude Code sessions with the
// correct CLAUDE.md, memory directory, tools, and MCP server configuration.
package launcher

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Persona defines an agent's configuration, loaded from a YAML file.
type Persona struct {
	Name        string            `yaml:"name"`         // e.g., "mayor", "architect"
	Role        string            `yaml:"role"`         // human-readable role description
	ClaudeMD    string            `yaml:"claude_md"`    // path to CLAUDE.md
	MemoryDir   string            `yaml:"memory_dir"`   // path to memory directory
	ProjectDir  string            `yaml:"project_dir"`  // working directory for this agent
	Tools       []string          `yaml:"tools"`        // allowed tools
	MCPServers  []MCPServer       `yaml:"mcp_servers"`  // MCP servers to connect
	Env         map[string]string `yaml:"env"`          // environment variables
	AutoStart   bool              `yaml:"auto_start"`   // start on `town start`
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
	Persona    *Persona
	TmuxName   string // tmux session name
	PID        int    // process ID of the claude code process
}

// Launch starts a Claude Code session for the given persona.
// This is a stub — will be wired to gotmux for tmux management.
func Launch(p *Persona) (*Session, error) {
	// TODO: Wire to gotmux library for tmux session creation
	// TODO: Set up environment variables from persona config
	// TODO: Start Claude Code with correct CLAUDE.md and memory dir
	return nil, fmt.Errorf("launcher not yet implemented")
}
