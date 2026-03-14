// Package provision generates per-agent configuration files when a persona
// is launched. This includes CLAUDE.md, .claude/settings.json with hooks,
// and memory directory seeding.
//
// This is the glue that turns a persona YAML into a fully configured
// Claude Code session with WAL protocol, heartbeat reporting, and
// crash recovery.
package provision

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/FrankAtGHub/night-city/internal/engine"
)

// AgentDir is the directory structure created for each agent.
// Lives at .town/agents/<persona-name>/
type AgentDir struct {
	Root      string // .town/agents/<name>/
	ClaudeMD  string // .town/agents/<name>/CLAUDE.md
	Settings  string // .town/agents/<name>/.claude/settings.json
	MemoryDir string // .town/agents/<name>/memory/
}

// Provision creates all configuration files for a persona.
// Returns the AgentDir paths for the launcher to use.
func Provision(townDir, townName string, p *engine.Persona) (*AgentDir, error) {
	agentRoot := filepath.Join(townDir, "agents", p.Name)
	dirs := &AgentDir{
		Root:      agentRoot,
		ClaudeMD:  filepath.Join(agentRoot, "CLAUDE.md"),
		Settings:  filepath.Join(agentRoot, ".claude", "settings.json"),
		MemoryDir: filepath.Join(agentRoot, "memory"),
	}

	// Create directory structure
	for _, d := range []string{
		agentRoot,
		filepath.Join(agentRoot, ".claude"),
		dirs.MemoryDir,
	} {
		if err := os.MkdirAll(d, 0755); err != nil {
			return nil, fmt.Errorf("creating %s: %w", d, err)
		}
	}

	// Generate CLAUDE.md
	if err := generateClaudeMD(dirs.ClaudeMD, townName, p); err != nil {
		return nil, fmt.Errorf("generating CLAUDE.md: %w", err)
	}

	// Generate .claude/settings.json with hooks
	if err := generateSettings(dirs.Settings, townDir, p); err != nil {
		return nil, fmt.Errorf("generating settings.json: %w", err)
	}

	// Seed memory directory
	if err := seedMemory(dirs.MemoryDir, p); err != nil {
		return nil, fmt.Errorf("seeding memory: %w", err)
	}

	return dirs, nil
}

func generateClaudeMD(path, townName string, p *engine.Persona) error {
	// Don't overwrite if already customized
	if _, err := os.Stat(path); err == nil {
		return nil
	}

	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("# %s — %s\n\n", p.Name, townName))
	sb.WriteString(fmt.Sprintf("You are **%s**: %s\n\n", p.Name, p.Role))

	// WAL Protocol
	sb.WriteString(`## STEP ZERO — WAL Recovery (before anything else)

**On every cold start, compaction, or new session:**
1. Your SessionStart hook injects SESSION-STATE.md automatically
2. If SESSION-STATE.md has content: **resume from that state**. No announcements. Just pick up where you left off.
3. Only if SESSION-STATE.md is empty: wait for instructions

This is non-negotiable. The WAL is your crash recovery.

## WAL Protocol (Write-Ahead Logging)

You are a stateful operator. Chat history is a BUFFER, not storage.
SESSION-STATE.md is your RAM.

### On EVERY human message, scan for:
- **Corrections** — "It's X, not Y" / "Actually..."
- **Decisions** — "Let's do X" / "Go with Y"
- **Preferences** — Styles, approaches, "I like/don't like"
- **Specific values** — Numbers, dates, IDs, URLs

### If ANY appear:
1. **STOP** — Do not compose your response yet
2. **WRITE** — Update SESSION-STATE.md with the detail
3. **THEN** — Respond to the human

### SESSION-STATE.md format:
`)
	sb.WriteString("```markdown\n")
	sb.WriteString("# Session State\n")
	sb.WriteString("**Last Updated:** [ISO timestamp]\n")
	sb.WriteString("**Current Task:** [what we're working on]\n")
	sb.WriteString("**Status:** ACTIVE | IDLE\n\n")
	sb.WriteString("## Active Decisions\n")
	sb.WriteString("## In-Flight Work\n")
	sb.WriteString("## Working Context\n")
	sb.WriteString("```\n\n")

	// Accountability
	sb.WriteString(`## Accountability

Your heartbeat and work log are updated automatically via hooks.
The town engine monitors your heartbeat. If you miss 2 beats, the
dead man's switch fires and the mayor is alerted.

To manually update your state:
`)
	sb.WriteString("```bash\n")
	sb.WriteString("gt town heartbeat --state working --task \"what you're doing\"\n")
	sb.WriteString("gt town log --action commit \"what you did\"\n")
	sb.WriteString("```\n\n")

	// Role-specific instructions placeholder
	sb.WriteString("## Your Role\n\n")
	sb.WriteString(fmt.Sprintf("**%s**: %s\n\n", p.Name, p.Role))
	sb.WriteString("Update this section as you learn more about your responsibilities.\n")

	return os.WriteFile(path, []byte(sb.String()), 0644)
}

