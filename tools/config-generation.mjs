import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateJsonValue } from '../src/config/json.mjs';

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function rejectSymlinks(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Generated output must not traverse symbolic links or junctions');
      if (current !== target && !stat.isDirectory()) throw new Error('Generated output parent is not a directory');
      if (current === target && !stat.isFile()) throw new Error('Generated output target is not a file');
      const canonical = await fs.realpath(current);
      if (!isWithin(root, canonical)) throw new Error('Generated output resolves outside the project root');
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
}

/**
 * Only generated/** and top-level config/*.generated.json are writable.
 * custom.json, src/extensions, and all other hand-maintained paths are excluded.
 * The project root must already exist. Symlink/junction traversal is rejected.
 */
export async function assertGeneratedTarget(projectRoot, outputPath) {
  if (typeof projectRoot !== 'string' || !projectRoot || typeof outputPath !== 'string'
    || !outputPath || outputPath.includes('\0')) {
    throw new TypeError('A project root and nonempty generated output path are required');
  }
  const root = await fs.realpath(path.resolve(projectRoot));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Project root must be a directory');
  const target = path.resolve(root, outputPath);
  if (!isWithin(root, target)) throw new Error('Generated output must remain within the project root');
  const parts = path.relative(root, target).split(path.sep);
  // Reject Windows alternate data streams, device paths, and names which Windows
  // normalizes to another filename. Apply the portable rule on every platform.
  if (parts.some((part) => /[\x00-\x1f<>:"|?*]/.test(part) || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    throw new Error('Generated output contains an unsafe or nonportable filename');
  }
  const allowed = (parts[0] === 'generated' && parts.length >= 2)
    || (parts[0] === 'config' && parts.length === 2 && /^.+\.generated\.json$/.test(parts[1]));
  if (!allowed) throw new Error('Generated output is restricted to generated/ or config/*.generated.json');
  await rejectSymlinks(root, target);
  return target;
}

/** Atomically replace an allowed generated JSON file; never write user files. */
export async function writeGeneratedJsonAtomic(projectRoot, outputPath, value, { space = 2 } = {}) {
  validateJsonValue(value, { label: 'generated JSON' });
  if (!Number.isInteger(space) || space < 0 || space > 10) throw new TypeError('space: expected an integer from 0 to 10');
  const contents = `${JSON.stringify(value, null, space)}\n`;
  const target = await assertGeneratedTarget(projectRoot, outputPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await assertGeneratedTarget(projectRoot, outputPath);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await assertGeneratedTarget(projectRoot, outputPath);
    await fs.rename(temporary, target);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') error.cleanupError = cleanupError;
    });
    throw error;
  }
  return target;
}
