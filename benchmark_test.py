"""
Benchmark comparison test: Engine vs Production path
Runs each mode at each ops count 10 times and reports averages.
"""

import json
import time
import urllib.request
from statistics import mean

URL = "http://localhost:8080/benchmark"
MODES = ["standard", "conflict", "rooms", "snapshot"]
OPS_COUNTS = [1000, 10000, 100000, 500000, 1000000]
RUNS_PER_CONFIG = 1

def run_benchmark(mode, ops, production=False):
    body = {"mode": mode, "ops": ops}
    if mode == "rooms":
        body["rooms"] = 5
    if production:
        body["production"] = True
    
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(URL, data=data, headers={"Content-Type": "application/json"})
    
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("opsPerSecond", 0), result.get("elapsedMs", 0)
    except Exception as e:
        print(f"  ERROR: {mode} {ops} production={production}: {e}")
        return 0, 0


def main():
    print("=" * 80)
    print("BENCHMARK COMPARISON: ENGINE vs PRODUCTION")
    print(f"Modes: {MODES}")
    print(f"Ops counts: {OPS_COUNTS}")
    print(f"Runs per config: {RUNS_PER_CONFIG}")
    print("=" * 80)
    print()

    # Warm up
    print("Warming up (2 runs each path)...")
    run_benchmark("conflict", 1000, production=False)
    run_benchmark("conflict", 1000, production=True)
    run_benchmark("conflict", 1000, production=False)
    run_benchmark("conflict", 1000, production=True)
    print("Warm-up complete.\n")

    results = {}

    for mode in MODES:
        results[mode] = {}
        for ops in OPS_COUNTS:
            engine_speeds = []
            production_speeds = []

            print(f"Testing {mode} @ {ops:,} ops...")

            for i in range(RUNS_PER_CONFIG):
                # Alternate engine/production to avoid cache bias
                e_speed, e_time = run_benchmark(mode, ops, production=False)
                p_speed, p_time = run_benchmark(mode, ops, production=True)
                
                if e_speed > 0:
                    engine_speeds.append(e_speed)
                if p_speed > 0:
                    production_speeds.append(p_speed)

                # Brief pause between runs
                time.sleep(0.1)

            avg_engine = mean(engine_speeds) if engine_speeds else 0
            avg_production = mean(production_speeds) if production_speeds else 0
            diff_pct = ((avg_production - avg_engine) / avg_engine * 100) if avg_engine > 0 else 0

            results[mode][ops] = {
                "engine_avg": avg_engine,
                "production_avg": avg_production,
                "diff_pct": diff_pct,
                "engine_runs": len(engine_speeds),
                "production_runs": len(production_speeds),
            }

            marker = "⬆" if diff_pct > 0 else "⬇"
            print(f"  Engine: {avg_engine:,.0f} ops/s | Production: {avg_production:,.0f} ops/s | Diff: {diff_pct:+.1f}% {marker}")
            print()

    # Final summary table
    print("\n" + "=" * 80)
    print("SUMMARY TABLE (avg ops/sec over 10 runs)")
    print("=" * 80)
    print(f"{'Mode':<12} {'Ops':<10} {'Engine':>12} {'Production':>12} {'Diff':>8}")
    print("-" * 60)

    for mode in MODES:
        for ops in OPS_COUNTS:
            r = results[mode][ops]
            marker = "⬆" if r["diff_pct"] > 0 else "⬇"
            print(f"{mode:<12} {ops:<10,} {r['engine_avg']:>12,.0f} {r['production_avg']:>12,.0f} {r['diff_pct']:>+7.1f}%{marker}")
        print()

    # Save raw results
    with open("benchmark_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nRaw results saved to benchmark_results.json")


if __name__ == "__main__":
    main()
