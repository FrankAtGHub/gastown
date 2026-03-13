package rig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/FrankAtGHub/night-city/internal/hooks"
	"github.com/FrankAtGHub/night-city/internal/config"
	"github.com/FrankAtGHub/night-city/internal/constants"
	"github.com/FrankAtGHub/night-city/internal/git"
	"github.com/FrankAtGHub/night-city/internal/templates/commands"
	"github.com/FrankAtGHub/night-city/internal/util"
)

// Common errors
var (
	ErrRigNotFound = errors.New("rig not found")
	ErrRigExists   = errors.New("rig already exists")
)

// reservedRigNames are names that cannot be used for rigs because they
// collide with town-level infrastructure. "hq" is special-cased by
// EnsureMetadata and dolt routing as the town-level beads alias.
var reservedRigNames = []string{"hq"}

// wrapCloneError wraps clone errors with helpful suggestions.
// Detects common auth failures and suggests SSH as an alternative.
func wrapCloneError(err error, gitURL string) error {
	errStr := err.Error()

	// Check for GitHub password auth failure
	if strings.Contains(errStr, "Password authentication is not supported") ||
		strings.Contains(errStr, "Authentication failed") {
		// Check if they used HTTPS
		if strings.HasPrefix(gitURL, "https://") {
			// Try to suggest the SSH equivalent
			sshURL := convertToSSH(gitURL)
			if sshURL != "" {
				return fmt.Errorf("creating bare repo: %w\n\nHint: GitHub no longer supports password authentication.\nTry using SSH instead:\n  gt rig add <name> %s", err, sshURL)
			}
			return fmt.Errorf("creating bare repo: %w\n\nHint: GitHub no longer supports password authentication.\nTry using an SSH URL (git@github.com:owner/repo.git) or a personal access token.", err)
		}
	}

	return fmt.Errorf("creating bare repo: %w", err)
}

// convertToSSH converts an HTTPS GitHub/GitLab URL to SSH format.
// Returns empty string if conversion is not possible.
func convertToSSH(httpsURL string) string {
	// Handle GitHub: https://github.com/owner/repo.git -> git@github.com:owner/repo.git
	if strings.HasPrefix(httpsURL, "https://github.com/") {
		path := strings.TrimPrefix(httpsURL, "https://github.com/")
		if !strings.HasSuffix(path, ".git") {
			path += ".git"
		}
		return "git@github.com:" + path
	}

	// Handle GitLab: https://gitlab.com/owner/repo.git -> git@gitlab.com:owner/repo.git
	if strings.HasPrefix(httpsURL, "https://gitlab.com/") {
		path := strings.TrimPrefix(httpsURL, "https://gitlab.com/")
		if !strings.HasSuffix(path, ".git") {
			path += ".git"
		}
		return "git@gitlab.com:" + path
	}

	return ""
}

// RigConfig represents the rig-level configuration (config.json at rig root).
type RigConfig struct {
	Type          string        `json:"type"`                     // "rig"
	Version       int           `json:"version"`                  // schema version
	Name          string        `json:"name"`                     // rig name
	GitURL        string        `json:"git_url"`                  // repository URL (fetch/pull)
	PushURL       string        `json:"push_url,omitempty"`       // optional push URL (fork for read-only upstreams)
	UpstreamURL   string        `json:"upstream_url,omitempty"`   // optional upstream URL (for fork workflows)
	LocalRepo     string        `json:"local_repo,omitempty"`     // optional local reference repo
	DefaultBranch string        `json:"default_branch,omitempty"` // main, master, etc.
	CreatedAt     time.Time     `json:"created_at"`               // when rig was created
	Beads         *BeadsConfig  `json:"beads,omitempty"`
	Limits        *LimitsConfig `json:"limits,omitempty"`

	// Persistent polecat pool configuration.
	PolecatPoolSize int      `json:"polecat_pool_size,omitempty"`
	PolecatNames    []string `json:"polecat_names,omitempty"`
}

// BeadsConfig represents beads configuration for the rig.
type BeadsConfig struct {
	Prefix string `json:"prefix"` // issue prefix (e.g., "gt")
}

// LimitsConfig represents resource limits for the rig.
type LimitsConfig struct {
	MaxPolecats int `json:"max_polecats,omitempty"` // max concurrent polecats (0 = unlimited)
}

// CurrentRigConfigVersion is the current schema version.
const CurrentRigConfigVersion = 1

// Manager handles rig discovery, loading, and creation.
type Manager struct {
	townRoot string
	config   *config.RigsConfig
	git      *git.Git
}

// NewManager creates a new rig manager.
func NewManager(townRoot string, rigsConfig *config.RigsConfig, g *git.Git) *Manager {
	return &Manager{
		townRoot: townRoot,
		config:   rigsConfig,
		git:      g,
	}
}

