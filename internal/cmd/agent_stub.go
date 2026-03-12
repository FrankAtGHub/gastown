package cmd

// agent_stub.go provides symbols needed by agent_skills.go and memory_knowledge.go.
// The full agent.go and memory.go live on the super-gastown feature branch.
// This stub keeps main compilable until that branch merges.

import "github.com/spf13/cobra"

const agentDir = ".agent"

var agentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Manage agent identity and memory files",
	Long:  `Manage the OpenClaw-style agent file system (stub — full implementation on super-gastown branch).`,
	RunE:  requireSubcommand,
}

var memoryCmd = &cobra.Command{
	Use:   "memory",
	Short: "Agent memory management",
	Long:  `Manage agent memory (stub — full implementation on super-gastown branch).`,
	RunE:  requireSubcommand,
}

func init() {
	agentCmd.GroupID = GroupAgents
	rootCmd.AddCommand(agentCmd)
	memoryCmd.GroupID = GroupWork
	rootCmd.AddCommand(memoryCmd)
}
