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

## Categories

The following are the categories used to classify different types of documentation.

### Kind

| Name | Description |
|------|-------------|
| `official` | The primary source of documentation provided by the package maintainers. This is the most authoritative and comprehensive resource for understanding the package. |
| `community` | Documentation created by the user community, such as wikis, forums, or unofficial guides. These can provide additional insights, examples, and use cases that may not be covered in the official docs. |

One of the two must be set. `official` must only be used for sources that are published or directly endorsed by the package maintainers. If there is any doubt about the authenticity of the source, it should not be categorized as `official`.


### Classification

| Name | Description |
|------|-------------|
| `homepage` | The main landing page / website for the package, which may include an overview, features, and links to other documentation. This is often the first place users will go to learn about the package. |
| `overview` | High-level summaries or introductions to the package, which may be found on the homepage or in README files. These provide a quick understanding of what the package does and its key features. |
| `docs` | General documentation that may include a mix of official and community sources. This category is for any documentation that doesn't fit neatly into the other categories but is still valuable for users. |
| `tutorial` | Step-by-step guides that walk users through specific tasks or features of the package. Tutorials are often more beginner-friendly and focus on practical applications. |
| `reference` | Reference documentation that provides detailed information about the package's API, including functions, classes, methods, and their parameters. This is essential for developers who need to understand the technical details of how to use the package. |
| `guide` | Comprehensive guides that cover broader topics or workflows related to the package. These may include best practices, architectural patterns, or in-depth explanations of concepts. |
| `blog` | Blog posts that discuss the package, its features, updates, or use cases. These can provide insights into real-world applications and the latest developments. |
| `video` | Video tutorials, webinars, or conference talks that cover the package. Videos can be a great way to learn through visual and auditory means, especially for complex topics. |
| `course` | Structured courses that provide a comprehensive learning path for the package. These may include multiple lessons, exercises, and assessments to help users master the package. |
| `cheatsheet` | Concise reference materials that summarize key information about the package, such as common commands, functions, or patterns. Cheatsheets are useful for quick lookups and reminders. |

Categories should be chosen with great care and should be accurate, and refer to the exact URL being linked.
If we categorize a `homepage`, it will most likely not classify for `docs` or `tutorial`, even if it links to these things. Instead, the actual links to whatever does classify as `docs` or `tutorial` should be categorized as such, and not the homepage itself. However the homepage might be combined with something like `overview` if it includes broad usage or similar information.
