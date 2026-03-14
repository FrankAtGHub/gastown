package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/FrankAtGHub/night-city/internal/engine/addons"
	"github.com/FrankAtGHub/night-city/internal/engine/addons/email"
	"github.com/FrankAtGHub/night-city/internal/engine/addons/telegram"
	"github.com/FrankAtGHub/night-city/internal/style"
)

var townConnectCmd = &cobra.Command{
	Use:   "connect <channel> [config...]",
	Short: "Connect an external communication channel",
	Long: `Wire the human operator to their agents via external channels.

Channels:
  telegram <bot-token> <chat-id>    — Connect Telegram bot
  email <smtp-host> <from-addr>     — Connect email notifications

Examples:
  gt town connect telegram 123456:ABC-DEF -123456789
  gt town connect email smtp.gmail.com alerts@company.com --port 587 --user user --pass secret`,
	Args: cobra.MinimumNArgs(1),
	RunE: runTownConnect,
}

var connectEmailPort int
var connectEmailUser string
var connectEmailPass string
var connectEmailFromName string

func init() {
	townConnectCmd.Flags().IntVar(&connectEmailPort, "port", 587, "SMTP port")
	townConnectCmd.Flags().StringVar(&connectEmailUser, "user", "", "SMTP username")
	townConnectCmd.Flags().StringVar(&connectEmailPass, "pass", "", "SMTP password")
	townConnectCmd.Flags().StringVar(&connectEmailFromName, "from-name", "Night City", "Email from name")
	townCmd.AddCommand(townConnectCmd)
}

func runTownConnect(cmd *cobra.Command, args []string) error {
	townDir, err := findTownDir()
	if err != nil {
		return err
	}

	channel := strings.ToLower(args[0])

	switch channel {
	case "telegram":
		return connectTelegram(townDir, args[1:])
	case "email":
		return connectEmail(townDir, args[1:])
	default:
		return fmt.Errorf("unknown channel %q (supported: telegram, email)", channel)
	}
}

func connectTelegram(townDir string, args []string) error {
	if len(args) < 2 {
		return fmt.Errorf("usage: gt town connect telegram <bot-token> <chat-id>")
	}

	cfg := telegram.Config{
		BotToken: args[0],
		ChatID:   args[1],
		Enabled:  true,
	}

	if err := addons.SaveAddonConfig(townDir, "telegram", cfg); err != nil {
		return err
	}

	fmt.Printf("%s Telegram connected\n", style.Bold.Render("✓"))
	fmt.Printf("   Bot token: %s...%s\n", cfg.BotToken[:6], cfg.BotToken[len(cfg.BotToken)-4:])
	fmt.Printf("   Chat ID:   %s\n", cfg.ChatID)
	return nil
}

func connectEmail(townDir string, args []string) error {
	if len(args) < 2 {
		return fmt.Errorf("usage: gt town connect email <smtp-host> <from-addr> [--port 587] [--user user] [--pass pass]")
	}

	cfg := email.Config{
		SMTPHost: args[0],
		SMTPPort: connectEmailPort,
		Username: connectEmailUser,
		Password: connectEmailPass,
		FromAddr: args[1],
		FromName: connectEmailFromName,
		Enabled:  true,
	}

	if err := addons.SaveAddonConfig(townDir, "email", cfg); err != nil {
		return err
	}

	fmt.Printf("%s Email connected\n", style.Bold.Render("✓"))
	fmt.Printf("   SMTP: %s:%d\n", cfg.SMTPHost, cfg.SMTPPort)
	fmt.Printf("   From: %s <%s>\n", cfg.FromName, cfg.FromAddr)
	return nil
}
