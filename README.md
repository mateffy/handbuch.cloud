# handbuch.cloud

Curated documentation metadata for open-source packages. A static-JSON library designed to be consumed by AI coding agents and the [Handbuch](https://github.com/mateffy/handbuch) CLI.

## What is this?

Every package in the library is a single JSON file containing high-quality, manually verified documentation URLs. Instead of agents scraping the entire web for every dependency, they can query `handbuch.cloud` and get a vetted list of the best docs available.

## Schema

Each package JSON follows [`docs/schema.json`](./docs/schema.json):

```json
{
  "$schema": "https://handbuch.cloud/schema.json",
  "name": "react",
  "registry": "npm",
  "updatedAt": "2024-06-06T00:00:00Z",
  "checkedAt": "2024-06-06T00:00:00Z",
  "readme": "https://raw.githubusercontent.com/facebook/react/main/README.md",
  "docs": [
    {
      "url": "https://react.dev",
      "title": "React Official Documentation",
      "description": "The canonical React documentation site.",
      "kind": "official",
      "tags": ["guide", "api", "reference"]
    }
  ]
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Package name exactly as published |
| `registry` | ✅ | `npm`, `packagist`, `cargo`, `pypi`, `go`, `maven`, `nuget`, `gem`, `hex`, `docker` |
| `updatedAt` | ✅ | Last metadata update (ISO 8601) |
| `checkedAt` | ✅ | Last URL verification (ISO 8601) |
| `readme` | ❌ | Direct URL to raw README.md |
| `docs` | ✅ | Ordered array of curated documentation sources |

### Doc entry fields

| Field | Required | Description |
|-------|----------|-------------|
| `url` | ✅ | Canonical documentation URL |
| `title` | ✅ | Human-readable title |
| `description` | ❌ | One- or two-sentence summary |
| `kind` | ❌ | `official`, `community`, `tutorial`, `api`, `guide`, `blog`, `video`, `course`, `cheatsheet` |
| `tags` | ❌ | Array of tags for filtering |

## Directory layout

```
docs/
├── schema.json
├── npm/
│   ├── react.json
│   └── @scope/
│       └── name.json
├── cargo/
│   └── tokio.json
└── pypi/
    └── requests.json
```

Scoped packages preserve the `@` character in the path.

## Contributing

1. Research the best documentation for a package using the [Handbuch Librarian skill](./.agents/skills/handbuch-librarian/SKILL.md).
2. Create or edit the JSON file under `docs/{registry}/{name}.json`.
3. Validate your JSON against the schema.
4. Open a PR.

## Agent skill

See [`.agents/skills/handbuch-librarian/SKILL.md`](./.agents/skills/handbuch-librarian/SKILL.md) for detailed instructions on how AI agents should research, evaluate, and add documentation to this library.
