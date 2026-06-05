# GRL Security Assumptions

> **Sprint 19 — Security Assumptions**

This document states the explicit assumptions GRL makes about its environment.
If any assumption is violated, GRL's security guarantees may be weakened or void.

---

## 1. Host Environment

| # | Assumption | If violated |
|---|-----------|-------------|
| A1 | The host operating system is not compromised | An attacker with OS-level access can read in-memory state, intercept loopback traffic, or modify the config file |
| A2 | The Node.js runtime is not compromised | A compromised runtime can bypass all in-process policy engines |
| A3 | The kernel is not compromised | Kernel-level rootkits can intercept all system calls, including file reads and network I/O |
| A4 | The hardware is not compromised | Hardware-level attacks (DMA, firmware) are out of scope |
| A5 | The operator controls physical access to the machine | Uncontrolled physical access enables all of the above |

---

## 2. Network Environment

| # | Assumption | If violated |
|---|-----------|-------------|
| A6 | The loopback interface (`127.0.0.1`) is accessible only from local processes | Misconfigured firewall or container networking could expose the GRL API to remote hosts |
| A7 | The SearXNG instance runs on localhost and is not accessible from the internet | A publicly accessible SearXNG instance could be queried directly, bypassing GRL |
| A8 | No other process on the host is performing loopback port scanning or interception | A local process could intercept HTTP traffic on port 8787 |

---

## 3. Operator and Configuration

| # | Assumption | If violated |
|---|-----------|-------------|
| A9 | The operator is the only entity with write access to `grl.config.json` | Malicious config changes could weaken all policy defenses |
| A10 | The operator has read the documentation and understands the security model | Misconfiguration by an uninformed operator is a residual risk |
| A11 | The config file does not contain secrets, tokens, or credentials | GRL does not enforce this, but relies on the operator not placing secrets in config |
| A12 | `GRL_CONFIG_PATH` (if set) points to an operator-controlled file | If an attacker can write a file at that path, they can inject arbitrary policy |

---

## 4. Dependency Integrity

| # | Assumption | If violated |
|---|-----------|-------------|
| A13 | npm dependencies are installed from trusted sources and not tampered with | Supply chain compromise of any dependency could affect all GRL guarantees |
| A14 | The TypeScript compiler and build toolchain are not compromised | A compromised build produces attacker-controlled binaries |
| A15 | SearXNG returns structured JSON as documented | Malformed or unexpected SearXNG responses are handled fail-safely, but protocol deviations could expose parsing edge cases |

---

## 5. Agent Behavior

| # | Assumption | If violated |
|---|-----------|-------------|
| A16 | The agent submits structured requests via the HTTP API | An agent that sends binary or non-JSON payloads is rejected at the HTTP layer |
| A17 | The agent does not have write access to the GRL config file | An agent with config write access could rewrite its own policies |
| A18 | The agent operates within its declared compartment | An agent that forges `compartmentId` is still subject to policy — the compartment must be declared in config |

---

## 6. Audit and Monitoring

| # | Assumption | If violated |
|---|-----------|-------------|
| A19 | The operator periodically reviews audit events and incidents | Unreviewed audit trails do not provide detection value |
| A20 | The audit store's in-memory contents are not externally mutable | A process with write access to the GRL heap could tamper with audit state |

---

## 7. What GRL Does NOT Assume

- GRL does **not** assume the agent is benign.
- GRL does **not** assume search results are benign (results may contain prompt injection).
- GRL does **not** assume the SearXNG instance is benign (it is treated as an untrusted external component).
- GRL does **not** assume the operator has perfect OPSEC.
- GRL does **not** assume the network is private below the loopback layer.
