# Contributing

Issues and pull requests are welcome.

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. Use a conventional commit such as `feat:`, `fix:`, or `docs:`.
3. From `menubar/`, run:

```bash
swift build
```

4. Do not commit private clones, tokens, or remote URLs that contain credentials. The app discovers clones on the machine that runs it. Nothing in this repository should name a private project.
5. Open a pull request that says what changed and how you tested it.

`main` only accepts changes through a pull request. Direct pushes are rejected.

The app targets macOS 13 and is built with Swift Package Manager. A live check needs git clones you are allowed to fetch.

User-facing behavior belongs in the README when install steps, the scan root, or preferences change.
