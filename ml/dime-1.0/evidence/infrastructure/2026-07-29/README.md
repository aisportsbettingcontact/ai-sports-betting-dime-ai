# Railway Phase 1 readiness observation

This directory contains a sanitized, read-only observation of the Dime AI
production service in Railway on 2026-07-29.

The observation records service and environment labels, configuration
presence booleans, non-secret control states, the public Git revision
associated with the active deployment, and whether required timestamp fields
exist in the deployed source schema.

It excludes variable values, credentials, private endpoints, Railway resource
identifiers, raw logs, prompts, responses, user data, and database records.
No variable, deployment, database, service, or traffic state was changed.

This evidence confirms production connectivity and identifies the active
service boundary. It does not authorize deployment, tracing, traffic export,
pricing approval, shadow traffic, canary traffic, release, or training.

`research_alpha_kill_switch_hardening_proposal.json` is a separate,
non-authorizing configuration proposal. It records the observed non-fail-closed
state and the target `feature_enabled=false`, `kill_switch_engaged=true` state.
It performs no mutation and must not be combined with the Phase 1 deployment or
trace activation.
