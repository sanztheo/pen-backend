# Contributing to Pennote Backend

Thanks for your interest. This project is open source under [AGPL-3.0](LICENSE) and welcomes contributions, with caveats noted below.

## Status & expectations

This is a community-maintained snapshot of the original Pennote SaaS. Maintenance is **best-effort**. Reviews may take **1-2 weeks**.

We accept PRs for:
- Bug fixes (with reproduction steps)
- Documentation improvements
- Test coverage
- Self-hosting / deployment improvements
- Features with a clear use case (open an issue first to discuss)

We may decline PRs that:
- Add a new third-party dependency without strong justification
- Restructure architecture without prior discussion
- Change licensing, branding, or attribution
- Introduce features only useful for a specific commercial deployment

## Before you start

1. **Search existing issues** — your idea may already be tracked or rejected.
2. **Open an issue first** for non-trivial changes — saves you wasted effort if we won't accept the direction.
3. **Read the [Code of Conduct](CODE_OF_CONDUCT.md).** Be civil. Hostile or condescending behavior gets you blocked.

## Development setup

```bash
git clone https://github.com/sanztheo/pen-backend.git
cd pen-backend
npm install

cp .env.example .env
# Fill in: DATABASE_URL, EMBEDDING_DATABASE_URL (with pgvector), REDIS_URL,
# CLERK_SECRET_KEY, OPENAI_API_KEY, ENCRYPTION_KEY (32-char hex)

npx prisma generate
npx prisma generate --schema=prisma/schema-embeddings.prisma
npm run db:migrate

npm run dev:local   # without Infisical
# OR
npm run dev         # with Infisical (requires `infisical login`)
```

The backend listens on port `3001`. You will need a Postgres instance with the `pgvector` extension installed for the embeddings database.

## Coding standards

- **TypeScript strict.** No `any` unless justified by comment. No `// @ts-ignore` without explanation.
- **Named exports** preferred over default exports.
- **No `console.log`** — use the project logger.
- **Constants** named (no magic numbers/strings).
- **Functions** under 30 lines. Single responsibility.
- **Comments** explain WHY, not HOW.
- **No silent catches** — every `try/catch` logs and returns or rethrows.

### Backend-specific rules

- **Dual Prisma:** when working with embeddings, import `Prisma` from the SAME package as the client (`prismaEmbeddings` → `lib/prismaEmbeddings.ts`, never `@prisma/client`). Mismatched imports cause `Prisma.raw()` to be silently serialized as JSONB.
- **Auth:** all routes must use `authenticateToken` middleware. No exceptions for "internal" routes — there is no perimeter.
- **Validation:** validate user input with Zod (or `ValidationUtils`) before processing.
- **External calls:** wrap all calls to LLM, Paddle, Clerk, Mem0 with `AbortSignal.timeout()` — no unbounded waits.
- **Pagination:** never `findMany()` without `take` + `skip`. Unbounded queries kill at scale.
- **Indexes:** every `WHERE` on a user-facing query must hit an index.
- **Rate limiting:** every public endpoint gets a rate limiter with a unique prefix.
- **Logging:** include `userId`, `action`, `resourceId`, `correlationId` in every log line for create/update/delete and auth failures.

Run before committing:

```bash
npm run lint
npx tsc --noEmit
npm test
```

## Testing

```bash
npm test                       # Jest
npm run test:coverage
npm run test:load:medium       # load testing (tsx scripts)
npm run benchmark:quiz:small
```

Add or update tests for any behavior change. Bug fixes should ship with a regression test.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `security`.

Examples:
- `fix(auth): handle expired Clerk token in middleware`
- `feat(quiz): add adaptive difficulty for review-mode sessions`
- `perf(prisma): add covering index on quiz_attempts(user_id, created_at)`

Subject ≤ 72 chars, imperative, no trailing period.

## Pull request workflow

1. **Fork** the repo.
2. **Branch** from `main`: `git checkout -b feat/<short-name>` or `fix/<short-name>`.
3. **Commit** following conventional commits.
4. **Push** to your fork.
5. **Open a PR** against `main`.
6. **Fill the PR template** completely — checked boxes only when actually verified.
7. **Wait for CI** to pass (typecheck + lint + tests).
8. **Address review comments** by pushing additional commits (do not force-push during review).
9. After approval, the maintainer **squash-merges** with a clean message.

See [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md) for the protection rules on `main`.

## What "ready to merge" means

- All CI checks green.
- At least 1 review approval.
- All review conversations resolved.
- No merge conflicts (rebase if needed).
- PR description matches what the diff actually does.
- Tests added or updated for behavior changes.
- Docs updated (README / inline) if user-facing changes.
- Migrations are reversible and reviewed.

## Sensitive data

Never commit:
- API keys, tokens, secrets, credentials
- `.env` files (only `.env.example` with placeholders)
- Production data or user emails
- Private discussion (Slack/Discord transcripts, internal tickets)

If you accidentally commit a secret, **rotate it immediately**, then notify <sanztheopro@gmail.com>. We will scrub history if needed.

## Reporting security issues

Do **not** open a public issue. See [`SECURITY.md`](SECURITY.md) — report to <sanztheopro@gmail.com>.

## Licensing of contributions

By submitting a PR, you agree that your contributions are licensed under the same terms as this project ([AGPL-3.0](LICENSE)) and that you have the right to submit them.

## Recognition

All merged contributors are listed in the GitHub contributors graph. Significant contributions are mentioned in release notes.

## Questions

- General questions → [GitHub Discussions](https://github.com/sanztheo/pen-backend/discussions)
- Maintainer email → <sanztheopro@gmail.com>
- Code-level questions → comment in the PR or issue
