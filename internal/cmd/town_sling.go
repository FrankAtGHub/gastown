package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/engine/launcher"
	"github.com/FrankAtGHub/night-city/internal/style"
)

var townSlingCmd = &cobra.Command{
	Use:   "sling <persona> <task-description>",
	Short: "Dispatch work to an agent",
	Long: `Launch an agent with a specific task. The agent runs in non-interactive
mode (-p flag), completes the work, and exits.

The mayor reviews the results, deploys, and pushes.

Example:
  gt town sling copperhead-dev "Implement wave 186: wire checklist templates into work orders"`,
	Args: cobra.MinimumNArgs(2),
	RunE: runTownSling,
}

func init() {
	townCmd.AddCommand(townSlingCmd)
}

func runTownSling(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	cfg, err := loadTownConfig(townDir)
	if err != nil {
		return err
	}

	personaName := args[0]
	task := strings.Join(args[1:], " ")

	// Load persona
	personaPath := filepath.Join(townDir, "personas", personaName+".yaml")
	persona, err := launcher.LoadPersona(personaPath)
	if err != nil {
		return fmt.Errorf("loading persona %q: %w", personaName, err)
	}

	// Write task to agent's SESSION-STATE.md BEFORE launch
	// The SessionStart hook will inject this into context
	sessionStatePath := filepath.Join(townDir, "agents", personaName, "memory", "SESSION-STATE.md")
	sessionState := fmt.Sprintf(`# Session State
**Last Updated:** now
**Current Task:** %s
**Status:** ACTIVE

## Assignment
%s

## Working Context
- Project: %s
- Dispatched by: mayor
- Execute this task immediately. Do not ask for confirmation.
`, task, task, persona.ProjectDir)
	os.WriteFile(sessionStatePath, []byte(sessionState), 0644)

	// Also write the task to a prompt file that the launch script will pipe in
	promptPath := filepath.Join(townDir, "agents", personaName, "prompt.txt")
	os.WriteFile(promptPath, []byte(task+"\n"), 0644)

	// Don't set Prompt on persona — launch interactively
	// The SessionStart hook loads SESSION-STATE.md which has the task

	// Launch in interactive mode
	mgr, err := launcher.NewManager(cfg.Name, townDir)
	if err != nil {
		return err
	}

	sess, err := mgr.Launch(persona)
	if err != nil {
		return err
	}

	fmt.Printf("%s Slung work to %s\n", style.Bold.Render("🚀"), personaName)
	fmt.Printf("   Session: %s\n", sess.TmuxName)
	fmt.Printf("   Project: %s\n", persona.ProjectDir)
	fmt.Printf("   Task:    %s\n", task)
	fmt.Println()
	fmt.Printf("   Attach:  tmux attach -t %s\n", sess.TmuxName)
	fmt.Printf("   Status:  gt town status\n")

	// Wait for claude to start (3s trust prompt + 5s startup), then send the task
	fmt.Printf("   Waiting for agent to start...")
	time.Sleep(8 * time.Second)

	// Send the task as a message
	sendCmd := exec.Command("tmux", "send-keys", "-t", sess.TmuxName,
		task, "Enter")
	if err := sendCmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "\n   Warning: could not send prompt to session: %v\n", err)
		fmt.Fprintf(os.Stderr, "   Attach manually and paste the task.\n")
	} else {
		fmt.Printf(" dispatched.\n")
	}

	// Log to work log
	logToWorkLog(persona.ProjectDir, "sling", fmt.Sprintf("Dispatched %s: %s", personaName, task))

	return nil
}
