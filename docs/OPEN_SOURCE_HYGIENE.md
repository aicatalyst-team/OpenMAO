# Open-Source Hygiene

OpenMAO is intended for public GitHub sharing. Treat all committed content as public.

## Closed-Source Boundary

Closed-source repositories may inspire process style, but their content must not be copied into OpenMAO.

Allowed:

- document categories;
- generic template shapes;
- workflow patterns rewritten from scratch;
- lessons expressed as OpenMAO-native policy.

Forbidden:

- proprietary wording copied from closed-source docs;
- client names, private URLs, credentials, IDs, or operational details;
- closed-source code, scripts, prompts, workflow JSON, or internal strategy;
- private repo paths used as authoritative references in public docs.

## Internal Communications Boundary

Public docs describe the product, not private deliberation. Do not commit:

- model conversations;
- session transcripts;
- private strategy debates;
- scratch decisions;
- pre-public build-process records;
- internal audit notes or handoff notes.

## Third-Party Project Boundary

Public projects may inform OpenMAO only through scoped, reviewed work. Do not copy external
implementation code or expose foreign public APIs as OpenMAO contracts.

## Secret and Data Rules

Never commit:

- secrets, tokens, keys, private URLs, or credentials;
- personal data or customer data;
- local machine artifacts;
- raw logs that may contain sensitive values;
- private data that is not intended for public release.

## Pre-Publication Checklist

- [ ] `README.md` does not reference private repositories.
- [ ] `SECURITY.md` has a real reporting path.
- [ ] `LICENSE` exists.
- [ ] `.env.example` contains placeholders only.
- [ ] No absolute private paths appear in public docs.
- [ ] Private data, raw logs, and local-only artifacts are excluded from commits.
- [ ] Secret scanning passes.
- [ ] Markdown links pass.