// DiscoverRigs returns all rigs registered in the workspace.
// Rigs that fail to load are logged to stderr and skipped; partial results are returned.
func (m *Manager) DiscoverRigs() ([]*Rig, error) {
	var rigs []*Rig

	for name, entry := range m.config.Rigs {
		rig, err := m.loadRig(name, entry)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to load rig %q: %v\n", name, err)
			continue
		}
		rigs = append(rigs, rig)
	}

	return rigs, nil
}

// GetRig returns a specific rig by name.
func (m *Manager) GetRig(name string) (*Rig, error) {
	entry, ok := m.config.Rigs[name]
	if !ok {
		return nil, ErrRigNotFound
	}

	return m.loadRig(name, entry)
}

// RigExists checks if a rig is registered.
func (m *Manager) RigExists(name string) bool {
	_, ok := m.config.Rigs[name]
	return ok
}

// loadRig loads rig details from the filesystem.
func (m *Manager) loadRig(name string, entry config.RigEntry) (*Rig, error) {
	rigPath := filepath.Join(m.townRoot, name)

	// Verify directory exists
	info, err := os.Stat(rigPath)
	if err != nil {
		return nil, fmt.Errorf("rig directory: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("not a directory: %s", rigPath)
	}

	rig := &Rig{
		Name:      name,
		Path:      rigPath,
		GitURL:    entry.GitURL,
		PushURL:   strings.TrimSpace(entry.PushURL),
		LocalRepo: entry.LocalRepo,
		Config:    entry.BeadsConfig,
	}

	// Scan for polecats
	polecatsDir := filepath.Join(rigPath, "polecats")
	if entries, err := os.ReadDir(polecatsDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			if strings.HasPrefix(name, ".") {
				continue
			}
			rig.Polecats = append(rig.Polecats, name)
		}
	}

	// Scan for crew workers
	crewDir := filepath.Join(rigPath, "crew")
	if entries, err := os.ReadDir(crewDir); err == nil {
		for _, e := range entries {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				rig.Crew = append(rig.Crew, e.Name())
			}
		}
	}

	// Check for witness (witnesses don't have clones, just the witness directory)
	witnessPath := filepath.Join(rigPath, "witness")
	if info, err := os.Stat(witnessPath); err == nil && info.IsDir() {
		rig.HasWitness = true
	}

	// Check for refinery
	refineryPath := filepath.Join(rigPath, "refinery", "rig")
	if _, err := os.Stat(refineryPath); err == nil {
		rig.HasRefinery = true
	}

	// Check for mayor clone
	mayorPath := filepath.Join(rigPath, "mayor", "rig")
	if _, err := os.Stat(mayorPath); err == nil {
		rig.HasMayor = true
	}

	return rig, nil
}

// AddRigOptions configures rig creation.
type AddRigOptions struct {
	Name          string // Rig name (directory name)
	GitURL        string // Repository URL (fetch/pull)
	PushURL       string // Optional push URL (fork for read-only upstreams)
	UpstreamURL   string // Optional upstream URL (for fork workflows)
	BeadsPrefix   string // Beads issue prefix (defaults to derived from name)
	LocalRepo     string // Optional local repo for reference clones
	DefaultBranch string // Default branch (defaults to auto-detected from remote)
	SkipDoltCheck bool   // Skip Dolt server availability check (for tests with mocked beads)
}

func resolveLocalRepo(path, gitURL string) (string, string) {
	if path == "" {
		return "", ""
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Sprintf("local repo path invalid: %v", err)
	}

	absPath, err = filepath.EvalSymlinks(absPath)
	if err != nil {
		return "", fmt.Sprintf("local repo path invalid: %v", err)
	}

	repoGit := git.NewGit(absPath)
	if !repoGit.IsRepo() {
		return "", fmt.Sprintf("local repo is not a git repository: %s", absPath)
	}

	origin, err := repoGit.RemoteURL("origin")
	if err != nil {
		return absPath, "local repo has no origin; using it anyway"
	}
	if origin != gitURL {
		return "", fmt.Sprintf("local repo origin %q does not match %q", origin, gitURL)
	}

	return absPath, ""
}

