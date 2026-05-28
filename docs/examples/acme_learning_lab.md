# Acme Learning Lab Walkthrough

This walkthrough exercises the default OpenMAO demo with no external credentials.

## Start Clean

```bash
make install
rm -rf .openmao
```

## Run to Approval

```bash
make demo
```

Expected shape:

```text
run_id: run_99999999999999999999999999999999
status: suspended_approval
approval_id: approval_11111111111111111111111111111111
artifact_id: artifact_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
```

Inspect the pending gate:

```bash
npm run cli -- approvals list
npm run cli -- events run_99999999999999999999999999999999
npm run cli -- world --run run_99999999999999999999999999999999
```

## Approve and Resume

```bash
make demo-approve
```

Expected shape:

```text
run_id: run_99999999999999999999999999999999
status: completed
collective_memory_id: mem_cccccccccccccccccccccccccccccccc
```

The completed demo writes:

- `.openmao/artifacts/onboarding_brief.md`
- `.openmao/collective_memory/promo_cccccccccccccccccccccccccccccccc.md`

## Console

```bash
make console
```

Open `http://127.0.0.1:8000/console`. If `OPENMAO_OPERATOR_TOKEN` is not set, copy the ephemeral
token printed by the server and enter it when the console prompts.

The console can start the demo, approve the pending gate, and inspect the world model and event log.
Approval actions still go through the API and shared services.
