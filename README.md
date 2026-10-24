# External availability watchdog

Generic watchdog only. No application source, customer data, credentials or target URLs belong in this repository. Telegram secrets and the target URL must be stored as repository secrets. Only the workflow token can update the separate monitor-state branch. Scheduled runs do not accept input and do not execute pull requests.

State is persisted before sending each transition. An uncertain delivery is not retried automatically. Inspect its state and Telegram before any manual remediation. Tests use an isolated drill state and clearly labelled notifications; the target service is never stopped.

GitHub scheduled workflows can be delayed or skipped and do not provide a strict detection SLA. This monitors HTTP readiness, not internal backup executor liveness.
