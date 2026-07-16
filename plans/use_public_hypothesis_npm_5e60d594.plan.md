---
name: Use hypothesis-with-ai from npm
overview: Remove portal resolutions, then depend on the published package `hypothesis-with-ai@firsttry` while keeping the install path `node_modules/hypothesis` so gulp/Makefile keep working.
todos:
  - id: update-package-json
    content: Remove portal `resolutions`; set `hypothesis` devDependency to `npm:hypothesis-with-ai@firsttry`
    status: completed
  - id: yarn-install
    content: Run `yarn install` to refresh yarn.lock and node_modules
    status: completed
  - id: optional-cleanup
    content: "Optional: delete or gitignore _pkg_hypothesis/ and hypothesis tgz if unused"
    status: completed
isProject: false
---

# Use `hypothesis-with-ai@firsttry` instead of local fork / `hypothesis`

## Why not only `yarn add hypothesis-with-ai@firsttry`?

This repo expects the client under `**node_modules/hypothesis**`:

- `[gulpfile.js](gulpfile.js)` watches `node_modules/hypothesis`
- `[Makefile](Makefile)` copies from `node_modules/hypothesis/build/`

A plain dependency on the package name `hypothesis-with-ai` would install to `node_modules/hypothesis-with-ai`, which would break those paths unless you also change gulp/Makefile.

## Recommended approach (Yarn 3)

This project uses **Yarn** (`packageManager`: `yarn@3.6.1`), not npm. Use Yarn’s `**npm:`** protocol so the dependency is still named `hypothesis` but the tarball comes from `**hypothesis-with-ai@firsttry`**:

1. **Remove** the entire `resolutions` block (portal overrides to your local path).
2. **Replace** the `hypothesis` devDependency from `"^1.1747.0"` to:
  - `"hypothesis": "npm:hypothesis-with-ai@firsttry"`
  - `firsttry` is treated as a dist-tag or version per npm’s rules; adjust if your publish uses a different tag or semver.
3. **Drop** the `@eglassman/hypothesis-client-with-ai` resolution line (it only existed to align with the fork).

Yarn should still lay out `**node_modules/hypothesis`** for that dependency entry, with contents from `hypothesis-with-ai`.

1. Run `**yarn install`** (not `npm install`, unless you intentionally migrate tooling) so `[yarn.lock](yarn.lock)` updates.
2. **Verify**: `yarn why hypothesis` and confirm `node_modules/hypothesis` exists and matches the published package layout (e.g. `build/manifest.json` for the Makefile).

## If `npm:` alias does not create `node_modules/hypothesis`

Rare edge cases: if the linker layout differs, fallback is to add `hypothesis-with-ai@firsttry` under its real name and **update** `[gulpfile.js](gulpfile.js)` and `[Makefile](Makefile)` to use `node_modules/hypothesis-with-ai` instead.

## Optional cleanup

Untracked `_pkg_hypothesis/` and `hypothesis-1.1747.0.tgz` can be removed or gitignored if unused.