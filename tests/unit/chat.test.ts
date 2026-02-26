import http from "k6/http";
import { check, sleep } from "k6";
import { Options } from "k6/options";

/**
 * Requirement 76: Automated Load Testing
 * Analyzes /chat endpoint behavior under high concurrency.
 */
export const options: Options = {
  stages: [
    { duration: "1m", target: 20 }, // Ramp-up to 20 users
    { duration: "3m", target: 20 }, // Stay at 20 users
    { duration: "1m", target: 100 }, // Stress test spike
    { duration: "1m", target: 0 }, // Cool down
  ],
  thresholds: {
    // 95% of requests must be under 2s (Requirement: High Concurrency Analysis)
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.API_URL || "http://localhost:3000";

export default function () {
  const url = `${BASE_URL}/chat`;

  const payload = JSON.stringify({
    message: "Simulated load test message for ChenPilot",
    network: "testnet",
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const res = http.post(url, payload, params);

  // Requirement: Analyze behavior under high concurrency
  check(res, {
    "status is 200": (r) => r.status === 200,
    "transaction-latency-acceptable": (r) => r.timings.duration < 2500,
  });

  sleep(1);
}
