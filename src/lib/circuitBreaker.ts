// ---------------------------------------------------------------------------
// Circuit Breaker — lightweight state machine for AI provider failover
// States: CLOSED (healthy) → OPEN (failing) → HALF_OPEN (probing recovery)
// ---------------------------------------------------------------------------

import { logger } from "../utils/logger.js";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 30_000; // 30s before probing recovery
const SUCCESS_THRESHOLD = 2; // successes in HALF_OPEN to close

interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number;
  probeInFlight: boolean;
}

const circuits = new Map<string, CircuitStats>();

function getCircuit(key: string): CircuitStats {
  let circuit = circuits.get(key);
  if (!circuit) {
    circuit = {
      state: "CLOSED",
      failures: 0,
      successes: 0,
      lastFailureAt: 0,
      probeInFlight: false,
    };
    circuits.set(key, circuit);
  }
  return circuit;
}

/**
 * Check if the circuit allows requests through.
 * Transitions OPEN → HALF_OPEN after resetTimeout.
 */
export function isCircuitOpen(key: string): boolean {
  const circuit = getCircuit(key);

  if (circuit.state === "CLOSED") return false;

  if (circuit.state === "OPEN") {
    const elapsed = Date.now() - circuit.lastFailureAt;
    if (elapsed >= RESET_TIMEOUT_MS) {
      circuit.state = "HALF_OPEN";
      circuit.successes = 0;
      circuit.probeInFlight = true;
      logger.log(`[CIRCUIT_BREAKER] ${key}: OPEN → HALF_OPEN (probing recovery)`);
      return false; // allow first probe request through
    }
    return true; // still open
  }

  // HALF_OPEN — only allow through if no probe is already in flight
  if (circuit.probeInFlight) {
    return true; // block until probe finishes
  }
  circuit.probeInFlight = true;
  return false;
}

/**
 * Record a successful call. Resets circuit to CLOSED if enough successes in HALF_OPEN.
 */
export function recordSuccess(key: string): void {
  const circuit = getCircuit(key);

  if (circuit.state === "HALF_OPEN") {
    circuit.probeInFlight = false;
    circuit.successes++;
    if (circuit.successes >= SUCCESS_THRESHOLD) {
      circuit.state = "CLOSED";
      circuit.failures = 0;
      circuit.successes = 0;
      logger.log(`[CIRCUIT_BREAKER] ${key}: HALF_OPEN → CLOSED (recovered)`);
    }
  } else if (circuit.state === "CLOSED") {
    // Reset failure count on success
    circuit.failures = 0;
  }
}

/**
 * Record a failed call. Opens circuit after threshold failures.
 */
export function recordFailure(key: string): void {
  const circuit = getCircuit(key);

  circuit.failures++;
  circuit.lastFailureAt = Date.now();

  if (circuit.state === "HALF_OPEN") {
    circuit.probeInFlight = false;
    circuit.state = "OPEN";
    logger.log(`[CIRCUIT_BREAKER] ${key}: HALF_OPEN → OPEN (probe failed)`);
    return;
  }

  if (circuit.state === "CLOSED" && circuit.failures >= FAILURE_THRESHOLD) {
    circuit.state = "OPEN";
    logger.log(
      `[CIRCUIT_BREAKER] ${key}: CLOSED → OPEN (${circuit.failures} consecutive failures)`,
    );
  }
}

/**
 * Get current state for observability/health endpoints.
 */
export function getCircuitState(key: string): CircuitState {
  return getCircuit(key).state;
}
