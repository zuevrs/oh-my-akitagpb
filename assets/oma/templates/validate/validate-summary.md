# Validate Summary

This file is **summary-only**. The canonical machine-readable validate state lives in the JSON files under `.oma/state/local/validate/`.

## Canonical JSON inputs

- `validation-report.json`

## Validation reminders

- Validate only the generated artifact bundle recorded by `akita-write`.
- Reject unsupported or bundle-unknown constructs explicitly.
- Preserve clear lineage-drift findings instead of silently passing partial coverage.

## Redaction reminders

Do not include secrets, credentials, tokens, raw auth headers, raw env values, or machine-local credentials.

## Summary

### Validation report
- Verdict:
- Reviewed artifacts:
- Rejection reasons:
- Lineage notes:
- Follow-up:
