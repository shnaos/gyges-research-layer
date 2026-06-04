# Threat Model

## Primary risks addressed

- Query correlation across unrelated tasks
- Identity leakage through shared browsing context
- Agent overreach due to implicit capabilities
- Unreviewed network access paths
- Transport correlation and DNS leakage (Sprint 2)

## Transport & isolation mitigations (Sprint 2)

- Per-compartment isolation of cookies, sessions, and user-agents — no cross-compartment sharing
- Transport decided by policy, never by the agent; transport mismatch denies execution
- Tor/proxy routing over SOCKS5 with remote DNS (ATYP=domain) to prevent local DNS leaks
- Per-session Tor circuit isolation, rebuilt on identity rotation
- Fail-closed transports: a failed Tor/proxy setup denies the request rather than downgrading to direct

## Out of scope for MVP

- Global anti-fingerprinting
- Full anonymization guarantees
- Protection against compromised host OS
- Advanced traffic analysis resistance

## Security posture statement

GRL is a privacy layer enforcing explicit capability policy boundaries. It is **not** an anonymity guarantee.
