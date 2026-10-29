# Qingzuo market

The verifier uses SDK 1.2.0 from the immutable sdk-v1.2.0 Release tarball, pinned with lockfile integrity. Runtime compatibility is API 1.2.0; existing API 1.0 / 1.1 plugins remain compatible. AI-capable plugins require Qingzuo 0.3.0 and explicit permissions validated by the SDK.

Reviewed plugin catalog for Qingzuo. Only the registered public repositories in publishers.json may submit stable releases. The market validates both platform archives, GitHub release provenance, size, SHA-256, package identity and API metadata without executing plugin code.

The private Ed25519 key belongs only in market Secrets and protected operator storage. Published original plugin bytes remain hosted in each plugin Release; the catalog records signatures.

Run npm ci, npm test and npm run validate. The ingestion workflow accepts an optional registered repository and stable tag, then updates the catalog automatically after verifying both platform assets. The scheduled workflow therefore requires no review for plugin version updates; only publisher registration changes the reviewed catalog.

The scheduled ingestion path requires no cross-repository credential. Immediate dispatch optionally accepts a token scoped only to Actions write on this repository.

The downloads workflow refreshes the optional `stats.downloads` catalog field every six hours from stable `vX.Y.Z` Release assets. The value is a cumulative GitHub asset download count for both supported platforms, not a unique-user or successful-install metric.
