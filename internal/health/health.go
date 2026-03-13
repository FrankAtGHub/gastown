// Package health provides reusable health check functions for Night City.
package health

import (
	"net"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// TCPCheck performs a TCP connection check to host:port.
func TCPCheck(host string, port int, timeout time.Duration) bool {
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// DirSize calculates the total size of files in a directory recursively.
func DirSize(path string) (int64, error) {
	var size int64
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size, err
}