// AddRig creates a new rig as a container with clones for each agent.
// The rig structure is:
//
//	<name>/                    # Container (NOT a git clone)
//	├── config.json            # Rig configuration
//	├── .beads/                # Rig-level issue tracking
//	├── refinery/rig/          # Canonical main clone
//	├── mayor/rig/             # Mayor's working clone
//	├── witness/               # Witness agent (no clone)
//	├── polecats/              # Worker directories (empty)
//	└── crew/<crew>/           # Default human workspace
func (m *Manager) AddRig(opts AddRigOptions) (*Rig, error) {
	if m.RigExists(opts.Name) {
		return nil, ErrRigExists
	}

	// Validate rig name: reject characters that break agent ID parsing
	// Agent IDs use format <prefix>-<rig>-<role>[-<name>] with hyphens as delimiters
	if strings.ContainsAny(opts.Name, "-. ") {
		sanitized := strings.NewReplacer("-", "_", ".", "_", " ", "_").Replace(opts.Name)
		sanitized = strings.ToLower(sanitized)
		return nil, fmt.Errorf("rig name %q contains invalid characters; hyphens, dots, and spaces are reserved for agent ID parsing. Try %q instead (underscores are allowed)", opts.Name, sanitized)
	}

	// Reject reserved names that collide with town-level infrastructure.
	// "hq" is special-cased by EnsureMetadata and dolt routing as the town-level alias.
	for _, reserved := range reservedRigNames {
		if strings.EqualFold(opts.Name, reserved) {
			return nil, fmt.Errorf("rig name %q is reserved for town-level infrastructure", opts.Name)
		}
	}

	rigPath := filepath.Join(m.townRoot, opts.Name)

	// Check if directory already exists
	if _, err := os.Stat(rigPath); err == nil {
		return nil, fmt.Errorf("directory already exists: %s\n\nTo adopt an existing directory, use --adopt:\n  gt rig add %s --adopt", rigPath, opts.Name)
	}

	// Track whether user explicitly provided --prefix (before deriving)
	opts.BeadsPrefix = strings.TrimSuffix(opts.BeadsPrefix, "-")

	// Derive defaults
	if opts.BeadsPrefix == "" {
		opts.BeadsPrefix = opts.Name
	}

	localRepo, warn := resolveLocalRepo(opts.LocalRepo, opts.GitURL)
	if warn != "" {
		fmt.Printf("  Warning: %s\n", warn)
	}

	// Create container directory
	if err := os.MkdirAll(rigPath, 0755); err != nil {
		return nil, fmt.Errorf("creating rig directory: %w", err)
	}

	// Track cleanup on failure (best-effort cleanup)
	cleanup := func() { _ = os.RemoveAll(rigPath) }
	success := false
	defer func() {
		if !success {
			cleanup()
		}
	}()

	// Create rig config
	rigConfig := &RigConfig{
		Type:        "rig",
		Version:     CurrentRigConfigVersion,
		Name:        opts.Name,
		GitURL:      opts.GitURL,
		PushURL:     opts.PushURL,
		UpstreamURL: opts.UpstreamURL,
		LocalRepo:   localRepo,
		CreatedAt:   time.Now(),
		Beads: &BeadsConfig{
			Prefix: opts.BeadsPrefix,
		},
	}
	if err := m.saveRigConfig(rigPath, rigConfig); err != nil {
		return nil, fmt.Errorf("saving rig config: %w", err)
	}

	// Create shared bare repo as source of truth for refinery and polecats.
	// This allows refinery to see polecat branches without pushing to remote.
	// Mayor remains a separate clone (doesn't need branch visibility).
	fmt.Printf("  Cloning repository (this may take a moment)...\n")
	bareRepoPath := filepath.Join(rigPath, ".repo.git")
	if localRepo != "" {
		if err := m.git.CloneBareWithReference(opts.GitURL, bareRepoPath, localRepo); err != nil {
			fmt.Printf("  Warning: could not use local repo reference: %v\n", err)
			_ = os.RemoveAll(bareRepoPath)
			if err := m.git.CloneBare(opts.GitURL, bareRepoPath); err != nil {
				return nil, wrapCloneError(err, opts.GitURL)
			}
		}
	} else {
		if err := m.git.CloneBare(opts.GitURL, bareRepoPath); err != nil {
			return nil, wrapCloneError(err, opts.GitURL)
		}
	}
	fmt.Printf("   ✓ Created shared bare repo\n")
	bareGit := git.NewGitWithDir(bareRepoPath, "")

	// Detect empty repos (no commits) early with a clear diagnostic.
	// An empty repo has no refs, so RemoteDefaultBranch/DefaultBranch would
	// return "main" as a fallback, but checkout would fail with an opaque error.
	if empty, err := bareGit.IsEmpty(); err != nil {
		return nil, fmt.Errorf("checking if repository is empty: %w", err)
	} else if empty {
		return nil, fmt.Errorf("repository %s is empty (no commits). Push at least one commit before adding it as a rig", opts.GitURL)
	}

	// Configure push URL if provided (for read-only upstream repos)
	// This sets origin's push URL to the fork while keeping fetch URL as upstream
	if opts.PushURL != "" {
		if err := bareGit.ConfigurePushURL("origin", opts.PushURL); err != nil {
			return nil, fmt.Errorf("configuring push URL: %w", err)
		}
		fmt.Printf("   ✓ Configured push URL (fork: %s)\n", util.RedactURL(opts.PushURL)) // fmt.Printf matches AddRig's established success output pattern
	}

	// Configure upstream remote if provided (for fork workflows)
	if opts.UpstreamURL != "" {
		if err := bareGit.AddUpstreamRemote(opts.UpstreamURL); err != nil {
			return nil, fmt.Errorf("configuring upstream remote: %w", err)
		}
		fmt.Printf("   ✓ Configured upstream remote: %s\n", util.RedactURL(opts.UpstreamURL))
	}

	// Determine default branch: use provided value or auto-detect from remote
	var defaultBranch string
	if opts.DefaultBranch != "" {
		defaultBranch = opts.DefaultBranch
	} else {
		// Bare repos don't have refs/remotes/origin/* tracking branches,
		// so detect the default branch from HEAD (which git sets to the
		// remote's default branch during clone --bare).
		defaultBranch = bareGit.DefaultBranch()
	}
	// When user specified --default-branch, the shallow single-branch clone may not
	// have that branch (it only clones the remote HEAD). Fetch it explicitly.
	if opts.DefaultBranch != "" {
		ref := fmt.Sprintf("origin/%s", defaultBranch)
		if exists, _ := bareGit.RefExists(ref); !exists {
			// Branch not in shallow clone — fetch just that branch
			if err := bareGit.FetchBranchShallow("origin", defaultBranch); err != nil {
				return nil, fmt.Errorf("branch %q does not exist on remote or could not be fetched: %w", defaultBranch, err)
			}
		}
	}

	rigConfig.DefaultBranch = defaultBranch
	// Re-save config with default branch
	if err := m.saveRigConfig(rigPath, rigConfig); err != nil {
		return nil, fmt.Errorf("updating rig config with default branch: %w", err)
	}

	// Create mayor as regular clone (separate from bare repo).
	// Mayor doesn't need to see polecat branches - that's refinery's job.
	// This also allows mayor to stay on the default branch without conflicting with refinery.
	// Uses --reference to borrow objects from the bare repo we just created,
	// avoiding a redundant download from the remote (GH#1059).
	fmt.Printf("  Creating mayor clone...\n")
	mayorRigPath := filepath.Join(rigPath, "mayor", "rig")
	if err := os.MkdirAll(filepath.Dir(mayorRigPath), 0755); err != nil {
		return nil, fmt.Errorf("creating mayor dir: %w", err)
	}
	if err := m.git.CloneBranchWithReference(opts.GitURL, mayorRigPath, defaultBranch, bareRepoPath); err != nil {
		fmt.Printf("  Warning: could not use bare repo as reference: %v\n", err)
		_ = os.RemoveAll(mayorRigPath)
		if err := m.git.CloneBranch(opts.GitURL, mayorRigPath, defaultBranch); err != nil {
			return nil, fmt.Errorf("cloning for mayor: %w", err)
		}
	}

	// No explicit checkout needed - --branch already checked out the default branch
	mayorGit := git.NewGitWithDir("", mayorRigPath)
	// Configure push URL on mayor clone (separate clone, doesn't inherit from bare repo)
	if opts.PushURL != "" {
		if err := mayorGit.ConfigurePushURL("origin", opts.PushURL); err != nil {
			return nil, fmt.Errorf("configuring mayor push URL: %w", err)
		}
	}
	// Configure upstream remote on mayor clone (separate clone, doesn't inherit from bare repo)
	if opts.UpstreamURL != "" {
		if err := mayorGit.AddUpstreamRemote(opts.UpstreamURL); err != nil {
			return nil, fmt.Errorf("configuring mayor upstream remote: %w", err)
		}
	}
	fmt.Printf("   ✓ Created mayor clone\n")

	// NOTE: No per-directory CLAUDE.md/AGENTS.md is created for any agent.
	// Only ~/gt/CLAUDE.md (town-root identity anchor) exists on disk.
	// Full context is injected ephemerally by `gt prime` at session start.

	// Create refinery as worktree from bare repo on default branch.
	// Refinery needs to see polecat branches (shared .repo.git) and merges them.
	// Being on the default branch allows direct merge workflow.
	fmt.Printf("  Creating refinery worktree...\n")
	refineryRigPath := filepath.Join(rigPath, "refinery", "rig")
	if err := os.MkdirAll(filepath.Dir(refineryRigPath), 0755); err != nil {
		return nil, fmt.Errorf("creating refinery dir: %w", err)
	}
	if err := bareGit.WorktreeAddExisting(refineryRigPath, defaultBranch); err != nil {
		return nil, fmt.Errorf("creating refinery worktree: %w", err)
	}
	refineryGit := git.NewGit(refineryRigPath)
	if err := refineryGit.ConfigureHooksPath(); err != nil {
		return nil, fmt.Errorf("configuring hooks for refinery: %w", err)
	}
	fmt.Printf("   ✓ Created refinery worktree\n")
	// Copy overlay files from .runtime/overlay/ to refinery root.
	// This allows services to have .env and other config files at their root.
	if err := CopyOverlay(rigPath, refineryRigPath); err != nil {
		// Non-fatal - log warning but continue
		fmt.Printf("  Warning: Could not copy overlay files to refinery: %v\n", err)
	}

	// NOTE: Claude settings are installed by the agent at startup, not here.
	// Claude Code does NOT traverse parent directories for settings.json.
	// See: https://github.com/anthropics/claude-code/issues/12962

	// Create empty crew directory with README (crew members added via gt crew add)
	crewPath := filepath.Join(rigPath, "crew")
	if err := os.MkdirAll(crewPath, 0755); err != nil {
		return nil, fmt.Errorf("creating crew dir: %w", err)
	}
	// Create README with instructions
	readmePath := filepath.Join(crewPath, "README.md")
	readmeContent := `# Crew Directory

This directory contains crew worker workspaces.

## Adding a Crew Member

` + "```bash" + `
gt crew add <name>    # Creates crew/<name>/ with a git clone
` + "```" + `

## Crew vs Polecats

- **Crew**: Persistent, user-managed workspaces (never auto-garbage-collected)
- **Polecats**: Transient, witness-managed workers (cleaned up after work completes)

Use crew for your own workspace. Polecats are for batch work dispatch.
`
	if err := os.WriteFile(readmePath, []byte(readmeContent), 0644); err != nil {
		return nil, fmt.Errorf("creating crew README: %w", err)
	}
	// Create witness directory (no clone needed)
	witnessPath := filepath.Join(rigPath, "witness")
	if err := os.MkdirAll(witnessPath, 0755); err != nil {
		return nil, fmt.Errorf("creating witness dir: %w", err)
	}
	// NOTE: Witness hooks are installed by witness/manager.go:Start() via EnsureSettingsForRole.
	// No need to create patrol hooks here — agents self-install at startup.

	// Create polecats directory with agent settings scaffold.
	// Settings are passed to the agent via --settings flag (Claude) or installed
	// in workDir (other agents). Scaffolding here ensures the settings file exists
	// before the first polecat session starts, preventing startup failures.
	polecatsPath := filepath.Join(rigPath, "polecats")
	if err := os.MkdirAll(polecatsPath, 0755); err != nil {
		return nil, fmt.Errorf("creating polecats dir: %w", err)
	}
	// Use the default agent preset for scaffolding
	defaultPreset := config.GetAgentPreset(config.DefaultAgentPreset())
	if defaultPreset != nil && defaultPreset.HooksProvider != "" {
		if err := hooks.InstallForRole(defaultPreset.HooksProvider, polecatsPath, polecatsPath, "polecat",
			defaultPreset.HooksDir, defaultPreset.HooksSettingsFile, defaultPreset.HooksUseSettingsDir); err != nil {
			// Non-fatal: session startup will retry via EnsureSettingsForRole
			fmt.Printf("  %s Could not scaffold polecat settings: %v\n", "!", err)
		}
	}
	if err := commands.ProvisionFor(polecatsPath, "claude"); err != nil {
		// Non-fatal: commands are convenience, not critical
		fmt.Printf("  %s Could not scaffold polecat commands: %v\n", "!", err)
	}

	// Create rig-level settings directory (used by gt config for rig overrides)
	rigSettingsPath := filepath.Join(rigPath, constants.DirSettings)
	if err := os.MkdirAll(rigSettingsPath, 0755); err != nil {
		return nil, fmt.Errorf("creating settings dir: %w", err)
	}

	// Create plugin directories
	if err := m.createPluginDirectories(rigPath); err != nil {
		// Non-fatal: log warning but continue
		fmt.Fprintf(os.Stderr, "  Warning: Could not create plugin directories: %v\n", err)
	}

	// Register in town config
	m.config.Rigs[opts.Name] = config.RigEntry{
		GitURL:      opts.GitURL,
		PushURL:     opts.PushURL,
		UpstreamURL: opts.UpstreamURL,
		LocalRepo:   localRepo,
		AddedAt:     time.Now(),
		BeadsConfig: &config.BeadsConfig{
			Prefix: opts.BeadsPrefix,
		},
	}

	success = true
	return m.loadRig(opts.Name, m.config.Rigs[opts.Name])
}

