package templates

import (
	"bytes"
	"embed"
	"fmt"
	"text/template"
)

//go:embed agent-files/*.md.tmpl
var agentFileFS embed.FS

// AgentFileData contains information for rendering agent identity files.
type AgentFileData struct {
	RoleName  string // "mayor", "polecat", "witness", etc.
	AgentName string // Display name (e.g., "Fullstack Agent")
	Emoji     string // Default emoji for role
	Creature  string // Default creature type
	Vibe      string // Default personality vibe
	RoleLabel string // Human-readable role (e.g., "Quality Authority")
	RigName   string // Rig name (e.g., "copperhead")
	TownRoot  string // Town root path
	Polecat   string // Polecat/crew name (if applicable)
	TownName  string // Town identifier
}

// agentFileTemplates is the parsed template set for agent files.
var agentFileTemplates *template.Template

func initAgentFileTemplates() error {
	if agentFileTemplates != nil {
		return nil
	}
	var err error
	agentFileTemplates, err = template.New("").Funcs(templateFuncs).ParseFS(agentFileFS, "agent-files/*.md.tmpl")
	if err != nil {
		return fmt.Errorf("parsing agent file templates: %w", err)
	}
	return nil
}

// RenderAgentFile renders a single agent file template by name.
// The name should be the file name without path (e.g., "IDENTITY.md.tmpl").
func RenderAgentFile(name string, data AgentFileData) (string, error) {
	if err := initAgentFileTemplates(); err != nil {
		return "", err
	}

	var buf bytes.Buffer
	if err := agentFileTemplates.ExecuteTemplate(&buf, name, data); err != nil {
		return "", fmt.Errorf("rendering agent file %s: %w", name, err)
	}
	return buf.String(), nil
}

// AgentFileNames returns the ordered list of agent file template names.
func AgentFileNames() []string {
	return []string{
		"IDENTITY.md.tmpl",
		"SOUL.md.tmpl",
		"AGENTS.md.tmpl",
		"USER.md.tmpl",
		"TOOLS.md.tmpl",
		"HEARTBEAT.md.tmpl",
		"MEMORY.md.tmpl",
		"BOOTSTRAP.md.tmpl",
	}
}

// AgentFileName strips the .tmpl suffix to get the output filename.
func AgentFileName(templateName string) string {
	if len(templateName) > 5 && templateName[len(templateName)-5:] == ".tmpl" {
		return templateName[:len(templateName)-5]
	}
	return templateName
}

// DefaultAgentFileData returns the default AgentFileData for a given role.
func DefaultAgentFileData(role, rig, polecat, townRoot, townName string) AgentFileData {
	d := AgentFileData{
		RoleName: role,
		RigName:  rig,
		Polecat:  polecat,
		TownRoot: townRoot,
		TownName: townName,
	}

	switch role {
	case "mayor":
		d.AgentName = "Mayor"
		d.Emoji = "⚙️"
		d.Creature = "Coordinator"
		d.Vibe = "Strategic, decisive, efficient"
		d.RoleLabel = "Global Coordinator"
	case "witness":
		d.AgentName = "Witness"
		d.Emoji = "👁️"
		d.Creature = "Lifecycle guardian"
		d.Vibe = "Vigilant, methodical, patient"
		d.RoleLabel = "Worker Lifecycle Manager"
	case "refinery":
		d.AgentName = "Refinery"
		d.Emoji = "⚗️"
		d.Creature = "Merge processor"
		d.Vibe = "Precise, systematic, thorough"
		d.RoleLabel = "Merge Queue Processor"
	case "polecat":
		name := polecat
		if name == "" {
			name = "Polecat"
		}
		d.AgentName = name
		d.Emoji = "🔧"
		d.Creature = "Worker"
		d.Vibe = "Focused, resourceful, autonomous"
		d.RoleLabel = "Polecat Worker"
	case "crew":
		name := polecat
		if name == "" {
			name = "Crew"
		}
		d.AgentName = name
		d.Emoji = "🛠️"
		d.Creature = "Crew member"
		d.Vibe = "Reliable, autonomous, thorough"
		d.RoleLabel = "Crew Member"
	case "deacon":
		d.AgentName = "Deacon"
		d.Emoji = "⛪"
		d.Creature = "Daemon shepherd"
		d.Vibe = "Steady, watchful, reliable"
		d.RoleLabel = "Daemon Shepherd"
	case "dog":
		name := polecat
		if name == "" {
			name = "Dog"
		}
		d.AgentName = name
		d.Emoji = "🐕"
		d.Creature = "Scout"
		d.Vibe = "Quick, eager, persistent"
		d.RoleLabel = "Scout Dog"
	case "architect":
		d.AgentName = "Architect"
		d.Emoji = "📐"
		d.Creature = "Quality sentinel"
		d.Vibe = "Precise, thorough, uncompromising"
		d.RoleLabel = "Quality Authority"
	default:
		d.AgentName = "Agent"
		d.Emoji = "🤖"
		d.Creature = "Agent"
		d.Vibe = "Capable, adaptable"
		d.RoleLabel = "Agent"
	}

	return d
}
