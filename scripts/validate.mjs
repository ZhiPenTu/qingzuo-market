import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PLUGIN_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
export const PUBLISHER_TIERS = Object.freeze(['platform', 'official', 'community']);
const PUBLISHER_TIER_SET = new Set(PUBLISHER_TIERS);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validRepository(value) {
  if (typeof value !== 'string' || value.length > 160 || !REPOSITORY.test(value)) return false;
  return value.split('/').every(part => part.length <= 100 && part !== '.' && part !== '..');
}

function validPluginId(value) {
  return typeof value === 'string' && PLUGIN_ID.test(value) && !value.startsWith('system.');
}

function stableVersion(value) {
  return semver.valid(value) !== null && semver.prerelease(value) === null;
}

export function parseJsonStrict(source, label = 'JSON') {
  const text = String(source);
  let index = 0;
  const fail = message => {
    throw new Error('Invalid ' + label + ': ' + message);
  };
  const isWhitespace = character => character === ' ' || character === '\n' || character === '\r' || character === '\t';
  const skipWhitespace = () => {
    while (index < text.length && isWhitespace(text[index])) index += 1;
  };
  const readString = () => {
    const start = index;
    if (text[index] !== '"') fail('expected string');
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        index += 1;
        continue;
      }
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          fail('invalid string');
        }
      }
      if (character.charCodeAt(0) < 0x20) fail('invalid string');
      index += 1;
    }
    fail('unterminated string');
  };
  const parseObject = depth => {
    index += 1;
    skipWhitespace();
    const keys = new Set();
    if (text[index] === '}') {
      index += 1;
      return;
    }
    while (index < text.length) {
      skipWhitespace();
      const key = readString();
      if (keys.has(key)) fail('duplicate key "' + key + '"');
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ':') fail('expected colon');
      index += 1;
      parseValue(depth + 1);
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      if (text[index] !== ',') fail('expected comma');
      index += 1;
    }
    fail('unterminated object');
  };
  const parseArray = depth => {
    index += 1;
    skipWhitespace();
    if (text[index] === ']') {
      index += 1;
      return;
    }
    while (index < text.length) {
      parseValue(depth + 1);
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      if (text[index] !== ',') fail('expected comma');
      index += 1;
    }
    fail('unterminated array');
  };
  const parsePrimitive = () => {
    const start = index;
    while (index < text.length && !isWhitespace(text[index]) && !'{}[],:"'.includes(text[index])) index += 1;
    if (index === start) fail('expected value');
  };
  const parseValue = depth => {
    if (depth > 512) fail('nesting is too deep');
    skipWhitespace();
    if (text[index] === '"') {
      readString();
      return;
    }
    if (text[index] === '{') {
      parseObject(depth);
      return;
    }
    if (text[index] === '[') {
      parseArray(depth);
      return;
    }
    parsePrimitive();
  };

  parseValue(0);
  skipWhitespace();
  if (index !== text.length) fail('unexpected trailing content');
  try {
    return JSON.parse(text);
  } catch {
    fail('invalid syntax');
  }
}

