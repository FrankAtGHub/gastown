// Package email provides email identity and notification capabilities for agents.
//
// Each agent can have an email identity for sending notifications,
// reports, and alerts to human operators or external systems.
package email

import (
	"fmt"
	"net/smtp"
	"strings"
)

// Config holds email server configuration.
type Config struct {
	SMTPHost string `yaml:"smtp_host"`
	SMTPPort int    `yaml:"smtp_port"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
	FromName string `yaml:"from_name"`
	FromAddr string `yaml:"from_addr"`
	Enabled  bool   `yaml:"enabled"`
}

// Sender handles sending emails from agents.
type Sender struct {
	config Config
}

// NewSender creates an email sender.
func NewSender(cfg Config) *Sender {
	return &Sender{config: cfg}
}

// Send sends an email.
func (s *Sender) Send(to []string, subject, body string) error {
	if !s.config.Enabled {
		return nil
	}

	from := fmt.Sprintf("%s <%s>", s.config.FromName, s.config.FromAddr)

	msg := strings.Join([]string{
		fmt.Sprintf("From: %s", from),
		fmt.Sprintf("To: %s", strings.Join(to, ", ")),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		body,
	}, "\r\n")

	addr := fmt.Sprintf("%s:%d", s.config.SMTPHost, s.config.SMTPPort)
	auth := smtp.PlainAuth("", s.config.Username, s.config.Password, s.config.SMTPHost)

	return smtp.SendMail(addr, auth, s.config.FromAddr, to, []byte(msg))
}

// SendAlert sends a formatted alert email.
func (s *Sender) SendAlert(to []string, agent, alertMsg string) error {
	subject := fmt.Sprintf("[Night City] ALERT: %s", agent)
	body := fmt.Sprintf("Agent: %s\nAlert: %s\n\nThis is an automated alert from Night City.", agent, alertMsg)
	return s.Send(to, subject, body)
}

// SendDailySummary sends a daily work summary for an agent.
func (s *Sender) SendDailySummary(to []string, agent string, entries []string) error {
	subject := fmt.Sprintf("[Night City] Daily Summary: %s", agent)
	body := fmt.Sprintf("Daily work log for %s:\n\n%s", agent, strings.Join(entries, "\n"))
	return s.Send(to, subject, body)
}
