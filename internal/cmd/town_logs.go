package cmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/engine/accountability"
	"github.com/FrankAtGHub/night-city/internal/style"
)

// --- town logs ---

var townLogsAgent string
var townLogsDate string
var townLogsJSON bool

var townLogsCmd = &cobra.Command{
	Use:   "logs [agent]",
	Short: "View agent work logs",
	Long: `View append-only work logs from the accountability system.

Shows timestamped entries of commits, reviews, decisions, errors, and deploys.
Defaults to today's logs for all agents.`,
	RunE: runTownLogs,
}

func init() {
	townLogsCmd.Flags().StringVar(&townLogsDate, "date", "", "Date to show (YYYY-MM-DD, defaults to today)")
	townLogsCmd.Flags().BoolVar(&townLogsJSON, "json", false, "Output as JSON")
	townCmd.AddCommand(townLogsCmd)
}

func runTownLogs(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	date := townLogsDate
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	agent := ""
	if len(args) > 0 {
		agent = args[0]
	}

	logDir := filepath.Join(townDir, "accountability", "work-log")
	entries, err := os.ReadDir(logDir)
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Println("No work logs yet.")
			return nil
		}
		return err
	}

	var allEntries []accountability.WorkLogEntry

	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, "-"+date+".jsonl") {
			continue
		}
		if agent != "" && !strings.HasPrefix(name, agent+"-") {
			continue
		}

		f, err := os.Open(filepath.Join(logDir, name))
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			var entry accountability.WorkLogEntry
			if err := json.Unmarshal(scanner.Bytes(), &entry); err == nil {
				allEntries = append(allEntries, entry)
			}
		}
		f.Close()
	}

	if len(allEntries) == 0 {
		if agent != "" {
			fmt.Printf("No logs for %s on %s\n", agent, date)
		} else {
			fmt.Printf("No logs for %s\n", date)
		}
		return nil
	}

	// Sort by timestamp
	sort.Slice(allEntries, func(i, j int) bool {
		return allEntries[i].Timestamp.Before(allEntries[j].Timestamp)
	})

	if townLogsJSON {
		data, _ := json.MarshalIndent(allEntries, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	fmt.Printf("%s Work Log — %s\n\n", style.Bold.Render("📋"), date)
	for _, entry := range allEntries {
		ts := entry.Timestamp.Format("15:04:05")
		fmt.Printf("  %s  %-12s  %-8s  %s\n",
			style.Dim.Render(ts),
			style.Bold.Render(entry.Agent),
			entry.Action,
			entry.Detail,
		)
	}
	fmt.Printf("\n%d entries\n", len(allEntries))
	return nil
}

// --- town heartbeat (for agents to self-report) ---

var townHeartbeatState string
var townHeartbeatTask string
var townHeartbeatProgress int

var townHeartbeatCmd = &cobra.Command{
	Use:   "heartbeat",
	Short: "Update agent heartbeat (called by agents)",
	Long: `Write a heartbeat to the accountability store.

Called by agents to report their state. Usually invoked automatically
via hooks or cron, not manually.

States: working, idle, stuck, exiting`,
	RunE: runTownHeartbeat,
}

func init() {
	townHeartbeatCmd.Flags().StringVar(&townHeartbeatState, "state", "working", "Agent state (working, idle, stuck, exiting)")
	townHeartbeatCmd.Flags().StringVar(&townHeartbeatTask, "task", "", "Current task description")
	townHeartbeatCmd.Flags().IntVar(&townHeartbeatProgress, "progress", 0, "Progress percentage (0-100)")
	townCmd.AddCommand(townHeartbeatCmd)
}

func runTownHeartbeat(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	agentName := os.Getenv("GT_ROLE")
	if agentName == "" {
		return fmt.Errorf("GT_ROLE not set (heartbeat must be called from an agent session)")
	}

	store, err := accountability.NewStore(filepath.Join(townDir, "accountability"))
	if err != nil {
		return err
	}

	hb := accountability.Heartbeat{
		Agent:    agentName,
		State:    townHeartbeatState,
		Task:     townHeartbeatTask,
		Progress: townHeartbeatProgress,
	}

	if err := store.WriteHeartbeat(hb); err != nil {
		return fmt.Errorf("writing heartbeat: %w", err)
	}

	fmt.Printf("heartbeat: %s state=%s\n", agentName, townHeartbeatState)
	return nil
}

// --- town log (append a work log entry) ---

var townLogAction string

var townLogCmd = &cobra.Command{
	Use:   "log <detail>",
	Short: "Append a work log entry (called by agents)",
	Long: `Append an entry to the agent's daily work log.

Actions: commit, review, decision, error, deploy, alert, report`,
	Args: cobra.MinimumNArgs(1),
	RunE: runTownLog,
}

func init() {
	townLogCmd.Flags().StringVar(&townLogAction, "action", "decision", "Action type (commit, review, decision, error, deploy)")
	townCmd.AddCommand(townLogCmd)
}

func runTownLog(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	agentName := os.Getenv("GT_ROLE")
	if agentName == "" {
		agentName = "human"
	}

	store, err := accountability.NewStore(filepath.Join(townDir, "accountability"))
	if err != nil {
		return err
	}

	entry := accountability.WorkLogEntry{
		Agent:  agentName,
		Action: townLogAction,
		Detail: strings.Join(args, " "),
	}

	if err := store.AppendWorkLog(entry); err != nil {
		return fmt.Errorf("appending log: %w", err)
	}

	fmt.Printf("logged: [%s] %s — %s\n", agentName, townLogAction, entry.Detail)
	return nil
}