export function validatePluginIcon(value) {
  const prefix = 'data:image/png;base64,';
  if (typeof value !== 'string' || !value.startsWith(prefix)) throw new Error('Invalid plugin icon.');
  const encoded = value.slice(prefix.length);
  if (!encoded || encoded.length > 49152 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid plugin icon.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 8 || bytes.length > 36864 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid plugin icon.');
  return value;
}

export function validatePluginMetadata(entry) {
  if (!isRecord(entry)
    || entry.api !== undefined && (typeof entry.api !== 'string' || !semver.validRange(entry.api))
    || typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 80
    || typeof entry.description !== 'string' || entry.description.length > 2000
    || entry.category !== undefined && (typeof entry.category !== 'string' || !entry.category.trim() || entry.category.length > 40)
    || entry.releaseNotes !== undefined && (typeof entry.releaseNotes !== 'string' || entry.releaseNotes.length > 64000)) {
    throw new Error('Invalid plugin metadata.');
  }
  if (entry.icon !== undefined) validatePluginIcon(entry.icon);
  return entry;
}

export function validateSource(source) {
  if (!isRecord(source)
    || source.type !== 'github-release' || !validRepository(source.repository)) throw new Error('Invalid plugin source.');
  return source;
}

export function validatePublisherRegistry(value) {
  if (!isRecord(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'schemaVersion')
    || !Object.hasOwn(value, 'publishers')
    || value.schemaVersion !== 2
    || !isRecord(value.publishers)) {
    throw new Error('Invalid publisher registry.');
  }
  const entries = Object.entries(value.publishers);
  if (entries.length > 1000) throw new Error('Invalid publisher registry.');
  const repositoryNames = new Set();
  const publisherIds = new Set();
  for (const [repository, publisher] of entries) {
    if (!validRepository(repository)) throw new Error('Invalid publisher repository.');
    const repositoryKey = repository.toLowerCase();
    if (repositoryNames.has(repositoryKey)) throw new Error('Duplicate publisher repository.');
    if (!isRecord(publisher)
      || Object.keys(publisher).length !== 2
      || !Object.hasOwn(publisher, 'id')
      || !Object.hasOwn(publisher, 'tier')) {
      throw new Error('Invalid publisher registry.');
    }
    if (!validPluginId(publisher.id)) throw new Error('Invalid publisher ID.');
    if (!PUBLISHER_TIER_SET.has(publisher.tier)) throw new Error('Invalid publisher tier.');
    if (publisherIds.has(publisher.id)) throw new Error('Duplicate publisher ID.');
    repositoryNames.add(repositoryKey);
    publisherIds.add(publisher.id);
  }
  return value;
}

export function validateCatalog(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.plugins) || value.plugins.length > 1000) {
    throw new Error('Invalid catalog.');
  }
  const identities = new Set();
  const repositories = new Set();
  for (const entry of value.plugins) {
    if (!isRecord(entry)
      || !validPluginId(entry.id)
      || identities.has(entry.id)
      || !stableVersion(entry.version)
      || !PUBLISHER_TIER_SET.has(entry.tier)
      || typeof entry.official !== 'boolean'
      || entry.official !== (entry.tier !== 'community')) {
      throw new Error('Invalid plugin entry.');
    }
    validatePluginMetadata(entry);
    validateSource(entry.source);
    const repositoryKey = entry.source.repository.toLowerCase();
    if (repositories.has(repositoryKey)) throw new Error('Duplicate plugin source repository.');
    if (entry.stats !== undefined && (!isRecord(entry.stats) || entry.stats.downloads !== undefined && (!Number.isSafeInteger(entry.stats.downloads) || entry.stats.downloads < 0))) throw new Error('Invalid plugin stats.');
    identities.add(entry.id);
    repositories.add(repositoryKey);
    if (entry.artifacts !== undefined) {
      if (!isRecord(entry.artifacts)) throw new Error('Invalid signed artifact.');
      for (const [platform, artifact] of Object.entries(entry.artifacts)) {
        if (!['darwin-arm64', 'win32-x64'].includes(platform) || !isRecord(artifact) || typeof artifact.url !== 'string') {
          throw new Error('Invalid signed artifact.');
        }
        let url;
        try {
          url = new URL(artifact.url);
        } catch {
          throw new Error('Invalid signed artifact.');
        }
        if (url.protocol !== 'https:' || url.username || url.password
          || !/^[a-f0-9]{64}$/.test(artifact.sha256)
          || !Number.isSafeInteger(artifact.size) || artifact.size < 1
          || !/^[A-Za-z0-9+/]{86}==$/.test(artifact.signature)) {
          throw new Error('Invalid signed artifact.');
        }
      }
    }
  }
  return value;
}

export function validatePublisherCatalog(catalog, registry) {
  validatePublisherRegistry(registry);
  validateCatalog(catalog);
  for (const entry of catalog.plugins) {
    if (!Object.hasOwn(registry.publishers, entry.source.repository)) throw new Error('Plugin source is not registered.');
    const publisher = registry.publishers[entry.source.repository];
    if (publisher.id !== entry.id) throw new Error('Plugin source identity mismatch.');
    if (publisher.tier !== entry.tier) throw new Error('Plugin source tier mismatch.');
    if (entry.official !== (publisher.tier !== 'community')) throw new Error('Plugin official projection mismatch.');
  }
  return catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const catalog = parseJsonStrict(await readFile('catalog.json', 'utf8'), 'catalog.json');
  const registry = parseJsonStrict(await readFile('publishers.json', 'utf8'), 'publishers.json');
  validatePublisherCatalog(catalog, registry);
}