// saveRigConfig writes the rig configuration to config.json.
func (m *Manager) saveRigConfig(rigPath string, cfg *RigConfig) error {
	configPath := filepath.Join(rigPath, "config.json")
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath, data, 0644)
}

// LoadRigConfig reads the rig configuration from config.json.
func LoadRigConfig(rigPath string) (*RigConfig, error) {
	configPath := filepath.Join(rigPath, "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}
	var cfg RigConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	warnDeprecatedRigConfigKeys(data, configPath)
	return &cfg, nil
}

// warnDeprecatedRigConfigKeys detects merge_queue keys in rig root config.json
// that are silently ignored by json.Unmarshal (RigConfig has no merge_queue field).
// Without this warning, users can set merge_queue.target_branch believing it
// controls MR targets, while gt mq submit / gt done actually use default_branch.
func warnDeprecatedRigConfigKeys(data []byte, path string) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return
	}
	if mq, ok := raw["merge_queue"]; ok {
		var mqMap map[string]json.RawMessage
		if json.Unmarshal(mq, &mqMap) == nil {
			if _, has := mqMap["target_branch"]; has {
				fmt.Fprintf(os.Stderr, "WARNING: %s: merge_queue.target_branch is deprecated and ignored — set default_branch instead\n", path)
			}
		}
	}
}

