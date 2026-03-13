package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/style"
	"github.com/FrankAtGHub/night-city/internal/templates"
	"github.com/FrankAtGHub/night-city/internal/workspace"
)

const agentDir = ".agent"

var agentInitTown bool

func init() {
	agentInitCmd.Flags().BoolVar(&agentInitTown, "town", false, "Create town-level shared agent files")
	agentCmd.AddCommand(agentInitCmd)
	agentCmd.AddCommand(agentFilesCmd)
	agentCmd.AddCommand(agentShowCmd)
	agentCmd.AddCommand(agentResetCmd)
	agentCmd.GroupID = GroupAgents
	rootCmd.AddCommand(agentCmd)
}

var agentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Manage agent identity and memory files",
	Long: `Manage the OpenClaw-style agent file system.

Each agent gets a .agent/ directory with identity, personality, memory,
and configuration files that persist across sessions.

Files:
  IDENTITY.md   — Name, emoji, creature, vibe
  SOUL.md       — Personality and operating principles
  AGENTS.md     — Workspace protocol and memory rules
  USER.md       — Human context (symlinked to town-level)
  TOOLS.md      — Environment-specific notes
  HEARTBEAT.md  — Periodic check checklist
  MEMORY.md     — Curated long-term memory
  BOOTSTRAP.md  — First-run setup (deleted after use)`,
	RunE: requireSubcommand,
}

var agentInitCmd = &cobra.Command{
	Use:   "init",
	Short: "Create agent file scaffold in current workspace",
	Long: `Create the .agent/ directory with identity, memory, and configuration files.

Without --town: creates agent files for the current workspace/role.
With --town: creates town-level shared files (USER.md, SOUL.md, AGENTS.md)
that per-agent workspaces can symlink to.`,
	RunE: runAgentInit,
}

var agentFilesCmd = &cobra.Command{
	Use:   "files",
	Short: "List agent files and their status",
	RunE:  runAgentFiles,
}

var agentShowCmd = &cobra.Command{
	Use:   "show <file>",
	Short: "Display an agent file",
	Long: `Display the contents of an agent file.

Examples:
  gt agent show IDENTITY.md
  gt agent show MEMORY.md
  gt agent show HEARTBEAT.md`,
	Args: cobra.ExactArgs(1),
	RunE: runAgentShow,
}

var agentResetCmd = &cobra.Command{
	Use:   "reset [file]",
	Short: "Reset agent file(s) to template defaults",
	Long: `Reset one or all agent files to their template defaults.

Without arguments: resets ALL files (asks for confirmation).
With a file name: resets just that file.

Examples:
  gt agent reset HEARTBEAT.md
  gt agent reset`,
	Args: cobra.MaximumNArgs(1),
	RunE: runAgentReset,
}

func runAgentInit(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("getting cwd: %w", err)
	}

	townRoot, err := workspace.FindFromCwd()
	if err != nil {
		return fmt.Errorf("finding workspace: %w", err)
	}

	if agentInitTown {
		return runAgentInitTown(townRoot)
	}

	// Detect role
	roleInfo, err := GetRoleWithContext(cwd, townRoot)
	if err != nil {
		return fmt.Errorf("detecting role: %w", err)
	}

	townName, _ := workspace.GetTownName(townRoot)
	data := templates.DefaultAgentFileData(
		string(roleInfo.Role),
		roleInfo.Rig,
		roleInfo.Polecat,
		townRoot,
		townName,
	)

	return provisionAgentFiles(cwd, data, townRoot)
}

func runAgentInitTown(townRoot string) error {
	if townRoot == "" {
		return fmt.Errorf("not in a Gas Town workspace")
	}

	townDir := filepath.Join(townRoot, agentDir)
	if err := os.MkdirAll(townDir, 0755); err != nil {
		return fmt.Errorf("creating town agent dir: %w", err)
	}

	townName, _ := workspace.GetTownName(townRoot)
	data := templates.DefaultAgentFileData("town", "", "", townRoot, townName)

	// Only create shared files at town level
	sharedFiles := []string{"USER.md.tmpl", "SOUL.md.tmpl", "AGENTS.md.tmpl"}
	created := 0
	for _, tmplName := range sharedFiles {
		outName := templates.AgentFileName(tmplName)
		outPath := filepath.Join(townDir, outName)

		if _, err := os.Stat(outPath); err == nil {
			fmt.Printf("  %s %s (exists, skipped)\n", style.Dim.Render("—"), outName)
			continue
		}

		content, err := templates.RenderAgentFile(tmplName, data)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  ✗ %s: %v\n", outName, err)
			continue
		}

		if err := os.WriteFile(outPath, []byte(content), 0644); err != nil {
			fmt.Fprintf(os.Stderr, "  ✗ %s: %v\n", outName, err)
			continue
		}

		fmt.Printf("  %s %s\n", style.Success.Render("✓"), outName)
		created++
	}

	fmt.Printf("\nTown agent files: %s\n", filepath.Join(townRoot, agentDir))
	fmt.Printf("Created %d file(s).\n", created)
	return nil
}

