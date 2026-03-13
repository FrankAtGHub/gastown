package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/style"
)

var memoryFileContext string

func init() {
	memoryLogCmd.Flags().StringVarP(&memoryFileContext, "file", "f", "", "File context for the log entry")
	memoryCmd.AddCommand(memoryLogCmd)
	memoryCmd.AddCommand(memorySearchCmd)
	memoryCmd.AddCommand(memoryStatusCmd)
	memoryCmd.AddCommand(memoryReadCmd)
	memoryCmd.AddCommand(memoryConsolidateCmd)
	memoryCmd.AddCommand(memoryForgetCmd)
	memoryCmd.GroupID = GroupWork
	rootCmd.AddCommand(memoryCmd)
}

var memoryCmd = &cobra.Command{
	Use:   "memory",
	Short: "Agent memory management",
	Long: `Manage agent memory: daily logs, curated memory, and search.

Daily logs capture raw events during sessions. Curated memory (MEMORY.md)
distills patterns and decisions worth keeping long-term.

Subcommands:
  log           Append to today's daily log
  search        Search across all memory files
  status        Show memory statistics
  read          Read a daily log
  consolidate   Review dailies and suggest MEMORY.md updates
  forget        Remove a gt remember KV entry`,
	RunE: requireSubcommand,
}

var memoryLogCmd = &cobra.Command{
	Use:   `log "message"`,
	Short: "Append to today's daily log",
	Long: `Append a timestamped entry to today's daily log file.

The log is stored in .agent/memory/daily/YYYY-MM-DD.md.

Examples:
  gt memory log "Fixed auth timeout by increasing JWT expiry"
  gt memory log -f src/auth/handler.go "Refactored token validation"
  gt memory log "Session started"`,
	Args: cobra.ExactArgs(1),
	RunE: runMemoryLog,
}

var memorySearchCmd = &cobra.Command{
	Use:   `search "term"`,
	Short: "Search across all memory files",
	Long: `Search for a term across MEMORY.md and daily log files.

Uses simple substring matching. Returns matches with file paths and line numbers.

Examples:
  gt memory search "auth timeout"
  gt memory search "deploy"`,
	Args: cobra.ExactArgs(1),
	RunE: runMemorySearch,
}

var memoryStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show memory statistics",
	RunE:  runMemoryStatus,
}

var memoryReadCmd = &cobra.Command{
	Use:   "read [date]",
	Short: "Read a daily log (default: today)",
	Long: `Read a daily log file. Defaults to today's date.

Examples:
  gt memory read              # Today's log
  gt memory read 2026-03-09   # Specific date`,
	Args: cobra.MaximumNArgs(1),
	RunE: runMemoryRead,
}

var memoryConsolidateCmd = &cobra.Command{
	Use:   "consolidate",
	Short: "Review recent dailies for MEMORY.md updates",
	Long: `Review the last 7 days of daily logs and identify entries worth
distilling into MEMORY.md.

This outputs a summary of significant events, decisions, and patterns
from recent daily logs. The agent decides what to promote to MEMORY.md.

Use --prune to also delete daily logs older than 30 days.`,
	RunE: runMemoryConsolidate,
}

var memoryConsolidatePrune bool

var memoryForgetCmd = &cobra.Command{
	Use:   "forget <key>",
	Short: "Remove a gt remember KV entry",
	Long: `Remove a persistent memory stored with gt remember.

Examples:
  gt memory forget refinery-worktree`,
	Args: cobra.ExactArgs(1),
	RunE: runMemoryForget,
}

func init() {
	memoryConsolidateCmd.Flags().BoolVar(&memoryConsolidatePrune, "prune", false, "Delete daily logs older than 30 days")
}

// agentMemoryDir returns the path to .agent/memory/daily/ for the current workspace.
func agentMemoryDir(cwd string) string {
	return filepath.Join(cwd, agentDir, "memory", "daily")
}

// todayLogPath returns the path to today's daily log file.
func todayLogPath(cwd string) string {
	date := time.Now().Format("2006-01-02")
	return filepath.Join(agentMemoryDir(cwd), date+".md")
}

func runMemoryLog(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}

	message := args[0]
	if strings.TrimSpace(message) == "" {
		return fmt.Errorf("message cannot be empty")
	}

	dailyDir := agentMemoryDir(cwd)
	if err := os.MkdirAll(dailyDir, 0755); err != nil {
		return fmt.Errorf("creating daily log dir: %w", err)
	}

	logPath := todayLogPath(cwd)
	now := time.Now().Format("15:04")

	var entry strings.Builder
	// If file doesn't exist, add a date header
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		date := time.Now().Format("2006-01-02")
		entry.WriteString(fmt.Sprintf("# %s\n\n", date))
	} else {
		entry.WriteString("\n")
	}

	entry.WriteString(fmt.Sprintf("## %s — %s\n", now, message))
	if memoryFileContext != "" {
		entry.WriteString(fmt.Sprintf("_Context: %s_\n", memoryFileContext))
	}

	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("opening daily log: %w", err)
	}
	defer f.Close()

	if _, err := f.WriteString(entry.String()); err != nil {
		return fmt.Errorf("writing daily log: %w", err)
	}

	fmt.Printf("%s Logged to %s\n", style.Success.Render("✓"), filepath.Base(logPath))
	return nil
}