// InitBeads initializes the beads database at rig level.
// The project's .beads/config.yaml determines sync-branch settings.
// Use `bd doctor --fix` in the project to configure sync-branch if needed.
// TODO(bd-yaml): beads config should migrate to JSON (see beads issue)
//
// rigName is the rig's database name (e.g. "gastown"). When non-empty and
// different from the default "beads_<prefix>" database that bd init creates,
// InitBeads drops the orphan database to prevent accumulation (gt-sv1h).

// ensureGitignoreEntry adds an entry to .gitignore if it doesn't already exist.
func (m *Manager) ensureGitignoreEntry(gitignorePath, entry string) error {
	// Read existing content
	content, err := os.ReadFile(gitignorePath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	// Check if entry already exists
	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		if strings.TrimSpace(line) == entry {
			return nil // Already present
		}
	}

	// Append entry
	f, err := os.OpenFile(gitignorePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644) //nolint:gosec // G302: .gitignore should be readable by git tools
	if err != nil {
		return err
	}
	defer f.Close()

	// Add newline before if file doesn't end with one
	if len(content) > 0 && content[len(content)-1] != '\n' {
		if _, err := f.WriteString("\n"); err != nil {
			return err
		}
	}
	_, err = f.WriteString(entry + "\n")
	return err
}

