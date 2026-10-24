# External availability watchdog

Generic watchdog only. No application source, customer data, credentials or target URLs belong in this repository. Telegram secrets and the target URL must be stored as repository secrets. Only the workflow token can update the separate monitor-state branch. Scheduled runs do not accept input and do not execute pull requests.

State is persisted before sending each transition. An uncertain delivery is not retried automatically. Inspect its state and Telegram before any manual remediation. Tests use an isolated drill state and clearly labelled notifications; the target service is never stopped.

GitHub scheduled workflows can be delayed or skipped and do not provide a strict detection SLA. Availability and backup executor heartbeats use separate state files. Backup checks require a dedicated read-only bearer secret and validate freshness within 90 minutes. If the web is unreachable, only the availability channel alerts, to avoid redundant symptoms.

A daily state-branch heartbeat records that checks are still running and maintains repository activity. Scheduled execution remains subject to GitHub availability, account status and workflow enablement.
