package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/engine/accountability"
	"github.com/FrankAtGHub/night-city/internal/style"
)

// Pipeline stages — the mayor drives this sequence.
// Agents only do stage 1 (implement). Everything else is mayor + architect.
//
// 1. Agent implements in branch → reports done
// 2. Mayor reviews diff
// 3. Mayor merges to main
// 4. Mayor deploys to staging
// 5. Architect verifies on staging (Puppeteer E2E)
// 6. Mayor pushes to GitHub (locks the safe)
// 7. Mayor updates Notion + logs

var townPipelineCmd = &cobra.Command{
	Use:   "pipeline",
	Short: "Run the wave delivery pipeline",
	Long: `The mayor's delivery pipeline for shipping waves.

Stages:
  1. merge    — Merge agent branch to main
  2. deploy   — Build Docker images and deploy to staging
  3. verify   — Send to architect for E2E verification on staging
  4. push     — Push to GitHub (lock the safe)
  5. report   — Log to Notion and work log

Each stage can be run independently or as a full sequence.`,
	RunE: requireSubcommand,
}

// --- pipeline push ---

var pushProject string
var pushRemote string

var townPipelinePushCmd = &cobra.Command{
	Use:   "push",
	Short: "Push to GitHub (lock the safe)",
	Long:  "Push the current main branch to GitHub. This is the permanent record.",
	RunE:  runPipelinePush,
}

func runPipelinePush(cmd *cobra.Command, args []string) error {
	projectDir := pushProject
	if projectDir == "" {
		return fmt.Errorf("--project is required")
	}

	remote := pushRemote
	if remote == "" {
		remote = "origin"
	}

	// Verify we're on main
	branchCmd := exec.Command("git", "branch", "--show-current")
	branchCmd.Dir = projectDir
	branchOut, err := branchCmd.Output()
	if err != nil {
		return fmt.Errorf("checking branch: %w", err)
	}
	branch := strings.TrimSpace(string(branchOut))
	if branch != "main" && branch != "master" {
		return fmt.Errorf("not on main branch (on %q). Switch to main first", branch)
	}

	// Check for unpushed commits
	logCmd := exec.Command("git", "log", remote+"/"+branch+"..HEAD", "--oneline")
	logCmd.Dir = projectDir
	logOut, err := logCmd.Output()
	if err != nil {
		// Remote branch might not exist yet, push anyway
		fmt.Printf("   %s Could not compare with remote, pushing anyway\n", style.Dim.Render("⚠"))
	} else {
		lines := strings.Split(strings.TrimSpace(string(logOut)), "\n")
		if lines[0] == "" {
			fmt.Println("Nothing to push — already up to date with remote.")
			return nil
		}
		fmt.Printf("%s %d commit(s) to push:\n", style.Bold.Render("📦"), len(lines))
		for _, line := range lines {
			fmt.Printf("   %s\n", line)
		}
		fmt.Println()
	}

	// Push
	fmt.Printf("Pushing %s to %s/%s...\n", branch, remote, branch)
	pushCmd := exec.Command("git", "push", remote, branch)
	pushCmd.Dir = projectDir
	pushCmd.Stdout = os.Stdout
	pushCmd.Stderr = os.Stderr
	if err := pushCmd.Run(); err != nil {
		return fmt.Errorf("push failed: %w", err)
	}

	fmt.Printf("\n%s Pushed to GitHub. Safe locked.\n", style.Bold.Render("✓"))

	// Log to work log
	logToWorkLog(projectDir, "push", fmt.Sprintf("Pushed %s to %s/%s", branch, remote, branch))

	return nil
}

// --- pipeline deploy ---

var deployProject string
var deploySSHKey string
var deployHost string

var townPipelineDeployCmd = &cobra.Command{
	Use:   "deploy [apps...]",
	Short: "Build and deploy to staging",
	Long: `Build Docker images and deploy to the staging server.

Apps: api, web, tech-web, docs, mobile (defaults to api + web)

Example:
  gt town pipeline deploy --project ~/projects/copperhead api web`,
	RunE: runPipelineDeploy,
}

