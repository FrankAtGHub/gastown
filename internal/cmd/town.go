package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/engine"
	"github.com/FrankAtGHub/night-city/internal/engine/accountability"
	"github.com/FrankAtGHub/night-city/internal/engine/catalog"
	"github.com/FrankAtGHub/night-city/internal/engine/launcher"
	"github.com/FrankAtGHub/night-city/internal/style"
	"gopkg.in/yaml.v3"
)

// Default data directory for town engine
const defaultTownDir = ".town"

var townCmd = &cobra.Command{
	Use:     "town",
	GroupID: GroupWorkspace,
	Short:   "Town Engine — manage agent personas and infrastructure",
	Long: `The Town Engine manages AI agent personas, accountability,
communication, and orchestration for Night City workspaces.

Use 'town init' to set up a new town, 'town start' to launch agents,
and 'town status' to see what's running.`,
	RunE: requireSubcommand,
}

// --- town init ---

var townInitName string
var townInitProject string

var townInitCmd = &cobra.Command{
	Use:   "init",
	Short: "Initialize a new town",
	Long: `Initialize the current directory as a Night City town.

Creates the town engine directory structure:
  .town/
  ├── engine.yaml          — town configuration
  ├── personas/            — active persona configs
  ├── catalog/             — available persona templates
  ├── accountability/      — heartbeats, work logs, tasks
  └── comms/               — message bus channels and inboxes`,
	RunE: runTownInit,
}

func runTownInit(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}

	townDir := filepath.Join(cwd, defaultTownDir)

	// Check if already initialized
	if _, err := os.Stat(filepath.Join(townDir, "engine.yaml")); err == nil {
		return fmt.Errorf("town already initialized (engine.yaml exists)")
	}

	name := townInitName
	if name == "" {
		name = filepath.Base(cwd)
	}

	projectDir := townInitProject
	if projectDir == "" {
		projectDir = cwd
	}

	hostname, _ := os.Hostname()

	// Create directory structure
	dirs := []string{
		filepath.Join(townDir, "personas"),
		filepath.Join(townDir, "catalog"),
		filepath.Join(townDir, "accountability", "heartbeats"),
		filepath.Join(townDir, "accountability", "work-log"),
		filepath.Join(townDir, "accountability", "tasks"),
		filepath.Join(townDir, "comms", "channels"),
		filepath.Join(townDir, "comms", "inbox"),
	}

	for _, d := range dirs {
		if err := os.MkdirAll(d, 0755); err != nil {
			return fmt.Errorf("creating %s: %w", d, err)
		}
	}

	// Write engine.yaml
	cfg := engine.Config{
		Name:       name,
		HostID:     hostname,
		ProjectDir: projectDir,
		DataDir:    townDir,
	}
	cfgData, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(townDir, "engine.yaml"), cfgData, 0644); err != nil {
		return err
	}

	// Write a default mayor persona
	mayorPersona := launcher.Persona{
		Name:       "mayor",
		Role:       "Global coordinator — oversees all agents and makes strategic decisions",
		ProjectDir: projectDir,
		AutoStart:  true,
		Env:        map[string]string{"GT_ROLE": "mayor"},
	}
	mayorData, err := yaml.Marshal(mayorPersona)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(townDir, "personas", "mayor.yaml"), mayorData, 0644); err != nil {
		return err
	}

	fmt.Printf("%s Town '%s' initialized\n\n", style.Bold.Render("✓"), name)
	fmt.Printf("   Host:    %s\n", hostname)
	fmt.Printf("   Project: %s\n", projectDir)
	fmt.Printf("   Data:    %s\n", townDir)
	fmt.Println()
	fmt.Printf("   Created default persona: mayor\n")
	fmt.Println()
	fmt.Println("Next steps:")
	fmt.Printf("  Add personas:  %s\n", style.Dim.Render("gt town add <name>"))
	fmt.Printf("  Start agents:  %s\n", style.Dim.Render("gt town start"))
	fmt.Printf("  Check status:  %s\n", style.Dim.Render("gt town status"))

	return nil
}

// --- town start ---

var townStartPersona string

var townStartCmd = &cobra.Command{
	Use:   "start [persona]",
	Short: "Launch agent sessions",
	Long: `Start agent sessions for active personas.

Without arguments, starts all personas with auto_start: true.
With a persona name, starts only that persona.`,
	RunE: runTownStart,
}

