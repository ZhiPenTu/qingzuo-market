# Qingzuo market

Reviewed plugin catalog and release verifier for Qingzuo. Only public repositories registered in `publishers.json` may appear in the catalog.

## Publisher registry

`publishers.json` uses schema version 2. Each repository is bound to one explicit plugin ID and one trust tier:

```json
{
  "schemaVersion": 2,
  "publishers": {
    "ZhiPenTu/qingzuo-plugin-example": {
      "id": "official.example",
      "tier": "official"
    }
  }
}
```

The only tiers are `platform`, `official`, and `community`, displayed as 底座内置, 官方社区, and 第三方. Repository names are unique regardless of case, publisher IDs are unique, and the legacy `repository -> id` string registry is rejected.

## Listing a plugin

Keep `catalog.json` at `schemaVersion: 1` so older Qingzuo clients remain compatible. Every entry must explicitly declare `tier` and the compatibility projection `official`:

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "id": "official.example",
      "tier": "official",
      "official": true,
      "title": "Example",
      "description": "Example plugin",
      "version": "0.1.0",
      "api": "^1.10.0",
      "source": {
        "type": "github-release",
        "repository": "ZhiPenTu/qingzuo-plugin-example"
      }
    }
  ]
}
```

`official` must equal `tier !== "community"`. The catalog entry's repository, ID, and tier must exactly match the registry; market metadata is not inferred from the latest release or from an `official.` ID prefix.

The catalog keeps the last reviewed version, artifacts, and Ed25519 signatures for older desktop clients. New desktop clients prefer `source` and verify the release manifest identity, artifact URL, size, and SHA-256 before installing. The private Ed25519 key belongs only in market Secrets and protected operator storage.

## Release fragments

A release publishes `catalog-darwin-arm64.json` and `catalog-win32-x64.json`. The fragment root may only use `schemaVersion` and `plugins`. Each fragment must contain exactly one plugin entry, and that entry may only use these fields:

`id`, `version`, `title`, `description`, `category`, `api`, `releaseNotes`, `icon`, `artifacts`

Artifact entries may only use `url`, `size`, and `sha256`. Market-controlled trust fields (`tier`, `official`, `source`, `stats`, `verification`) and any other unknown field are rejected at every level. Both platform fragments must describe the same metadata, and both signed `.ecplugin` assets must match the declared size and SHA-256.

For already-published immutable releases, the verifier also accepts the legacy manifest fields `manifestVersion`, `ui`, `permissions`, `settings`, `backend`, and `services`; it strips them before verification. Trust fields remain rejected, and the signed package manifest is still the authority for these values.

## Validation

The verifier targets SDK 1.11.0 from the immutable `sdk-v1.11.0` Release tarball. `package-lock.json` pins that tarball and its integrity.

```sh
npm ci --ignore-scripts
npm test
npm run validate
npm run verify:release
```

`npm run verify:release` checks every registered public release and needs read access to public Release assets. The scheduled workflow performs the same checks. Publisher registration and the catalog entry are the only market-side changes needed to make a plugin available.

The downloads workflow refreshes the optional `stats.downloads` field every six hours from stable `vX.Y.Z` Release assets. It updates only that counter and preserves `tier`, `official`, and `source`. The value is a cumulative GitHub asset download count for both supported platforms, not a unique-user or successful-install metric.
