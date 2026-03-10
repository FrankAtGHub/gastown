package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/steveyegge/gastown/internal/style"
)

// injectAgentFiles reads and outputs agent identity/memory files during prime.
// Called after role template output and before external tools (bd prime, mail).
// Silently skips if .agent/ directory doesn't exist.
func injectAgentFiles(ctx RoleContext) {
	agentPath := filepath.Join(ctx.WorkDir, agentDir)
	if _, err := os.Stat(agentPath); os.IsNotExist(err) {
		return
	}

	explain(true, "Agent files: .agent/ directory found, injecting identity and memory")

	// Always inject: identity, soul, user context, tools
	injectAgentFile(agentPath, "IDENTITY.md", "Agent Identity")
	injectAgentFile(agentPath, "SOUL.md", "Agent Soul")
	injectAgentFile(agentPath, "USER.md", "User Context")
	injectAgentFile(agentPath, "TOOLS.md", "Agent Tools")

	// Inject daily logs (today + yesterday)
	injectDailyLogs(agentPath)

	// MEMORY.md: only in main sessions (security boundary)
	// Mayor and crew are "main session" agents (direct human interaction).
	// Polecats, witnesses, refineries are autonomous — no curated memory leak.
	if isMainSessionRole(ctx.Role) {
		injectAgentFile(agentPath, "MEMORY.md", "Long-Term Memory")
	}

	// HEARTBEAT.md is NOT injected during prime (loaded on trigger only)
	// AGENTS.md is NOT injected (workspace protocol is in role template)
	// BOOTSTRAP.md is NOT injected (first-run only, handled by agent)
}

// injectAgentFile reads a single agent file and outputs it as a prime section.
func injectAgentFile(agentPath, filename, header string) {
	fpath := filepath.Join(agentPath, filename)
	content, err := os.ReadFile(fpath)
	if err != nil {
		return // Silently skip missing files
	}

	trimmed := strings.TrimSpace(string(content))
	if trimmed == "" {
		return
	}

	fmt.Println()
	fmt.Printf("%s\n\n", style.Bold.Render("# "+header))
	fmt.Println(trimmed)
}

// injectDailyLogs reads today's and yesterday's daily log files and outputs them.
func injectDailyLogs(agentPath string) {
	dailyDir := filepath.Join(agentPath, "memory", "daily")
	if _, err := os.Stat(dailyDir); os.IsNotExist(err) {
		return
	}

	today := time.Now().Format("2006-01-02")
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")

	hasContent := false

	for _, date := range []string{yesterday, today} {
		logPath := filepath.Join(dailyDir, date+".md")
		content, err := os.ReadFile(logPath)
		if err != nil {
			continue
		}

		trimmed := strings.TrimSpace(string(content))
		if trimmed == "" {
			continue
		}

		if !hasContent {
			fmt.Println()
			fmt.Printf("%s\n\n", style.Bold.Render("# Recent Session Logs"))
			hasContent = true
		}

		fmt.Printf("## %s\n\n", date)
		fmt.Println(trimmed)
		fmt.Println()
	}
}

// isMainSessionRole returns true for roles that have direct human interaction.
// These roles get MEMORY.md injected. Autonomous roles (polecats, witnesses,
// refineries) do not, to prevent curated memory from leaking to shared contexts.
func isMainSessionRole(role Role) bool {
	switch role {
	case RoleMayor, RoleCrew, RoleDeacon:
		return true
	default:
		return false
	}
}

// autoLogSessionStart appends a "Session started" entry to today's daily log.
// Called during prime to automatically track session boundaries.
// Non-fatal: errors are silently ignored.
func autoLogSessionStart(ctx RoleContext) {
	agentPath := filepath.Join(ctx.WorkDir, agentDir)
	if _, err := os.Stat(agentPath); os.IsNotExist(err) {
		return
	}

	dailyDir := filepath.Join(agentPath, "memory", "daily")
	if err := os.MkdirAll(dailyDir, 0755); err != nil {
		return
	}

	logPath := filepath.Join(dailyDir, time.Now().Format("2006-01-02")+".md")
	now := time.Now().Format("15:04")

	var entry strings.Builder
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		date := time.Now().Format("2006-01-02")
		entry.WriteString(fmt.Sprintf("# %s\n\n", date))
	} else {
		entry.WriteString("\n")
	}
	entry.WriteString(fmt.Sprintf("## %s — Session started (%s)\n", now, ctx.Role))

	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString(entry.String())
}