// RemoveRig unregisters a rig (does not delete files).
func (m *Manager) RemoveRig(name string) error {
	if !m.RigExists(name) {
		return ErrRigNotFound
	}

	delete(m.config.Rigs, name)
	return nil
}

// ListRigNames returns the names of all registered rigs.
// RegisterRigOptions contains options for registering an existing rig directory.
type RegisterRigOptions struct {
	Name        string // Rig name (directory name)
	GitURL      string // Override git URL (auto-detected from origin if empty)
	PushURL     string // Override push URL (auto-detected from existing config/remotes if empty)
	UpstreamURL string // Upstream repository URL (for fork workflows)
	BeadsPrefix string // Beads issue prefix (defaults to derived from name or existing config)
	Force       bool   // Register even if directory structure looks incomplete
}

// RegisterRigResult contains the result of registering a rig.
type RegisterRigResult struct {
	Name          string // Rig name
	GitURL        string // Detected or provided git URL
	BeadsPrefix   string // Detected or derived beads prefix
	FromConfig    bool   // True if values were read from existing config.json
	DefaultBranch string // Default branch from existing config (if any)
}

// RegisterRig registers an existing rig directory with the town.
// Complementary to AddRig: while AddRig creates a new rig from scratch,
// RegisterRig adopts an existing directory structure.
func (m *Manager) RegisterRig(opts RegisterRigOptions) (*RegisterRigResult, error) {
	if m.RigExists(opts.Name) {
		return nil, ErrRigExists
	}

	if strings.ContainsAny(opts.Name, "-. ") {
		sanitized := strings.NewReplacer("-", "_", ".", "_", " ", "_").Replace(opts.Name)
		sanitized = strings.ToLower(sanitized)
		return nil, fmt.Errorf("rig name %q contains invalid characters; hyphens, dots, and spaces are reserved for agent ID parsing. Try %q instead (underscores are allowed)", opts.Name, sanitized)
	}

	for _, reserved := range reservedRigNames {
		if strings.EqualFold(opts.Name, reserved) {
			return nil, fmt.Errorf("rig name %q is reserved for town-level infrastructure", opts.Name)
		}
	}

	rigPath := filepath.Join(m.townRoot, opts.Name)

	info, err := os.Stat(rigPath)
	if os.IsNotExist(err) {
		return nil, fmt.Errorf("directory does not exist: %s", rigPath)
	}
	if err != nil {
		return nil, fmt.Errorf("checking directory: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("not a directory: %s", rigPath)
	}

	result := &RegisterRigResult{Name: opts.Name}

	// Try to load existing config.json
	existingConfig, err := LoadRigConfig(rigPath)
	if err == nil && existingConfig != nil {
		result.FromConfig = true
		if opts.GitURL == "" {
			result.GitURL = existingConfig.GitURL
		}
		if opts.BeadsPrefix == "" && existingConfig.Beads != nil {
			result.BeadsPrefix = existingConfig.Beads.Prefix
		}
		result.DefaultBranch = existingConfig.DefaultBranch
	}

	// If no git URL, try to detect from git remote
	if result.GitURL == "" && opts.GitURL == "" {
		detectedURL, detectErr := m.detectGitURL(rigPath)
		if detectErr != nil && !opts.Force {
			return nil, fmt.Errorf("could not detect git URL (use --url to specify, or --force to skip): %w", detectErr)
		}
		result.GitURL = detectedURL
	}
	if opts.GitURL != "" {
		result.GitURL = opts.GitURL
	}

	// Derive beads prefix
	if result.BeadsPrefix == "" && opts.BeadsPrefix == "" {
		result.BeadsPrefix = opts.Name
	}
	if opts.BeadsPrefix != "" {
		result.BeadsPrefix = opts.BeadsPrefix
	}

	// Determine push URL: explicit option > existing config > auto-detect from remotes.
	// Only explicit option and config.json with non-empty push_url are "authoritative"
	// (trusted for clearing decisions). Auto-detection runs when no authoritative source
	// provides a push URL — this covers both fresh adopts and legacy configs that predate
	// the push_url feature. Auto-detection may fail silently (returns empty on git errors)
	// and must not trigger stale URL clearing.
	pushURL := ""
	pushURLAuthoritative := false // whether the source can be trusted for clearing decisions
	if opts.PushURL != "" {
		pushURL = opts.PushURL
		pushURLAuthoritative = true
	} else if existingConfig != nil && existingConfig.PushURL != "" {
		// Config.json has an explicit push URL — use it as authoritative
		pushURL = existingConfig.PushURL
		pushURLAuthoritative = true
	} else {
		// No authoritative push URL source: either no config.json (fresh adopt) or
		// legacy config without push_url field. Auto-detect from existing git remotes.
		pushURL = m.detectPushURL(rigPath)
		// Not authoritative — only use for positive detection, never for clearing
	}

	// Apply push URL to existing repos (mirrors AddRig behavior).
	bareRepoPath := filepath.Join(rigPath, ".repo.git")
	mayorRigPath := filepath.Join(rigPath, "mayor", "rig")
	if pushURL != "" {
		if _, err := os.Stat(bareRepoPath); err == nil {
			bareGit := git.NewGitWithDir(bareRepoPath, "")
			if cfgErr := bareGit.ConfigurePushURL("origin", pushURL); cfgErr != nil {
				return nil, fmt.Errorf("configuring push URL on bare repo: %w", cfgErr)
			}
		}
		if _, err := os.Stat(mayorRigPath); err == nil {
			mayorGit := git.NewGit(mayorRigPath)
			if cfgErr := mayorGit.ConfigurePushURL("origin", pushURL); cfgErr != nil {
				return nil, fmt.Errorf("configuring mayor push URL: %w", cfgErr)
			}
		}
	} else if pushURLAuthoritative {
		// Clear stale push URLs only when an authoritative source says "no push URL".
		// Auto-detection returning empty could be a git error — don't clear in that case.
		// Note: currently unreachable — authoritative sources always set non-empty pushURL.
		// Retained for future --no-push-url flag support.
		if _, err := os.Stat(bareRepoPath); err == nil {
			bareGit := git.NewGitWithDir(bareRepoPath, "")
			if clrErr := bareGit.ClearPushURL("origin"); clrErr != nil {
				return nil, fmt.Errorf("clearing stale push URL on bare repo: %w", clrErr)
			}
		}
		if _, err := os.Stat(mayorRigPath); err == nil {
			mayorGit := git.NewGit(mayorRigPath)
			if clrErr := mayorGit.ClearPushURL("origin"); clrErr != nil {
				return nil, fmt.Errorf("clearing stale mayor push URL: %w", clrErr)
			}
		}
	}

	// Sync push URL to config.json so doctor check sees it
	if existingConfig != nil && existingConfig.PushURL != pushURL {
		existingConfig.PushURL = pushURL
		if saveErr := m.saveRigConfig(rigPath, existingConfig); saveErr != nil {
			// Non-fatal: town.json has the value, but doctor may flag a mismatch
			fmt.Fprintf(os.Stderr, "Warning: could not update config.json with push URL: %v\n", saveErr)
		}
	}

	// Configure upstream remote if provided (for fork workflows)
	if opts.UpstreamURL != "" {
		if _, err := os.Stat(bareRepoPath); err == nil {
			bareGit := git.NewGitWithDir(bareRepoPath, "")
			if upErr := bareGit.AddUpstreamRemote(opts.UpstreamURL); upErr != nil {
				return nil, fmt.Errorf("configuring upstream remote on bare repo: %w", upErr)
			}
		}
		if _, err := os.Stat(mayorRigPath); err == nil {
			mayorGit := git.NewGit(mayorRigPath)
			if upErr := mayorGit.AddUpstreamRemote(opts.UpstreamURL); upErr != nil {
				return nil, fmt.Errorf("configuring mayor upstream remote: %w", upErr)
			}
		}
	}

	// Register in town config
	m.config.Rigs[opts.Name] = config.RigEntry{
		GitURL:      result.GitURL,
		PushURL:     pushURL,
		UpstreamURL: opts.UpstreamURL,
		AddedAt:     time.Now(),
		BeadsConfig: &config.BeadsConfig{
			Prefix: result.BeadsPrefix,
		},
	}

	return result, nil
}

// detectPushURL attempts to detect a custom push URL from an existing repository.
// Returns empty string if push URL matches fetch URL (no custom push URL configured).
func (m *Manager) detectPushURL(rigPath string) string {
	// Check bare repo first (polecat-preferred source of truth), then clones.
	// .repo.git is a bare repo and requires NewGitWithDir; the rest are regular clones.
	bareRepoPath := filepath.Join(rigPath, ".repo.git")
	if pushURL := detectPushURLFrom(git.NewGitWithDir(bareRepoPath, "")); pushURL != "" {
		return pushURL
	}

	clonePaths := []string{
		rigPath,
		filepath.Join(rigPath, "mayor", "rig"),
		filepath.Join(rigPath, "refinery", "rig"),
	}
	for _, p := range clonePaths {
		if pushURL := detectPushURLFrom(git.NewGit(p)); pushURL != "" {
			return pushURL
		}
	}
	return ""
}

// detectPushURLFrom checks a single git repo for a custom push URL.
func detectPushURLFrom(g *git.Git) string {
	fetchURL, fetchErr := g.RemoteURL("origin")
	if fetchErr != nil {
		return ""
	}
	pushURL, pushErr := g.GetPushURL("origin")
	if pushErr != nil || pushURL == "" {
		return ""
	}
	if strings.TrimSpace(pushURL) != strings.TrimSpace(fetchURL) {
		return strings.TrimSpace(pushURL)
	}
	return ""
}

// detectGitURL attempts to detect the git remote URL from an existing repository.
// detectGitURL finds the origin remote URL from available clones.
// Note: .repo.git is intentionally not checked here — it's a bare repo shared by worktrees
// and requires NewGitWithDir (not NewGit). detectPushURL checks .repo.git because push URL
// is primarily configured there. For git URL, the clone-based paths are authoritative.
func (m *Manager) detectGitURL(rigPath string) (string, error) {
	possiblePaths := []string{
		rigPath,
		filepath.Join(rigPath, "mayor", "rig"),
		filepath.Join(rigPath, "refinery", "rig"),
	}
	for _, p := range possiblePaths {
		g := git.NewGit(p)
		url, err := g.RemoteURL("origin")
		if err == nil && url != "" {
			return strings.TrimSpace(url), nil
		}
	}
	return "", fmt.Errorf("no git repository with origin remote found in %s", rigPath)
}

func (m *Manager) ListRigNames() []string {
	names := make([]string, 0, len(m.config.Rigs))
	for name := range m.config.Rigs {
		names = append(names, name)
	}
	return names
}

// seedPatrolMolecules creates patrol molecule prototypes in the rig's beads database.
// These molecules define the work loops for Deacon, Witness, and Refinery roles.
// createPluginDirectories creates plugin directories at town and rig levels.
// - ~/gt/plugins/ (town-level, shared across all rigs)
// - <rig>/plugins/ (rig-level, rig-specific plugins)
func (m *Manager) createPluginDirectories(rigPath string) error {
	// Town-level plugins directory
	townPluginsDir := filepath.Join(m.townRoot, "plugins")
	if err := os.MkdirAll(townPluginsDir, 0755); err != nil {
		return fmt.Errorf("creating town plugins directory: %w", err)
	}

	// Create a README in town plugins if it doesn't exist
	townReadme := filepath.Join(townPluginsDir, "README.md")
	if _, err := os.Stat(townReadme); os.IsNotExist(err) {
		content := `# Gas Town Plugins

This directory contains town-level plugins that run during Deacon patrol cycles.

## Plugin Structure

Each plugin is a directory containing:
- plugin.md - Plugin definition with TOML frontmatter

## Gate Types

- cooldown: Time since last run (e.g., 24h)
- cron: Schedule-based (e.g., "0 9 * * *")
- condition: Metric threshold
- event: Trigger-based (startup, heartbeat)

See docs/deacon-plugins.md for full documentation.
`
		if writeErr := os.WriteFile(townReadme, []byte(content), 0644); writeErr != nil {
			// Non-fatal
			return nil
		}
	}

	// Rig-level plugins directory
	rigPluginsDir := filepath.Join(rigPath, "plugins")
	if err := os.MkdirAll(rigPluginsDir, 0755); err != nil {
		return fmt.Errorf("creating rig plugins directory: %w", err)
	}

	// Add Gas Town directories and config files to rig .gitignore so they
	// don't pollute the project repo. The rig container is not a git repo
	// itself, but this is a defensive measure against accidental git init
	// or future architecture changes.
	//
	// NOTE: No **/* wildcards — all GT runtime files live inside these
	// directories. Broad patterns like **/*.lock would catch project files
	// (yarn.lock, Cargo.lock, flake.lock, etc).
	gitignorePath := filepath.Join(rigPath, ".gitignore")
	gitignoreEntries := []string{
		// Existing patterns
		"plugins/",
		".repo.git/",
		".land-worktree/",
		// GT infrastructure directories
		".beads/",
		".claude/",
		".archive/",
		".runtime/",
		"crew/",
		"daemon/",
		"mayor/",
		"polecats/",
		"refinery/",
		"settings/",
		"witness/",
		// GT configuration files
		"config.json",
		"state.json",
		"AGENTS.md",
	}
	for _, entry := range gitignoreEntries {
		if err := m.ensureGitignoreEntry(gitignorePath, entry); err != nil {
			return err
		}
	}
	return nil
}
