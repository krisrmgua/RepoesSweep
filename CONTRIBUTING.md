# Contributing

Issues and pull requests are welcome.

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. Use a conventional commit such as `feat:`, `fix:`, or `docs:`.
3. From the repo root, with Node.js 20 or newer, run:

```bash
npm install
npm run build
```

4. Do not commit private clones, tokens, or remote URLs that contain credentials. The app discovers clones on the machine that runs it. Nothing in this repository should name a private project.
5. Open a pull request that says what changed and how you tested it.

`main` only accepts changes through a pull request. Direct pushes are rejected.

The app is Electron + TypeScript and targets macOS 13+ and Windows 10/11. A live check needs git clones you are allowed to fetch. The legacy Swift app in `menubar/` still builds with `swift build`; only touch it for fixes until it is removed.

User-facing behavior belongs in the README when install steps, the scan root, or preferences change.
