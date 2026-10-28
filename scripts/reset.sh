#!/usr/bin/env bash
# Reset the whole lab to its seeded state: restarts stopped containers, clears faults,
# purges queues, re-seeds every service's data and flushes the cache.
set -euo pipefail
LAB_URL="${LAB_URL:-http://localhost:8081}"
curl -fsS -X POST "$LAB_URL/lab/api/reset" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const r = JSON.parse(s);
    for (const step of r.report) console.log(`${step.ok ? "✓" : "✗"} ${step.step}${step.ok ? "" : ": " + step.detail}`);
    console.log(r.ok ? "\nLab reset complete." : "\nReset finished with warnings.");
  });'
