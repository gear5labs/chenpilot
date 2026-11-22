# Operations and observability boundaries

Readiness probes must evaluate dependency availability without coupling to liveness restarts; metrics require bounded label dimensions stripped of high-cardinality identifiers; and audit records enforce a 90-day retention baseline with paginated exports and cryptographic hash-chain verification.