func runTownStart(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	cfg, err := loadTownConfig(townDir)
	if err != nil {
		return err
	}

	mgr, err := launcher.NewManager(cfg.Name)
	if err != nil {
		return err
	}

	personasDir := filepath.Join(townDir, "personas")
	personas, err := launcher.LoadAllPersonas(personasDir)
	if err != nil {
		return fmt.Errorf("loading personas: %w", err)
	}

	// Filter by specific persona if requested
	target := ""
	if len(args) > 0 {
		target = args[0]
	}

	started := 0
	for _, p := range personas {
		if target != "" && p.Name != target {
			continue
		}
		if target == "" && !p.AutoStart {
			continue
		}

		sess, err := mgr.Launch(p)
		if err != nil {
			fmt.Fprintf(os.Stderr, "   %s %s: %v\n", style.Bold.Render("✗"), p.Name, err)
			continue
		}
		fmt.Printf("   %s %s → %s\n", style.Bold.Render("✓"), p.Name, sess.TmuxName)
		started++
	}

	if started == 0 && target != "" {
		return fmt.Errorf("persona %q not found in %s", target, personasDir)
	}

	fmt.Printf("\n%d agent(s) started\n", started)
	return nil
}

// --- town stop ---

var townStopCmd = &cobra.Command{
	Use:   "stop [persona]",
	Short: "Stop agent sessions",
	Long:  "Stop a specific persona's session, or all sessions if no argument given.",
	RunE: runTownStop,
}

func runTownStop(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	cfg, err := loadTownConfig(townDir)
	if err != nil {
		return err
	}

	mgr, err := launcher.NewManager(cfg.Name)
	if err != nil {
		return err
	}

	if len(args) > 0 {
		if err := mgr.Stop(args[0]); err != nil {
			return err
		}
		fmt.Printf("   %s Stopped %s\n", style.Bold.Render("✓"), args[0])
	} else {
		for _, s := range mgr.List() {
			if err := mgr.Stop(s.Persona.Name); err != nil {
				fmt.Fprintf(os.Stderr, "   %s %s: %v\n", style.Bold.Render("✗"), s.Persona.Name, err)
				continue
			}
			fmt.Printf("   %s Stopped %s\n", style.Bold.Render("✓"), s.Persona.Name)
		}
	}
	return nil
}

// --- town status ---

var townStatusJSON bool

var townStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show town engine status",
	Long:  "Display running agents, heartbeat status, and accountability metrics.",
	RunE:  runTownStatus,
}

func runTownStatus(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	cfg, err := loadTownConfig(townDir)
	if err != nil {
		return err
	}

	// Load personas
	personasDir := filepath.Join(townDir, "personas")
	personas, err := launcher.LoadAllPersonas(personasDir)
	if err != nil {
		return fmt.Errorf("loading personas: %w", err)
	}

	// Load accountability store
	store, err := accountability.NewStore(filepath.Join(townDir, "accountability"))
	if err != nil {
		return fmt.Errorf("opening accountability store: %w", err)
	}

	if townStatusJSON {
		return townStatusAsJSON(cfg, personas, store)
	}

	fmt.Printf("%s %s\n", style.Bold.Render("Town:"), cfg.Name)
	fmt.Printf("Host: %s\n", cfg.HostID)
	fmt.Printf("Data: %s\n\n", cfg.DataDir)

	fmt.Printf("%s\n", style.Bold.Render("Personas:"))
	for _, p := range personas {
		hb, err := store.ReadHeartbeat(p.Name)
		status := style.Dim.Render("no heartbeat")
		if err == nil {
			age := time.Since(hb.Timestamp).Round(time.Second)
			if age < 5*time.Minute {
				status = fmt.Sprintf("%s (%s, %s ago)", hb.State, hb.Task, age)
			} else {
				status = fmt.Sprintf("%s (STALE: %s ago)", hb.State, age)
			}
		}

		autoTag := ""
		if p.AutoStart {
			autoTag = " [auto]"
		}
		fmt.Printf("  %-15s %s%s\n", p.Name, status, style.Dim.Render(autoTag))
	}

	return nil
}

func townStatusAsJSON(cfg *engine.Config, personas []*launcher.Persona, store *accountability.Store) error {
	type personaStatus struct {
		Name      string `json:"name"`
		Role      string `json:"role"`
		AutoStart bool   `json:"auto_start"`
		Heartbeat *accountability.Heartbeat `json:"heartbeat,omitempty"`
	}

	type statusOutput struct {
		Town     string           `json:"town"`
		Host     string           `json:"host"`
		DataDir  string           `json:"data_dir"`
		Personas []personaStatus  `json:"personas"`
	}

	out := statusOutput{
		Town:    cfg.Name,
		Host:    cfg.HostID,
		DataDir: cfg.DataDir,
	}

	for _, p := range personas {
		ps := personaStatus{
			Name:      p.Name,
			Role:      p.Role,
			AutoStart: p.AutoStart,
		}
		if hb, err := store.ReadHeartbeat(p.Name); err == nil {
			ps.Heartbeat = hb
		}
		out.Personas = append(out.Personas, ps)
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(data))
	return nil
}

