use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::HeaderMap,
    response::{
        Html,
        sse::{Event, Sse},
    },
    routing::{get, post},
};
use chrono::{SecondsFormat, Utc};
use futures::stream::{self, Stream};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use uuid::Uuid;

// 実行環境ごとの情報。プロセスは実行環境ごとに 1 つなので、起動時に作った ID で環境を見分けられる
struct Environment {
    id: String,
    started_at: String,
    echo_count: AtomicU64,
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let env = Arc::new(Environment {
        id: Uuid::new_v4().to_string(),
        started_at: now(),
        echo_count: AtomicU64::new(0),
    });

    // Lambda が AWS_LAMBDA_HTTP_ENDPOINT (host:port) で待ち受け先を渡す。未設定はローカル実行時のみ
    let addr =
        std::env::var("AWS_LAMBDA_HTTP_ENDPOINT").unwrap_or_else(|_| "localhost:3000".into());
    let listener = TcpListener::bind(&addr).await?;
    println!("listening on {} (envId={})", listener.local_addr()?, env.id);

    let app = Router::new()
        .route("/", get(index))
        .route("/echo", post(echo))
        .route("/stream", get(sse))
        .with_state(env);
    axum::serve(listener, app).await
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

// SSE と POST をブラウザから試す画面。バイナリに埋め込み、Web Function だけで配信する
async fn index() -> Html<&'static str> {
    Html(include_str!("index.html"))
}

// CloudFront (OAC) 経由の POST で body がそのまま届くかを確認する。
// 連続で呼んだときに同じ実行環境が応答しているかを見るため、環境の ID とこの環境での通し番号も返す
async fn echo(State(env): State<Arc<Environment>>, headers: HeaderMap, body: Bytes) -> Json<Value> {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    Json(json!({
        "bytes": body.len(),
        "sha256": hex::encode(Sha256::digest(&body)),
        "contentType": header("content-type"),
        "requestId": header("lambda-web-request-id"),
        "envId": env.id,
        "envStartedAt": env.started_at,
        "echoCount": env.echo_count.fetch_add(1, Ordering::Relaxed) + 1,
    }))
}

// レスポンスストリーミングを確認する。1 秒おきに 5 件送って閉じる
async fn sse() -> Sse<impl Stream<Item = Result<Event, axum::Error>>> {
    Sse::new(stream::unfold(0, |i| async move {
        if i == 5 {
            return None;
        }
        if i > 0 {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Some((
            Event::default().json_data(json!({ "i": i, "time": now() })),
            i + 1,
        ))
    }))
}
