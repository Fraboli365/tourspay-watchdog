# External readiness watchdog

Generic monitoring only. No application source, customer data or credentials belong in this repository. Tokens and destination addresses are repository secrets. Nonsecret custom-domain targets may use repository variables, with an explicit SHA-256 pin. Only the workflow token updates the separate monitor-state branch. Scheduled runs do not accept input or execute pull requests.

Checks run approximately every ten minutes. GitHub schedules can be delayed or skipped and provide no strict detection SLA. A daily state-branch heartbeat records execution; it remains subject to GitHub availability, account status and workflow enablement.

Availability, backup executor freshness, access queue counters, archive health and optional custom-domain HTTPS use separate persistent state. If the primary web is unreachable, availability alerts first to avoid redundant symptoms. Archive monitoring reuses the existing aggregate-counter credential and pinned origin; it receives no storage, deployment or financial credentials. It detects stale capture or executors, capacity, failed cleanup, uncertain upload and delayed verification. Custom-domain monitoring validates normal HTTPS and readiness; it cannot issue certificates or modify hosting.

State persists before each notification. Repeated categories do not repeat alerts. An uncertain delivery is not retried blindly: inspect the saved state and destination before remediation. Alerts contain generic categories, without tenant or buyer data.

Manual drill modes use isolated state and clearly labelled simulated notifications. They never stop the target service, send email or modify queues. The archive-drill-cycle sends one combined problem and one recovery once; reruns send zero messages. Access queue drills preserve their separate state. Normal checks only notify meaningful transitions.

Run the local test suite with `node --test tests/*.test.mjs`. Assign an incident owner and escalation path separately; monitoring does not create a human on-call service.
