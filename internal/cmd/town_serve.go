package cmd

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/engine/accountability"
	"github.com/FrankAtGHub/night-city/internal/engine/workflows"
	"github.com/FrankAtGHub/night-city/internal/style"
	"github.com/FrankAtGHub/night-city/internal/web"
)

var townServeAddr string
var townServeInngestPort string

var townServeCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the town engine (dashboard + Inngest workflows)",
	Long: `Start the full Night City town engine:
  - HTMX+SSE dashboard for real-time agent monitoring
  - Inngest function server for durable workflows (dead man's switch, pipelines)

The Inngest dev server should be started separately:
  npx inngest-cli@latest dev -u http://localhost:8421/api/inngest

This command starts the function server that Inngest discovers and invokes.`,
	RunE: runTownServe,
}

func init() {
	townServeCmd.Flags().StringVar(&townServeAddr, "addr", "localhost:8420", "Dashboard listen address")
	townServeCmd.Flags().StringVar(&townServeInngestPort, "inngest-port", "8421", "Inngest function server port")
	townCmd.AddCommand(townServeCmd)
}

func runTownServe(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	// Set up accountability store
	store, err := accountability.NewStore(filepath.Join(townDir, "accountability"))
	if err != nil {
		return fmt.Errorf("accountability store: %w", err)
	}

	// Set up Inngest workflow engine
	engine, err := workflows.NewEngine(store)
	if err != nil {
		return fmt.Errorf("workflow engine: %w", err)
	}

	// Create context with signal handling
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Println("\nShutting down...")
		cancel()
	}()

	// Start Inngest function server using client.Serve()
	inngestHandler := engine.Client().Serve()

	inngestMux := http.NewServeMux()
	inngestMux.Handle("/api/inngest", inngestHandler)

	inngestAddr := "localhost:" + townServeInngestPort
	inngestSrv := &http.Server{Addr: inngestAddr, Handler: inngestMux}

	go func() {
		fmt.Printf("%s Inngest functions: http://%s/api/inngest\n", style.Bold.Render("⚡"), inngestAddr)
		if err := inngestSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "Inngest server error: %v\n", err)
		}
	}()

	go func() {
		<-ctx.Done()
		inngestSrv.Close()
	}()

	// Start dashboard
	dashSrv, err := web.NewServer(townDir, townServeAddr)
	if err != nil {
		return fmt.Errorf("dashboard: %w", err)
	}

	fmt.Printf("%s Dashboard:  http://%s\n", style.Bold.Render("📊"), townServeAddr)
	fmt.Println()
	fmt.Println("Start the Inngest dev server in another terminal:")
	fmt.Printf("  npx inngest-cli@latest dev -u http://%s/api/inngest\n", inngestAddr)
	fmt.Println()

	return dashSrv.Start(ctx)
}
