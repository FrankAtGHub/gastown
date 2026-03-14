package launcher

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadPersona(t *testing.T) {
	dir := t.TempDir()
	yamlContent := `name: test-agent
role: Test role
claude_md: /tmp/CLAUDE.md
memory_dir: /tmp/memory
project_dir: /tmp/project
auto_start: true
env:
  GT_ROLE: test-agent
  CUSTOM_VAR: hello
tools:
  - Read
  - Write
mcp_servers:
  - name: test-server
    command: node
    args: ["server.js"]
    transport: stdio
`
	path := filepath.Join(dir, "test-agent.yaml")
	os.WriteFile(path, []byte(yamlContent), 0644)

	p, err := LoadPersona(path)
	if err != nil {
		t.Fatalf("LoadPersona: %v", err)
	}

	if p.Name != "test-agent" {
		t.Errorf("Name = %q, want %q", p.Name, "test-agent")
	}
	if p.Role != "Test role" {
		t.Errorf("Role = %q, want %q", p.Role, "Test role")
	}
	if !p.AutoStart {
		t.Error("AutoStart should be true")
	}
	if p.Env["GT_ROLE"] != "test-agent" {
		t.Errorf("Env[GT_ROLE] = %q, want %q", p.Env["GT_ROLE"], "test-agent")
	}
	if len(p.Tools) != 2 {
		t.Errorf("Tools count = %d, want 2", len(p.Tools))
	}
	if len(p.MCPServers) != 1 {
		t.Errorf("MCPServers count = %d, want 1", len(p.MCPServers))
	}
	if p.MCPServers[0].Transport != "stdio" {
		t.Errorf("MCPServer transport = %q, want %q", p.MCPServers[0].Transport, "stdio")
	}
}

func TestLoadAllPersonas(t *testing.T) {
	dir := t.TempDir()

	for _, name := range []string{"mayor", "architect", "worker"} {
		yaml := "name: " + name + "\nrole: " + name + " role\n"
		os.WriteFile(filepath.Join(dir, name+".yaml"), []byte(yaml), 0644)
	}

	// Also add a non-yaml file that should be ignored
	os.WriteFile(filepath.Join(dir, "README.md"), []byte("ignore me"), 0644)

	personas, err := LoadAllPersonas(dir)
	if err != nil {
		t.Fatalf("LoadAllPersonas: %v", err)
	}

	if len(personas) != 3 {
		t.Errorf("got %d personas, want 3", len(personas))
	}
}

func TestLoadPersonaNotFound(t *testing.T) {
	_, err := LoadPersona("/nonexistent/path.yaml")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestLoadPersonaInvalidYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.yaml")
	os.WriteFile(path, []byte("{{not yaml}}"), 0644)

	_, err := LoadPersona(path)
	if err == nil {
		t.Fatal("expected error for invalid yaml")
	}
}