func generateSettings(path, townDir string, p *engine.Persona) error {
	// Don't overwrite existing settings
	if _, err := os.Stat(path); err == nil {
		return nil
	}

	// Build the memory path for WAL injection
	// Use a relative reference that works from the agent's project dir
	agentMemDir := filepath.Join(townDir, "agents", p.Name, "memory")

	settings := map[string]any{
		"hooks": map[string]any{
			"SessionStart": []map[string]any{
				{
					"matcher": "",
					"hooks": []map[string]any{
						{
							"type": "command",
							"command": fmt.Sprintf(
								`MEM=%q && echo '# WAL Recovery' && if [ -f "$MEM/SESSION-STATE.md" ]; then echo '## SESSION-STATE.md' && cat "$MEM/SESSION-STATE.md"; else echo 'No session state — fresh start.'; fi && echo '' && echo 'Resume from SESSION-STATE.md if present. Do NOT ask where we left off.'`,
								agentMemDir,
							),
						},
					},
				},
			},
			"UserPromptSubmit": []map[string]any{
				{
					"matcher": "",
					"hooks": []map[string]any{
						{
							"type": "command",
							"command": fmt.Sprintf(
								`MEM=%q && if [ -f "$MEM/SESSION-STATE.md" ]; then AGE=$(( $(date +%%s) - $(stat -c %%Y "$MEM/SESSION-STATE.md") )); if [ $AGE -gt 300 ]; then echo "WAL STALE ($((AGE / 60))m old). Update SESSION-STATE.md NOW."; fi; fi`,
								agentMemDir,
							),
						},
					},
				},
				{
					"matcher": "",
					"hooks": []map[string]any{
						{
							"type": "command",
							"command": fmt.Sprintf(
								`export PATH="$HOME/go/bin:$PATH" && gt town heartbeat --state working 2>/dev/null || true`,
							),
						},
					},
				},
			},
			"Stop": []map[string]any{
				{
					"matcher": "",
					"hooks": []map[string]any{
						{
							"type": "command",
							"command": fmt.Sprintf(
								`MEM=%q && if [ -f "$MEM/SESSION-STATE.md" ]; then sed -i "s/^\\*\\*Status:.*/\\*\\*Status:\\*\\* CRASHED_OR_STOPPED/" "$MEM/SESSION-STATE.md"; fi && export PATH="$HOME/go/bin:$PATH" && gt town heartbeat --state exiting 2>/dev/null || true`,
								agentMemDir,
							),
						},
					},
				},
			},
		},
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

func seedMemory(memDir string, p *engine.Persona) error {
	// Seed SESSION-STATE.md
	sessionState := filepath.Join(memDir, "SESSION-STATE.md")
	if _, err := os.Stat(sessionState); os.IsNotExist(err) {
		content := fmt.Sprintf(`# Session State
**Last Updated:** (none)
**Current Task:** (awaiting first task)
**Status:** IDLE

## Active Decisions

## In-Flight Work

## Working Context
- Role: %s
- Description: %s
`, p.Name, p.Role)
		os.WriteFile(sessionState, []byte(content), 0644)
	}

	// Seed MEMORY.md index
	memoryIndex := filepath.Join(memDir, "MEMORY.md")
	if _, err := os.Stat(memoryIndex); os.IsNotExist(err) {
		content := fmt.Sprintf("# %s Memory\n\nMemory files will accumulate here as you work.\n", p.Name)
		os.WriteFile(memoryIndex, []byte(content), 0644)
	}

	return nil
}