// --- town add ---

var townAddCmd = &cobra.Command{
	Use:   "add <name>",
	Short: "Add a persona from the catalog",
	Long: `Add a persona template to this town.

Copies a persona from the catalog to the active personas directory.
Use 'gt town catalog' to see available templates.`,
	Args: cobra.ExactArgs(1),
	RunE: runTownAdd,
}

func runTownAdd(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	name := args[0]
	catalogDir := filepath.Join(townDir, "catalog")
	cat := catalog.New(catalogDir)
	if err := cat.Load(); err != nil {
		return fmt.Errorf("loading catalog: %w", err)
	}

	tmpl, err := cat.Find(name)
	if err != nil {
		// List available templates as help
		templates := cat.List()
		if len(templates) == 0 {
			return fmt.Errorf("no templates in catalog (%s). Add YAML files to populate it", catalogDir)
		}
		var names []string
		for _, t := range templates {
			names = append(names, t.Name)
		}
		return fmt.Errorf("template %q not found. Available: %s", name, strings.Join(names, ", "))
	}

	// Write persona to active directory
	personaData, err := yaml.Marshal(tmpl.Persona)
	if err != nil {
		return err
	}

	dest := filepath.Join(townDir, "personas", name+".yaml")
	if _, err := os.Stat(dest); err == nil {
		return fmt.Errorf("persona %q already exists", name)
	}

	if err := os.WriteFile(dest, personaData, 0644); err != nil {
		return err
	}

	fmt.Printf("%s Added persona '%s' (%s)\n", style.Bold.Render("✓"), name, tmpl.Description)
	return nil
}

// --- town catalog ---

var townCatalogCmd = &cobra.Command{
	Use:   "catalog",
	Short: "List available persona templates",
	RunE:  runTownCatalog,
}

func runTownCatalog(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	cat := catalog.New(filepath.Join(townDir, "catalog"))
	if err := cat.Load(); err != nil {
		return err
	}

	templates := cat.List()
	if len(templates) == 0 {
		fmt.Println("No templates in catalog. Add YAML files to .town/catalog/")
		return nil
	}

	fmt.Printf("%s\n", style.Bold.Render("Available Persona Templates:"))
	for _, t := range templates {
		cat := ""
		if t.Category != "" {
			cat = fmt.Sprintf(" [%s]", t.Category)
		}
		fmt.Printf("  %-20s %s%s\n", t.Name, t.Description, style.Dim.Render(cat))
	}
	return nil
}

// --- registration ---

func init() {
	// town init flags
	townInitCmd.Flags().StringVar(&townInitName, "name", "", "Town name (defaults to directory name)")
	townInitCmd.Flags().StringVar(&townInitProject, "project", "", "Project directory (defaults to cwd)")

	// town status flags
	townStatusCmd.Flags().BoolVar(&townStatusJSON, "json", false, "Output as JSON")

	// Add subcommands
	townCmd.AddCommand(townInitCmd)
	townCmd.AddCommand(townStartCmd)
	townCmd.AddCommand(townStopCmd)
	townCmd.AddCommand(townStatusCmd)
	townCmd.AddCommand(townAddCmd)
	townCmd.AddCommand(townCatalogCmd)

	// Register with root
	rootCmd.AddCommand(townCmd)

	// Add to beads-exempt list
	beadsExemptCommands["town"] = true
}

// --- helpers ---

func findTownDir() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	// Walk up looking for .town/engine.yaml
	dir := cwd
	for {
		candidate := filepath.Join(dir, defaultTownDir, "engine.yaml")
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Join(dir, defaultTownDir), nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("no town found (run 'gt town init' first)")
}

func loadTownConfig(townDir string) (*engine.Config, error) {
	data, err := os.ReadFile(filepath.Join(townDir, "engine.yaml"))
	if err != nil {
		return nil, fmt.Errorf("reading engine.yaml: %w", err)
	}
	var cfg engine.Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing engine.yaml: %w", err)
	}
	cfg.DataDir = townDir
	return &cfg, nil
}
