"""CPU バウンドな /cpu が、同じ実行環境の /ping をどれだけ待たせるかを測る。

/cpu を投げてから --delay-ms 後に /ping を投げ、/ping のレイテンシをクライアント側で測る。
Web Functions は環境を 1 つに固定できないので、/ping と /cpu の envId が同じだった組（相乗り）を分けて集計する。
画面 (app-cpu-ui) と同じ計測を CLI で行う。標準ライブラリだけで動くので、CloudShell にそのまま持ち込める。

例:
  python3 scripts/cpu-bench.py http://127.0.0.1:3101 ping idle full
  python3 scripts/cpu-bench.py https://xxxx.cloudfront.net/go ping idle full
"""

import argparse
import http.client
import json
import statistics
import threading
import time
from urllib.parse import urlsplit

# パターン名: 投げる /cpu の数。ping は /cpu を投げずに /ping だけを測る。
# idle は空いている環境が残る状態、full は /cpu を 2 本ずらして送り、両方の環境（maxEnvironments=2）を埋めた状態
PATTERNS = {"ping": 0, "idle": 1, "full": 2}


class Client:
    """keep-alive の接続を 1 本持ち、切れていたら張り直す。TLS の握手をレイテンシに含めないため"""

    def __init__(self, base):
        url = urlsplit(base)
        self.https = url.scheme == "https"
        self.host = url.netloc
        self.prefix = url.path.rstrip("/")
        self.conn = None

    def get(self, path):
        for attempt in range(2):
            if self.conn is None:
                cls = http.client.HTTPSConnection if self.https else http.client.HTTPConnection
                self.conn = cls(self.host, timeout=30)
            try:
                start = time.perf_counter()
                self.conn.request("GET", self.prefix + path)
                res = self.conn.getresponse()
                body = res.read()
                ms = (time.perf_counter() - start) * 1000
                # lambda-web-logstream は Lambda が応答に付ける、実行環境ごとのログストリーム名。
                # アプリが返す envId とは別に、Lambda 側から見て同じ環境かを確かめるのに使う。ローカルでは付かない
                return {
                    **json.loads(body),
                    "status": res.status,
                    "rttMs": ms,
                    "logStream": res.getheader("lambda-web-logstream"),
                }
            except (http.client.HTTPException, OSError, json.JSONDecodeError):
                self.conn.close()
                self.conn = None
                if attempt == 1:
                    raise


def trial(ping_client, cpu_clients, cpu_path, delay, gap):
    cpus = [None] * len(cpu_clients)

    def run(i):
        cpus[i] = cpu_clients[i].get(cpu_path)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(cpu_clients))]
    for i, t in enumerate(threads):
        # 2 本目は gap ずらす。Lambda は空いている環境に回すので、各環境に 1 本ずつ入る
        if i > 0:
            time.sleep(gap)
        t.start()
    if threads:
        time.sleep(delay)
    ping = ping_client.get("/ping")
    for t in threads:
        t.join()
    same = [c for c in cpus if c["envId"] == ping["envId"]]
    same_log_stream = None
    if cpus and ping["logStream"]:
        same_log_stream = any(c["logStream"] == ping["logStream"] for c in cpus)
    return {
        "ping": ping,
        "cpus": cpus,
        "sameEnv": bool(same) if cpus else None,
        # /cpu が別々の環境に入ったか。full で両方の環境を埋められたかの確認に使う
        "split": len({c["envId"] for c in cpus}) == len(cpus) if len(cpus) > 1 else None,
        "sameLogStream": same_log_stream,
        # 同じ環境の /cpu が終わってから /ping のハンドラーが動いたか。サーバーの時計どうしで比べる
        "waited": any(ping["receivedAt"] >= c["finishedAt"] for c in same) if same else None,
    }


