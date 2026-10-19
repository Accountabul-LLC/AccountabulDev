# AccountabulDev

AccountabulDev repo: the public development copy, published from a cleaned snapshot with no prior history. MIT licensed (see `LICENSE`). Do not commit credentials, `.env` files, production project refs or customer data.

## Accountabul Platform

Production application for Accountabul public discovery, hosted business pages,
business operations, properties, services, leads, live events, and payments.

Core implementation contracts:

- [`docs/BUSINESS_EXPERIENCE.md`](docs/BUSINESS_EXPERIENCE.md)
- [`docs/ADMIN_BUSINESS_APPROVAL_PIPELINE.md`](docs/ADMIN_BUSINESS_APPROVAL_PIPELINE.md)
- [`docs/CONFERENCE_ROOM_ARCHITECTURE.md`](docs/CONFERENCE_ROOM_ARCHITECTURE.md)
- [`docs/STRIPE_ACCOUNTABUL_PROVISIONING.md`](docs/STRIPE_ACCOUNTABUL_PROVISIONING.md)
- [`docs/OPERATIONS_API.md`](docs/OPERATIONS_API.md)
- [`docs/OPERATIONS_CONSOLE_MIGRATION.md`](docs/OPERATIONS_CONSOLE_MIGRATION.md)
- [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md)
- [`docs/PALISADE_PILOT.md`](docs/PALISADE_PILOT.md)

The backend is the Accountabul-owned Supabase project. Develop in Cursor against local
`.env` — not Lovable Cloud.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

Verification commands:

```sh
npm run typecheck
npm test
npm run build
```

Administrative approvals are intentionally absent from this public application. They
run in the separate private Accountabul Operations Console through authenticated
internal APIs.
