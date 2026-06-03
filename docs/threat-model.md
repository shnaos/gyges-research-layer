# Threat Model

## Primary risks addressed

- Query correlation across unrelated tasks
- Identity leakage through shared browsing context
- Agent overreach due to implicit capabilities
- Unreviewed network access paths

## Out of scope for MVP

- Global anti-fingerprinting
- Full anonymization guarantees
- Protection against compromised host OS
- Advanced traffic analysis resistance

## Security posture statement

GRL is a privacy layer enforcing explicit capability policy boundaries. It is **not** an anonymity guarantee.
