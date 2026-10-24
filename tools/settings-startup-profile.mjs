/** Read-only QA expectations for the actual external configuration document. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mergeConfiguration } from '../src/config/index.mjs';
import { validateCoreConfiguration } from '../src/core/index.mjs';
import { profileFromConfiguration } from '../src/customization/schema.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The envelope profile is only metadata. Compare the entire merged document,
 * including unexposed extensions, rather than whitelist particular override keys. */
export function expectedSettingsStartup(defaults, custom) {
  const effective = mergeConfiguration(defaults, custom, { validateEffective: validateCoreConfiguration });
  const mode = JSON.stringify(defaults) === JSON.stringify(effective) ? 'original' : 'custom';
  return { mode, editorProfile: profileFromConfiguration(effective),
    observableConfig: { profile: effective.profile, firstUnitCost: effective.units[0].cost,
      firstUnitHp: effective.units[0].hp, startingIncome: effective.rules.startingIncome, frameRate: effective.rules.frameRate },
    evidence: { expectedMode: mode, envelopeProfile: custom.profile ?? null,
      effectiveProfile: effective.profile, overrideKeys: Object.keys(custom.overrides).sort(),
      defaultsSha256: digest(defaults), customDocumentSha256: digest(custom), effectiveConfigurationSha256: digest(effective) } };
}

/** Reads the served defaults (including packaged ASAR contents), and the real
 * portable custom file. Browser mode reads its actual served custom document. */
export async function readSettingsStartup(page, directory = null) {
  async function served(relative) {
    const response = await page.request.get(new URL(relative, page.url()).href, { timeout: 15000 });
    if (!response.ok()) throw new Error(`Unable to read startup ${relative}: ${response.status()}`);
    return response.json();
  }
  const defaults = await served('config/defaults.generated.json');
  const custom = directory ? JSON.parse(fs.readFileSync(path.join(directory, 'config/custom.json'), 'utf8')) : await served('config/custom.json');
  return { defaults, expected: expectedSettingsStartup(defaults, custom) };
}

export function matchesSettingsStartup(state, expected) {
  const editor = state?.customization?.editor, modes = state?.customization?.rulesMode;
  if (!expected || !editor || !modes || modes.current !== expected.mode || modes.next !== expected.mode
    || editor.mode !== expected.mode || editor.nextMode !== expected.mode) return false;
  return Object.entries(expected.observableConfig).every(([key, value]) => isDeepStrictEqual(state.config?.[key], value))
    && isDeepStrictEqual(editor.applied, expected.editorProfile) && isDeepStrictEqual(editor.next, expected.editorProfile);
}

/** Persisted drafts are intentionally excluded: they may differ after restart,
 * but neither applied nor staged-next rules may silently become that draft. */
export function sameEffectiveSettingsStartup(initial, restarted) {
  const identity = state => state?.customization?.editor ? {
    config: state.config, modes: state.customization.rulesMode,
    mode: state.customization.editor.mode, nextMode: state.customization.editor.nextMode,
    applied: state.customization.editor.applied, next: state.customization.editor.next,
  } : null;
  const first = identity(initial), second = identity(restarted);
  return Boolean(first && second && isDeepStrictEqual(first, second));
}
