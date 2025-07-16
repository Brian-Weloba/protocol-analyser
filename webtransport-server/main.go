package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"crypto/tls"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

var (
	connections = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "wt_active_connections",
		Help: "Number of active WebTransport connections.",
	})
	latency = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "wt_action_latency_seconds",
		Help:    "Latency for processing a WebTransport action.",
		Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1},
	})
)

type PingMessage struct {
	Type      string `json:"type"`
	Timestamp int64  `json:"timestamp"`
}

func main() {
	go func() {
		http.Handle("/metrics", promhttp.Handler())
		log.Println("[Metrics] Metrics server listening on :8001")
		if err := http.ListenAndServe(":8001", nil); err != nil {
			log.Fatalf("[Metrics] Failed to start metrics server: %v", err)
		}
	}()

	// Load TLS cert and key
	cert, err := tls.LoadX509KeyPair("cert.pem", "key.pem")
	if err != nil {
		log.Fatalf("Failed to load TLS certificate: %v", err)
	}

	s := webtransport.Server{
		H3:          http3.Server{
			Addr: ":8000",
			TLSConfig: &tls.Config{
				Certificates: []tls.Certificate{cert},
				NextProtos:   []string{"h3"},
			},
		},
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	http.HandleFunc("/webtransport", func(w http.ResponseWriter, r *http.Request) {
		conn, err := s.Upgrade(w, r)
		if err != nil {
			log.Printf("[WT] Upgrading failed: %s", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		connections.Inc()
		log.Printf("[WT] Client connected")
		go handleSession(conn)
	})

	log.Println("[WT] WebTransport server listening on :8000")
	if err := s.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func handleSession(conn *webtransport.Session) {
	defer conn.CloseWithError(0, "Session closed")
	defer connections.Dec()
	defer log.Println("[WT] Client disconnected")

	for {
		stream, err := conn.AcceptUniStream(context.Background())
		if err != nil {
			log.Printf("[WT] Error accepting stream: %s", err)
			return
		}
		go handleStream(conn, *stream)
	}
}

func handleStream(conn *webtransport.Session, r webtransport.ReceiveStream) {
	buf, err := io.ReadAll(&r)
	if err != nil {
		log.Printf("[WT] Error reading from stream: %s", err)
		return
	}

	timer := prometheus.NewTimer(latency)
	defer timer.ObserveDuration()

	var msg PingMessage
	if err := json.Unmarshal(buf, &msg); err != nil {
		return
	}

	if msg.Type == "ping" {
		s, err := conn.OpenUniStream()
		if err != nil {
			return
		}
		response, _ := json.Marshal(PingMessage{Type: "pong", Timestamp: msg.Timestamp})
		_, err = s.Write(response)
		if err != nil {
			return
		}
		s.Close()
	}
}
