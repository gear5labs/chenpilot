# Agent Tool Registry Discovery, Validation & Safety (#1086, #1087, #1088, #1089)

## Overview
This document specifies architectural hardening for ChenPilot's Agent Tool Registry covering typed failure modes, pre-activation schema validation, deterministic evaluation fingerprints, and prompt-injection mitigations.

---

### 1. Typed Discovery Errors (#1086)
- **Problem**: Silent tool registry failures previously masked missing critical tools or provider timeouts.
- **Solution**: Explicit enumeration `ToolDiscoveryFailureType` distinguishes `MISSING_REQUIRED_TOOL`, `INVALID_METADATA`, `PROVIDER_FAILURE`, and records optional-tool degradation without crashing overall agent startup.

---

### 2. Runtime Metadata Schema Validation (#1087)
- **Problem**: Malformed parameters, duplicate definitions, or invalid naming conventions degraded agent prompt generation at runtime.
- **Solution**: `validateToolMetadataSchema` verifies naming syntax, semantic version compliance, parameter schema validity, and capability requirements before activation.

---

### 3. Deterministic Registry Ordering & Fingerprinting (#1088)
- **Problem**: Non-deterministic filesystem enumeration order altered LLM system prompt formatting, preventing reproducible evaluation benchmarks.
- **Solution**: Canonical sorting by `name@version` and cryptographic SHA-256 fingerprinting ensures consistent prompt generation across process restarts.

---

### 4. System Policy Protection against Untrusted Tool Descriptions (#1089)
- **Problem**: Tool descriptions injected from untrusted providers or user-defined modules could contain prompt injections targeting system prompts.
- **Solution**: `sanitizeToolDescription` scrubs role headers (`SYSTEM:`, `USER:`), defangs instruction overrides (`ignore previous instructions`), and confines tool descriptions inside data boundaries.