// provisionAgentFiles creates the .agent/ scaffold for a workspace.
// Called by both `gt agent init` and `gt sling` (auto-provisioning).
func provisionAgentFiles(workDir string, data templates.AgentFileData, townRoot string) error {
	agentPath := filepath.Join(workDir, agentDir)
	dailyPath := filepath.Join(agentPath, "memory", "daily")

	if err := os.MkdirAll(dailyPath, 0755); err != nil {
		return fmt.Errorf("creating agent dirs: %w", err)
	}

	created := 0
	skipped := 0

	for _, tmplName := range templates.AgentFileNames() {
		outName := templates.AgentFileName(tmplName)
		outPath := filepath.Join(agentPath, outName)

		// Don't overwrite existing files (respects customization)
		if _, err := os.Stat(outPath); err == nil {
			fmt.Printf("  %s %s (exists, skipped)\n", style.Dim.Render("—"), outName)
			skipped++
			continue
		}

		content, err := templates.RenderAgentFile(tmplName, data)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  ✗ %s: %v\n", outName, err)
			continue
		}

		if err := os.WriteFile(outPath, []byte(content), 0644); err != nil {
			fmt.Fprintf(os.Stderr, "  ✗ %s: %v\n", outName, err)
			continue
		}

		fmt.Printf("  %s %s\n", style.Success.Render("✓"), outName)
		created++
	}

	// Symlink USER.md to town-level if available
	symlinkAgentUserMd(agentPath, townRoot)

	fmt.Printf("\nAgent files: %s\n", agentPath)
	fmt.Printf("Created %d, skipped %d (existing).\n", created, skipped)
	return nil
}

// symlinkAgentUserMd creates a symlink from .agent/USER.md to the town-level USER.md.
func symlinkAgentUserMd(agentPath, townRoot string) {
	if townRoot == "" {
		return
	}
	townUserMd := filepath.Join(townRoot, agentDir, "USER.md")
	if _, err := os.Stat(townUserMd); os.IsNotExist(err) {
		return
	}

	localUserMd := filepath.Join(agentPath, "USER.md")
	// Only replace if the local file is a default template (not customized)
	info, err := os.Lstat(localUserMd)
	if err != nil {
		return
	}
	// If it's already a symlink, skip
	if info.Mode()&os.ModeSymlink != 0 {
		return
	}
	// Read content to check if it's still the default template
	content, err := os.ReadFile(localUserMd)
	if err != nil {
		return
	}
	if strings.Contains(string(content), "**Name:**\n- **What to call them:**") {
		// Still default — replace with symlink
		os.Remove(localUserMd)
		if err := os.Symlink(townUserMd, localUserMd); err == nil {
			fmt.Printf("  %s USER.md → town-level (symlinked)\n", style.Success.Render("→"))
		}
	}
}

func runAgentFiles(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	townRoot, _ := workspace.FindFromCwd()

	roleInfo, err := GetRoleWithContext(cwd, townRoot)
	if err != nil {
		return err
	}

	agentPath := filepath.Join(cwd, agentDir)
	identity := getAgentIdentity(RoleContext{
		Role:     roleInfo.Role,
		Rig:      roleInfo.Rig,
		Polecat:  roleInfo.Polecat,
		TownRoot: townRoot,
		WorkDir:  cwd,
	})

	fmt.Printf("Agent files for %s:\n\n", style.Bold.Render(identity))

	fileNames := []string{
		"IDENTITY.md", "SOUL.md", "AGENTS.md", "USER.md",
		"TOOLS.md", "HEARTBEAT.md", "MEMORY.md", "BOOTSTRAP.md",
	}

	for _, name := range fileNames {
		fpath := filepath.Join(agentPath, name)
		info, err := os.Lstat(fpath)
		if os.IsNotExist(err) {
			if name == "BOOTSTRAP.md" {
				fmt.Printf("  %s %s (completed)\n", style.Dim.Render("—"), name)
			} else {
				fmt.Printf("  %s %s (missing)\n", style.Error.Render("✗"), name)
			}
			continue
		}
		if err != nil {
			fmt.Printf("  %s %s (error: %v)\n", style.Error.Render("✗"), name, err)
			continue
		}

		suffix := ""
		if info.Mode()&os.ModeSymlink != 0 {
			target, _ := os.Readlink(fpath)
			if strings.Contains(target, agentDir) {
				suffix = " (shared → town)"
			} else {
				suffix = fmt.Sprintf(" (→ %s)", target)
			}
		} else if name == "MEMORY.md" {
			content, _ := os.ReadFile(fpath)
			lines := strings.Count(string(content), "\n")
			suffix = fmt.Sprintf(" (%d lines)", lines)
		} else {
			suffix = " (customized)"
		}

		fmt.Printf("  %s %s%s\n", style.Success.Render("✓"), name, suffix)
	}

	// Check daily logs
	dailyDir := filepath.Join(agentPath, "memory", "daily")
	entries, err := os.ReadDir(dailyDir)
	if err == nil && len(entries) > 0 {
		fmt.Printf("\n  Daily logs: %d file(s)\n", len(entries))
	} else {
		fmt.Printf("\n  Daily logs: none\n")
	}

	return nil
}

