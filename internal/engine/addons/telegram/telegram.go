// Package telegram implements a Telegram bot bridge for Night City.
//
// Allows agents to send/receive messages via Telegram, and lets the
// human operator interact with agents from their phone.
//
// Features:
//   - Agent status notifications to a Telegram chat/group
//   - Human commands via Telegram (e.g., /status, /stop <agent>)
//   - Dead man's switch alerts forwarded to Telegram
//   - Work log summaries on demand
package telegram

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/FrankAtGHub/night-city/internal/engine/accountability"
	"github.com/FrankAtGHub/night-city/internal/engine/launcher"
)

// Config holds Telegram bot configuration.
type Config struct {
	BotToken string `yaml:"bot_token"` // Telegram Bot API token
	ChatID   string `yaml:"chat_id"`   // Target chat/group ID
	Enabled  bool   `yaml:"enabled"`
}

// Bot is the Telegram bridge.
type Bot struct {
	config  Config
	store   *accountability.Store
	manager *launcher.Manager
	baseURL string
}

// NewBot creates a Telegram bot bridge.
func NewBot(cfg Config, store *accountability.Store, mgr *launcher.Manager) *Bot {
	return &Bot{
		config:  cfg,
		store:   store,
		manager: mgr,
		baseURL: fmt.Sprintf("https://api.telegram.org/bot%s", cfg.BotToken),
	}
}

// SendMessage sends a text message to the configured chat.
func (b *Bot) SendMessage(text string) error {
	if !b.config.Enabled || b.config.BotToken == "" {
		return nil
	}

	params := url.Values{
		"chat_id":    {b.config.ChatID},
		"text":       {text},
		"parse_mode": {"Markdown"},
	}

	resp, err := http.PostForm(b.baseURL+"/sendMessage", params)
	if err != nil {
		return fmt.Errorf("telegram send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("telegram API error %d: %s", resp.StatusCode, body)
	}
	return nil
}

// NotifyAlert sends a dead man's switch or escalation alert.
func (b *Bot) NotifyAlert(agent, message string) error {
	text := fmt.Sprintf("🚨 *ALERT* — %s\n%s\n_%s_", agent, message, time.Now().Format("15:04:05"))
	return b.SendMessage(text)
}

// NotifyStatus sends a status summary of all agents.
func (b *Bot) NotifyStatus(personas []*launcher.Persona) error {
	var lines []string
	lines = append(lines, "📊 *Town Status*")

	for _, p := range personas {
		hb, err := b.store.ReadHeartbeat(p.Name)
		status := "⚪ unknown"
		if err == nil {
			age := time.Since(hb.Timestamp)
			switch {
			case age > 5*time.Minute:
				status = fmt.Sprintf("🟡 STALE (%s ago)", age.Round(time.Second))
			case hb.State == "working":
				status = fmt.Sprintf("🟢 working: %s", hb.Task)
			case hb.State == "idle":
				status = "🔵 idle"
			case hb.State == "stuck":
				status = fmt.Sprintf("🔴 STUCK: %s", hb.Task)
			default:
				status = fmt.Sprintf("⚪ %s", hb.State)
			}
		}
		lines = append(lines, fmt.Sprintf("  *%s* — %s", p.Name, status))
	}

	lines = append(lines, fmt.Sprintf("\n_%s_", time.Now().Format("2006-01-02 15:04:05")))
	return b.SendMessage(strings.Join(lines, "\n"))
}

// Update represents a Telegram update (incoming message).
type Update struct {
	UpdateID int `json:"update_id"`
	Message  *TelegramMessage `json:"message"`
}

// TelegramMessage is a Telegram message.
type TelegramMessage struct {
	MessageID int    `json:"message_id"`
	Text      string `json:"text"`
	Chat      struct {
		ID int64 `json:"id"`
	} `json:"chat"`
	From struct {
		Username string `json:"username"`
	} `json:"from"`
}

// PollUpdates long-polls for Telegram commands and dispatches them.
func (b *Bot) PollUpdates(ctx context.Context) error {
	if !b.config.Enabled {
		return nil
	}

	offset := 0
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		updates, err := b.getUpdates(offset)
		if err != nil {
			time.Sleep(5 * time.Second)
			continue
		}

		for _, u := range updates {
			offset = u.UpdateID + 1
			if u.Message != nil && strings.HasPrefix(u.Message.Text, "/") {
				b.handleCommand(u.Message)
			}
		}
	}
}

func (b *Bot) getUpdates(offset int) ([]Update, error) {
	resp, err := http.Get(fmt.Sprintf("%s/getUpdates?offset=%d&timeout=30", b.baseURL, offset))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool     `json:"ok"`
		Result []Update `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result.Result, nil
}

func (b *Bot) handleCommand(msg *TelegramMessage) {
	parts := strings.Fields(msg.Text)
	if len(parts) == 0 {
		return
	}

	switch parts[0] {
	case "/status":
		personas, _ := launcher.LoadAllPersonas("")
		b.NotifyStatus(personas)

	case "/stop":
		if len(parts) < 2 {
			b.SendMessage("Usage: /stop <agent-name>")
			return
		}
		if b.manager != nil {
			if err := b.manager.Stop(parts[1]); err != nil {
				b.SendMessage(fmt.Sprintf("Failed to stop %s: %v", parts[1], err))
			} else {
				b.SendMessage(fmt.Sprintf("✓ Stopped %s", parts[1]))
			}
		}

	case "/help":
		b.SendMessage("*Night City Bot Commands:*\n/status — Show agent status\n/stop <name> — Stop an agent\n/help — This message")

	default:
		b.SendMessage(fmt.Sprintf("Unknown command: %s\nTry /help", parts[0]))
	}
}