def describe(n, r):
    """1 試行を 1 行にする。envId と logstream の両方で、/ping が /cpu と相乗りしたかを見せる"""
    ping = r["ping"]
    line = f"  #{n:02d} /ping {ping['rttMs']:6.1f}ms env={ping['envId'][:8]}"
    for c in r["cpus"]:
        line += f" | /cpu {c['ms']:4d}ms env={c['envId'][:8]}"
    if r["cpus"]:
        line += f" | {'相乗り' if r['sameEnv'] else '別の環境'}"
        if r["sameLogStream"] is not None and r["sameLogStream"] != r["sameEnv"]:
            line += " ← envId と logstream が食い違い"
        if r["split"] is False:
            line += " | /cpu が片方の環境に 2 本"
        if r["waited"]:
            line += " | /cpu の終了を待った"
    if ping["logStream"]:
        line += f" | {ping['logStream'].rsplit(']', 1)[-1][:12]}"
    return line


def stats(values):
    if not values:
        return "-"
    values = sorted(values)
    p95 = values[max(0, round(len(values) * 0.95) - 1)]
    return f"p50 {statistics.median(values):6.1f} / p95 {p95:6.1f} / max {values[-1]:6.1f} ms (n={len(values)})"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base", help="例: https://xxxx.cloudfront.net/node")
    parser.add_argument("patterns", nargs="+", choices=PATTERNS)
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--cpu-ms", type=int, default=500, help="/cpu が CPU を回す時間")
    parser.add_argument("--gap-ms", type=float, default=50, help="full で 2 本目の /cpu をずらす時間")
    parser.add_argument("--delay-ms", type=float, default=15)
    parser.add_argument("--interval-ms", type=float, default=500, help="試行の間隔。前の試行の影響を残さないため")
    parser.add_argument("--out", help="生データを JSON Lines で書き出す")
    args = parser.parse_args()

    info = Client(args.base).get("/info")
    print(f"base={args.base} cpu={args.cpu_ms}ms delay={args.delay_ms}ms runs={args.runs} info={json.dumps(info)}")
    out = open(args.out, "a") if args.out else None
    cpu_path = f"/cpu?ms={args.cpu_ms}"

    for name in args.patterns:
        count = PATTERNS[name]
        ping_client = Client(args.base)
        cpu_clients = [Client(args.base) for _ in range(count)]
        # 温める。接続を張り、環境を起こしておく
        for _ in range(args.warmup):
            trial(ping_client, cpu_clients, cpu_path, args.delay_ms / 1000, args.gap_ms / 1000)
            time.sleep(args.interval_ms / 1000)

        print(f"\n== {name}")
        results = []
        for n in range(1, args.runs + 1):
            r = trial(ping_client, cpu_clients, cpu_path, args.delay_ms / 1000, args.gap_ms / 1000)
            results.append(r)
            print(describe(n, r))
            if out:
                out.write(json.dumps({"base": args.base, "pattern": name, **r}) + "\n")
            time.sleep(args.interval_ms / 1000)

        print(f"  /ping 全体     {stats([r['ping']['rttMs'] for r in results])}")
        if count:
            same = [r for r in results if r["sameEnv"]]
            other = [r for r in results if not r["sameEnv"]]
            waited = sum(1 for r in same if r["waited"])
            print(f"  相乗り         {len(same)}/{len(results)} 件、うち /cpu の終了を待った {waited} 件")
            if count > 1:
                split = sum(1 for r in results if r["split"])
                print(f"  両方の環境が処理中 {split}/{len(results)} 件")
            checked = [r for r in results if r["sameLogStream"] is not None]
            if checked:
                agreed = sum(1 for r in checked if r["sameLogStream"] == r["sameEnv"])
                print(f"  logstream     envId の判定と一致 {agreed}/{len(checked)} 件")
            print(f"  /ping 相乗り   {stats([r['ping']['rttMs'] for r in same])}")
            print(f"  /ping 別の環境 {stats([r['ping']['rttMs'] for r in other])}")
            print(f"  /cpu 処理時間  {stats([c['ms'] for r in results for c in r['cpus']])}")
    if out:
        out.close()


if __name__ == "__main__":
    main()