func runMemorySearch(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}

	term := strings.ToLower(args[0])
	agentPath := filepath.Join(cwd, agentDir)

	// Collect all searchable files
	var files []string

	// MEMORY.md
	memoryMd := filepath.Join(agentPath, "MEMORY.md")
	if _, err := os.Stat(memoryMd); err == nil {
		files = append(files, memoryMd)
	}

	// Daily logs
	dailyDir := agentMemoryDir(cwd)
	entries, err := os.ReadDir(dailyDir)
	if err == nil {
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".md") {
				files = append(files, filepath.Join(dailyDir, e.Name()))
			}
		}
	}

	if len(files) == 0 {
		fmt.Println("No memory files found. Run `gt agent init` first.")
		return nil
	}

	matches := 0
	for _, fpath := range files {
		content, err := os.ReadFile(fpath)
		if err != nil {
			continue
		}

		lines := strings.Split(string(content), "\n")
		for i, line := range lines {
			if strings.Contains(strings.ToLower(line), term) {
				relPath, _ := filepath.Rel(cwd, fpath)
				fmt.Printf("%s:%d: %s\n", style.Bold.Render(relPath), i+1, strings.TrimSpace(line))
				matches++
			}
		}
	}

	if matches == 0 {
		fmt.Printf("No matches for %q in memory files.\n", args[0])
	} else {
		fmt.Printf("\n%d match(es) found.\n", matches)
	}
	return nil
}

func runMemoryStatus(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}

	agentPath := filepath.Join(cwd, agentDir)

	fmt.Printf("%s\n\n", style.Bold.Render("Memory Status"))

	// MEMORY.md
	memoryMd := filepath.Join(agentPath, "MEMORY.md")
	if info, err := os.Stat(memoryMd); err == nil {
		content, _ := os.ReadFile(memoryMd)
		lines := strings.Count(string(content), "\n")
		fmt.Printf("  MEMORY.md:     %d lines (modified %s)\n", lines, info.ModTime().Format("2006-01-02"))
	} else {
		fmt.Printf("  MEMORY.md:     %s\n", style.Dim.Render("missing"))
	}

	// Daily logs
	dailyDir := agentMemoryDir(cwd)
	entries, err := os.ReadDir(dailyDir)
	if err == nil && len(entries) > 0 {
		var dates []string
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".md") {
				dates = append(dates, strings.TrimSuffix(e.Name(), ".md"))
			}
		}
		sort.Strings(dates)
		if len(dates) > 0 {
			fmt.Printf("  Daily logs:    %d file(s) (%s → %s)\n", len(dates), dates[0], dates[len(dates)-1])
		}
	} else {
		fmt.Printf("  Daily logs:    %s\n", style.Dim.Render("none"))
	}

	// KV memories
	kvs, err := bdKvListJSON()
	if err == nil {
		count := 0
		for k := range kvs {
			if strings.HasPrefix(k, memoryKeyPrefix) {
				count++
			}
		}
		if count > 0 {
			fmt.Printf("  KV memories:   %d entries (from gt remember)\n", count)
		}
	}

	return nil
}

func runMemoryRead(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}

	date := time.Now().Format("2006-01-02")
	if len(args) == 1 {
		date = args[0]
	}

	logPath := filepath.Join(agentMemoryDir(cwd), date+".md")
	content, err := os.ReadFile(logPath)
	if err != nil {
		return fmt.Errorf("no daily log for %s", date)
	}

	fmt.Print(string(content))
	return nil
}

func runMemoryConsolidate(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}

	dailyDir := agentMemoryDir(cwd)
	entries, err := os.ReadDir(dailyDir)
	if err != nil || len(entries) == 0 {
		fmt.Println("No daily logs to consolidate.")
		return nil
	}

	// Collect recent logs (last 7 days)
	cutoff := time.Now().AddDate(0, 0, -7)
	pruneCutoff := time.Now().AddDate(0, 0, -30)

	fmt.Printf("%s\n\n", style.Bold.Render("Memory Consolidation"))

	recentCount := 0
	pruneCount := 0

	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".md") {
			continue
		}

		dateStr := strings.TrimSuffix(e.Name(), ".md")
		date, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			continue
		}

		if date.After(cutoff) {
			// Recent — show content for review
			content, err := os.ReadFile(filepath.Join(dailyDir, e.Name()))
			if err != nil {
				continue
			}
			fmt.Printf("### %s\n", dateStr)
			// Show just the section headers (## lines) as a summary
			for _, line := range strings.Split(string(content), "\n") {
				if strings.HasPrefix(line, "## ") {
					fmt.Printf("  %s\n", line[3:])
				}
			}
			fmt.Println()
			recentCount++
		}

		if memoryConsolidatePrune && date.Before(pruneCutoff) {
			fpath := filepath.Join(dailyDir, e.Name())
			if err := os.Remove(fpath); err == nil {
				pruneCount++
			}
		}
	}

	fmt.Printf("Reviewed %d recent log(s) (last 7 days).\n", recentCount)
	if pruneCount > 0 {
		fmt.Printf("Pruned %d log(s) older than 30 days.\n", pruneCount)
	}
	fmt.Println()
	fmt.Println("Review the entries above and update .agent/MEMORY.md with anything worth keeping.")
	fmt.Println("Use: gt agent edit MEMORY.md")

	return nil
}

func runMemoryForget(cmd *cobra.Command, args []string) error {
	key := sanitizeKey(args[0])
	fullKey := memoryKeyPrefix + key

	existing, _ := bdKvGet(fullKey)
	if existing == "" {
		return fmt.Errorf("no memory found with key %q", key)
	}

	if err := bdKvClear(fullKey); err != nil {
		return fmt.Errorf("clearing memory: %w", err)
	}

	fmt.Printf("%s Forgot memory: %s\n", style.Success.Render("✓"), style.Bold.Render(key))
	return nil
}
