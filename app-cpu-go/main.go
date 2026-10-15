// CPU バウンドなリクエストが、同じ実行環境のほかのリクエストを待たせるかを確かめる。
// goroutine はランタイムがプリエンプトするので、CPU を回している最中もほかのリクエストに応答できるはず
package main

import (
	"crypto/rand"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"time"
)

// 実行環境ごとの ID。プロセスは実行環境ごとに 1 つなので、起動時に作った ID で環境を見分けられる
var envID = rand.Text()

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"envId": envID, "receivedAt": now()})
	})
	mux.HandleFunc("GET /info", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{
			"envId":      envID,
			"numCPU":     runtime.NumCPU(),
			"gomaxprocs": runtime.GOMAXPROCS(0),
		})
	})
	// Node.js 版と同じく、指定した時間だけループで CPU を回す
	mux.HandleFunc("GET /cpu", func(w http.ResponseWriter, r *http.Request) {
		receivedAt := now()
		ms, err := strconv.Atoi(r.URL.Query().Get("ms"))
		if err != nil || ms < 1 {
			ms = 100
		}
		ms = min(ms, 5000)
		start := time.Now()
		loops := 0
		for time.Since(start) < time.Duration(ms)*time.Millisecond {
			loops++
		}
		writeJSON(w, map[string]any{
			"envId":      envID,
			"receivedAt": receivedAt,
			"finishedAt": now(),
			"ms":         time.Since(start).Milliseconds(),
			"loops":      loops,
		})
	})

	// CloudFront は /go/* をこの関数に回す。ローカルでは接頭辞なしでも呼べるようにする
	root := http.NewServeMux()
	root.Handle("/go/", http.StripPrefix("/go", mux))
	root.Handle("/", mux)

	// Lambda が AWS_LAMBDA_HTTP_ENDPOINT (host:port) で待ち受け先を渡す。未設定はローカル実行時のみ
	addr := os.Getenv("AWS_LAMBDA_HTTP_ENDPOINT")
	if addr == "" {
		addr = "localhost:3000"
	}
	log.Printf("listening on %s (envId=%s)", addr, envID)
	log.Fatal(http.ListenAndServe(addr, root))
}

func now() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("content-type", "application/json")
	json.NewEncoder(w).Encode(body)
}
