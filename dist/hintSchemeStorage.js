import fs from 'node:fs';
import path from 'node:path';

const WORD_HINT_DIR = './word_hint_module/word_hint';
const WORD_HINT_VERSION_DIR = path.join(WORD_HINT_DIR, '.versions');
const legacySchemePath = name => path.join(WORD_HINT_DIR, name);
const schemeVersionRoot = name => path.join(WORD_HINT_VERSION_DIR, encodeURIComponent(name));
const versionedSchemePath = name => path.join(schemeVersionRoot(name), 'current', 'table');

export const schemePath = name => fs.existsSync(`${versionedSchemePath(name)}.hint`)
  ? versionedSchemePath(name)
  : legacySchemePath(name);

export function createSchemeVersion(name) {
  const versionsDir = path.join(schemeVersionRoot(name), 'versions');
  fs.mkdirSync(versionsDir, { recursive: true });
  const directory = fs.mkdtempSync(path.join(versionsDir, `${Date.now()}-`));
  return { directory, base: path.join(directory, 'table') };
}

export function createLinkedSchemeVersion(sourceBase, targetName) {
  const version = createSchemeVersion(targetName);
  try {
    for (const ext of ['.txt', '.hint', '.config']) {
      const source = sourceBase + ext;
      if (!fs.statSync(source).isFile()) throw new Error(`missing scheme file: ${source}`);
      linkOrCopy(source, version.base + ext);
    }
    return version;
  } catch (err) {
    removeDirectory(version.directory);
    throw err;
  }
}

export function removeDirectory(directory) {
  if (directory && fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
}

export function removeSchemeFiles(base) {
  for (const ext of ['.txt', '.hint', '.config']) {
    const filename = base + ext;
    if (fs.existsSync(filename)) fs.rmSync(filename);
  }
}

export function removeSchemeStorage(name) {
  removeSchemeFiles(legacySchemePath(name));
  removeDirectory(schemeVersionRoot(name));
}

export function publishSchemeVersion(name, versionDirectory) {
  const root = schemeVersionRoot(name);
  const current = path.join(root, 'current');
  const oldBase = schemePath(name);
  let previousTarget = null;
  try {
    if (fs.lstatSync(current).isSymbolicLink()) previousTarget = fs.readlinkSync(current);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const temporaryLink = path.join(root, `.current-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const relativeTarget = path.relative(root, versionDirectory);
  fs.symlinkSync(relativeTarget, temporaryLink, 'dir');
  try {
    fs.renameSync(temporaryLink, current);
  } catch (err) {
    if (fs.existsSync(temporaryLink)) fs.rmSync(temporaryLink);
    throw err;
  }

  const newBase = versionedSchemePath(name);
  return {
    oldBase,
    newBase,
    rollback() {
      const rollbackLink = `${current}.rollback-${process.pid}-${Date.now()}`;
      if (previousTarget !== null) {
        fs.symlinkSync(previousTarget, rollbackLink, 'dir');
        fs.renameSync(rollbackLink, current);
      } else if (fs.existsSync(current)) {
        fs.rmSync(current);
      }
    },
    cleanupPrevious() {
      if (previousTarget !== null) {
        const previousDirectory = path.resolve(root, previousTarget);
        const versionsDirectory = path.resolve(root, 'versions') + path.sep;
        if (previousDirectory.startsWith(versionsDirectory) && previousDirectory !== path.resolve(versionDirectory)) {
          removeDirectory(previousDirectory);
        }
      } else if (oldBase === legacySchemePath(name)) {
        removeSchemeFiles(oldBase);
      }
    }
  };
}

export function linkOrCopy(source, destination) {
  try {
    fs.linkSync(source, destination);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(source, destination);
  }
}
