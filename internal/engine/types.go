// Package engine provides shared types for the Town Engine.
package engine

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
	Model      string            `yaml:"model"`       // claude model override
	Prompt     string            `yaml:"prompt"`      // initial prompt to send on startup
	AllowPerms bool              `yaml:"allow_perms"` // skip permission prompts (dangerous)
}

// MCPServer defines an MCP server connection for a persona.
type MCPServer struct {
	Name      string   `yaml:"name"`
	Command   string   `yaml:"command"`   // for stdio transport
	Args      []string `yaml:"args"`
	URL       string   `yaml:"url"`       // for SSE transport
	Transport string   `yaml:"transport"` // "stdio" or "sse"
}