func runAgentShow(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}

	name := args[0]
	// Normalize: add .md if missing
	if !strings.HasSuffix(name, ".md") {
		name += ".md"
	}
	name = strings.ToUpper(name[:len(name)-3]) + ".md"

	fpath := filepath.Join(cwd, agentDir, name)
	content, err := os.ReadFile(fpath)
	if err != nil {
		return fmt.Errorf("reading %s: %w", name, err)
	}

	fmt.Print(string(content))
	return nil
}

func runAgentReset(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	townRoot, _ := workspace.FindFromCwd()

	roleInfo, err := GetRoleWithContext(cwd, townRoot)
	if err != nil {
		return err
	}

	townName, _ := workspace.GetTownName(townRoot)
	data := templates.DefaultAgentFileData(
		string(roleInfo.Role),
		roleInfo.Rig,
		roleInfo.Polecat,
		townRoot,
		townName,
	)

	agentPath := filepath.Join(cwd, agentDir)

	if len(args) == 1 {
		// Reset single file
		name := args[0]
		if !strings.HasSuffix(name, ".md") {
			name += ".md"
		}
		tmplName := name + ".tmpl"

		content, err := templates.RenderAgentFile(tmplName, data)
		if err != nil {
			return fmt.Errorf("rendering template for %s: %w", name, err)
		}

		outPath := filepath.Join(agentPath, name)
		if err := os.WriteFile(outPath, []byte(content), 0644); err != nil {
			return fmt.Errorf("writing %s: %w", name, err)
		}

		fmt.Printf("%s Reset %s to defaults\n", style.Success.Render("✓"), name)
		return nil
	}

	// Reset all — just re-run init (it skips existing, so we need to remove first)
	fmt.Println("This will reset ALL agent files to template defaults.")
	fmt.Println("Customizations in IDENTITY.md, SOUL.md, TOOLS.md, and MEMORY.md will be lost.")
	fmt.Printf("\nTo reset a single file: %s agent reset <filename>\n", "gt")
	return nil
}

// ProvisionAgentFilesForSling is called by sling when creating a new polecat/crew workspace.
// It provisions the .agent/ directory with role-appropriate defaults.
// Non-fatal: errors are logged but don't block sling.
func ProvisionAgentFilesForSling(workDir, role, rig, polecat, townRoot, townName string) {
	data := templates.DefaultAgentFileData(role, rig, polecat, townRoot, townName)

	agentPath := filepath.Join(workDir, agentDir)
	dailyPath := filepath.Join(agentPath, "memory", "daily")

	if err := os.MkdirAll(dailyPath, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "agent files: failed to create dirs: %v\n", err)
		return
	}

	for _, tmplName := range templates.AgentFileNames() {
		outName := templates.AgentFileName(tmplName)
		outPath := filepath.Join(agentPath, outName)

		// Don't overwrite existing files
		if _, err := os.Stat(outPath); err == nil {
			continue
		}

		content, err := templates.RenderAgentFile(tmplName, data)
		if err != nil {
			continue
		}

		_ = os.WriteFile(outPath, []byte(content), 0644)
	}

	// Symlink USER.md to town-level
	if townRoot != "" {
		townUserMd := filepath.Join(townRoot, agentDir, "USER.md")
		localUserMd := filepath.Join(agentPath, "USER.md")
		if _, err := os.Stat(townUserMd); err == nil {
			os.Remove(localUserMd)
			_ = os.Symlink(townUserMd, localUserMd)
		}
	}
}
