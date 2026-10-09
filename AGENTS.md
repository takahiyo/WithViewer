# Development workflow

- Use `dev` as the base branch for ongoing development.
- Keep `main` for the version selected for production. This initial upload puts the same implementation on both branches.
- Do not merge or push future changes to `main` unless the user requests it.
- Never commit `.env`, `.dev.vars`, `.wrangler`, `cloudflare.private.json`, API keys, OAuth credentials, recordings, or test artifacts.
- Preserve the separation between meeting observations and user/AI consultations.
- When changing behavior, run the relevant checks; the existing commands are `npm test`, `npm run test:browser`, and `npm run build:pages`.
