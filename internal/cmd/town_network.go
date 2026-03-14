package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/engine/network"
	"github.com/FrankAtGHub/night-city/internal/style"
	"gopkg.in/yaml.v3"
)

// Network config file
const networkConfigFile = "network.yaml"

type networkConfig struct {
	Peers []struct {
		Name string `yaml:"name"`
		Addr string `yaml:"addr"`
	} `yaml:"peers"`
}

var townNetworkCmd = &cobra.Command{
	Use:   "network",
	Short: "Manage multi-host town network",
	Long:  "Connect to and manage peer towns running on other hosts.",
	RunE:  requireSubcommand,
}

// --- network add ---

var townNetworkAddCmd = &cobra.Command{
	Use:   "add <name> <addr>",
	Short: "Add a peer town",
	Long:  "Register a remote town as a network peer. Addr should be host:port (e.g., 192.168.1.10:8420).",
	Args:  cobra.ExactArgs(2),
	RunE:  runTownNetworkAdd,
}

func runTownNetworkAdd(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	name, addr := args[0], args[1]

	cfg := loadNetworkConfig(townDir)
	for _, p := range cfg.Peers {
		if p.Name == name {
			return fmt.Errorf("peer %q already registered", name)
		}
	}

	cfg.Peers = append(cfg.Peers, struct {
		Name string `yaml:"name"`
		Addr string `yaml:"addr"`
	}{Name: name, Addr: addr})

	if err := saveNetworkConfig(townDir, cfg); err != nil {
		return err
	}

	fmt.Printf("%s Added peer '%s' at %s\n", style.Bold.Render("✓"), name, addr)
	return nil
}

// --- network remove ---

var townNetworkRemoveCmd = &cobra.Command{
	Use:   "remove <name>",
	Short: "Remove a peer town",
	Args:  cobra.ExactArgs(1),
	RunE:  runTownNetworkRemove,
}

func runTownNetworkRemove(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	name := args[0]
	cfg := loadNetworkConfig(townDir)

	found := false
	var remaining []struct {
		Name string `yaml:"name"`
		Addr string `yaml:"addr"`
	}
	for _, p := range cfg.Peers {
		if p.Name == name {
			found = true
			continue
		}
		remaining = append(remaining, p)
	}

	if !found {
		return fmt.Errorf("peer %q not found", name)
	}

	cfg.Peers = remaining
	if err := saveNetworkConfig(townDir, cfg); err != nil {
		return err
	}

	fmt.Printf("%s Removed peer '%s'\n", style.Bold.Render("✓"), name)
	return nil
}

// --- network status ---

var townNetworkStatusJSON bool

var townNetworkStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show network peer status",
	RunE:  runTownNetworkStatus,
}

func runTownNetworkStatus(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	cfg := loadNetworkConfig(townDir)
	if len(cfg.Peers) == 0 {
		fmt.Println("No peers configured. Use 'gt town network add <name> <addr>' to add one.")
		return nil
	}

	localCfg, err := loadTownConfig(townDir)
	if err != nil {
		return err
	}

	hub := network.NewHub(localCfg.Name, "")
	for _, p := range cfg.Peers {
		hub.AddPeer(p.Name, p.Addr)
	}

	hub.HealthCheck(cmd.Context())
	peers := hub.Peers()

	if townNetworkStatusJSON {
		data, _ := json.MarshalIndent(peers, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	fmt.Printf("%s\n", style.Bold.Render("Network Peers:"))
	for _, p := range peers {
		indicator := "🔴"
		if p.Status == "online" {
			indicator = "🟢"
		}
		fmt.Printf("  %s %-15s %s (%s)\n", indicator, p.Name, p.Addr, p.Status)
	}
	return nil
}

// --- registration ---

func init() {
	townNetworkStatusCmd.Flags().BoolVar(&townNetworkStatusJSON, "json", false, "Output as JSON")

	townNetworkCmd.AddCommand(townNetworkAddCmd)
	townNetworkCmd.AddCommand(townNetworkRemoveCmd)
	townNetworkCmd.AddCommand(townNetworkStatusCmd)
	townCmd.AddCommand(townNetworkCmd)
}

// --- helpers ---

func loadNetworkConfig(townDir string) *networkConfig {
	cfg := &networkConfig{}
	data, err := os.ReadFile(filepath.Join(townDir, networkConfigFile))
	if err != nil {
		return cfg
	}
	yaml.Unmarshal(data, cfg)
	return cfg
}

func saveNetworkConfig(townDir string, cfg *networkConfig) error {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(townDir, networkConfigFile), data, 0644)
}