func runPipelineDeploy(cmd *cobra.Command, args []string) error {
	projectDir := deployProject
	if projectDir == "" {
		return fmt.Errorf("--project is required")
	}

	apps := args
	if len(apps) == 0 {
		apps = []string{"api", "web"}
	}

	host := deployHost
	if host == "" {
		host = "18.222.174.1"
	}

	sshKey := deploySSHKey
	if sshKey == "" {
		sshKey = filepath.Join(os.Getenv("HOME"), "Documents", "k3s-staging-key.pem")
	}

	for _, app := range apps {
		imageName := fmt.Sprintf("fieldops-%s", app)
		tag := "latest"

		fmt.Printf("%s Building %s...\n", style.Bold.Render("🔨"), imageName)

		// Build Docker image
		dockerFile := "Dockerfile"
		if app == "docs" {
			dockerFile = filepath.Join("apps", "docs", "Dockerfile")
		}

		buildCmd := exec.Command("docker", "build",
			"-t", fmt.Sprintf("%s:%s", imageName, tag),
			"-f", dockerFile,
			"--no-cache",
			".")
		buildCmd.Dir = projectDir
		buildCmd.Stdout = os.Stdout
		buildCmd.Stderr = os.Stderr
		if err := buildCmd.Run(); err != nil {
			return fmt.Errorf("docker build %s failed: %w", app, err)
		}

		// Save and transfer
		fmt.Printf("%s Transferring %s to staging...\n", style.Bold.Render("📤"), imageName)
		tarFile := fmt.Sprintf("/tmp/%s.tar", imageName)

		saveCmd := exec.Command("docker", "save", "-o", tarFile, fmt.Sprintf("%s:%s", imageName, tag))
		if err := saveCmd.Run(); err != nil {
			return fmt.Errorf("docker save %s failed: %w", app, err)
		}

		scpCmd := exec.Command("scp", "-i", sshKey, "-o", "StrictHostKeyChecking=no",
			tarFile, fmt.Sprintf("ubuntu@%s:/tmp/", host))
		scpCmd.Stdout = os.Stdout
		scpCmd.Stderr = os.Stderr
		if err := scpCmd.Run(); err != nil {
			return fmt.Errorf("scp %s failed: %w", app, err)
		}

		// Import and restart on remote
		fmt.Printf("%s Deploying %s on staging...\n", style.Bold.Render("🚀"), imageName)
		sshCmd := exec.Command("ssh", "-i", sshKey, "-o", "StrictHostKeyChecking=no",
			fmt.Sprintf("ubuntu@%s", host),
			fmt.Sprintf("sudo k3s ctr images import /tmp/%s.tar && kubectl set image deployment/%s %s=%s:%s -n fieldops",
				imageName, imageName, containerName(app), imageName, tag))
		sshCmd.Stdout = os.Stdout
		sshCmd.Stderr = os.Stderr
		if err := sshCmd.Run(); err != nil {
			return fmt.Errorf("deploy %s failed: %w", app, err)
		}

		fmt.Printf("   %s %s deployed\n", style.Bold.Render("✓"), imageName)
		os.Remove(tarFile)
	}

	logToWorkLog(deployProject, "deploy", fmt.Sprintf("Deployed %s to staging", strings.Join(apps, ", ")))

	fmt.Printf("\n%s All apps deployed to staging.\n", style.Bold.Render("✓"))
	return nil
}

// containerName maps app shorthand to k8s container name
func containerName(app string) string {
	switch app {
	case "docs":
		return "docs"
	default:
		return "fieldops-" + app
	}
}

// --- pipeline report ---

var reportWave string
var reportTitle string
var reportProject string

var townPipelineReportCmd = &cobra.Command{
	Use:   "report",
	Short: "Log wave completion to work log",
	RunE:  runPipelineReport,
}

func runPipelineReport(cmd *cobra.Command, args []string) error {
	wave := reportWave
	title := reportTitle
	if wave == "" {
		return fmt.Errorf("--wave is required")
	}

	detail := fmt.Sprintf("Wave %s complete: %s", wave, title)
	logToWorkLog(reportProject, "report", detail)

	fmt.Printf("%s %s\n", style.Bold.Render("✓"), detail)
	return nil
}

// --- registration ---

func init() {
	townPipelinePushCmd.Flags().StringVar(&pushProject, "project", "", "Project directory")
	townPipelinePushCmd.Flags().StringVar(&pushRemote, "remote", "origin", "Git remote name")

	townPipelineDeployCmd.Flags().StringVar(&deployProject, "project", "", "Project directory")
	townPipelineDeployCmd.Flags().StringVar(&deploySSHKey, "ssh-key", "", "SSH key for staging server")
	townPipelineDeployCmd.Flags().StringVar(&deployHost, "host", "", "Staging server host (default: 18.222.174.1)")

	townPipelineReportCmd.Flags().StringVar(&reportWave, "wave", "", "Wave number")
	townPipelineReportCmd.Flags().StringVar(&reportTitle, "title", "", "Wave title")
	townPipelineReportCmd.Flags().StringVar(&reportProject, "project", "", "Project directory (for work log)")

	townPipelineCmd.AddCommand(townPipelinePushCmd)
	townPipelineCmd.AddCommand(townPipelineDeployCmd)
	townPipelineCmd.AddCommand(townPipelineReportCmd)
	townCmd.AddCommand(townPipelineCmd)
}

// logToWorkLog is a helper that appends to the accountability work log.
func logToWorkLog(projectDir, action, detail string) {
	// Find town dir by walking up from project dir or using GT env
	townDir, err := findTownDir()
	if err != nil {
		return
	}

	store, err := accountability.NewStore(filepath.Join(townDir, "accountability"))
	if err != nil {
		return
	}

	agent := os.Getenv("GT_ROLE")
	if agent == "" {
		agent = "mayor"
	}

	store.AppendWorkLog(accountability.WorkLogEntry{
		Agent:     agent,
		Action:    action,
		Detail:    detail,
		Timestamp: time.Now(),
	})
}
