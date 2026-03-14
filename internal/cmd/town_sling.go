package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

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

	// Set the task as the prompt
	persona.Prompt = task

	// Launch
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

	// Log to work log
	logToWorkLog(persona.ProjectDir, "sling", fmt.Sprintf("Dispatched %s: %s", personaName, task))

	// Write task to agent's SESSION-STATE.md
	sessionStatePath := filepath.Join(townDir, "agents", personaName, "memory", "SESSION-STATE.md")
	sessionState := fmt.Sprintf(`# Session State
**Last Updated:** %s
**Current Task:** %s
**Status:** ACTIVE

## Assignment
%s

## Working Context
- Project: %s
- Dispatched by: mayor
`, cmd.Root().Version, task, task, persona.ProjectDir)
	os.WriteFile(sessionStatePath, []byte(sessionState), 0644)

	return nil
}
