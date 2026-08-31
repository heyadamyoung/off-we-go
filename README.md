# Off We Go

Off We Go is a self-hosted family trip companion with a live map, itinerary, private photos, invitations, background location sharing, and an OAuth-protected MCP server. The client is a React/Capacitor application for the web, iPhone, and iPad; the backend is Fastify with PostgreSQL.

See [app/README.md](app/README.md) for architecture, local development, deployment, migration, testing, and iOS instructions.

## Quick start

```bash
cd app
pnpm install
pnpm dev
```

With no `VITE_API_URL`, the development client opens the bundled sample trip and does not require a database.

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Please report vulnerabilities privately using the process in [SECURITY.md](SECURITY.md).

## License

Off We Go is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must offer its corresponding source to its users under the same license.
