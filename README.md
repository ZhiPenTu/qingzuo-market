# Qingzuo market

The verifier uses SDK 1.6.0 from the immutable sdk-v1.6.0 Release tarball, pinned with lockfile integrity. Runtime compatibility is API 1.6.0; existing API 1.0-1.5 plugins remain compatible. Shared image capability requires Qingzuo 0.6.12 and explicit permissions validated by the SDK.

Reviewed plugin catalog for Qingzuo. Only the registered public repositories in publishers.json may appear in the catalog. Each catalog entry records a stable `source`; the desktop client reads the plugin's latest stable Release manifest directly, so publishing a plugin update does not require a market catalog commit.

```json
{
  "id": "official.example",
  "source": {
    "type": "github-release",
    "repository": "ZhiPenTu/qingzuo-plugin-example"
  }
}
```

The market still keeps the last reviewed version, artifacts and Ed25519 signatures for older desktop clients. New desktop clients prefer `source` and verify the release manifest identity, artifact URL, size and SHA-256 before installing. The private Ed25519 key belongs only in market Secrets and protected operator storage.

Run npm ci, npm test and npm run validate. Run npm run verify:release to check registered releases manually; the scheduled verification workflow performs the same checks without modifying catalog.json. Publisher registration and the initial catalog entry are the only market-side changes needed to make a plugin available.

The verification workflow requires no cross-repository credential and only needs read access to public Releases.

The downloads workflow refreshes the optional `stats.downloads` catalog field every six hours from stable `vX.Y.Z` Release assets. The value is a cumulative GitHub asset download count for both supported platforms, not a unique-user or successful-install metric.
