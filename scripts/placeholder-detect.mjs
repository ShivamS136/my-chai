/**
 * Pure detection logic for the "you forgot to replace the example" guard.
 *
 * Split from `check-placeholder.mjs` so it can be unit-tested without spawning a
 * process or touching the filesystem. Dependency-free, no I/O.
 *
 * Why this exists: `creator.vpa` ships as `yourname@bank`, which is a *valid* VPA
 * format and therefore passes the Zod schema. That is deliberate — the example must
 * typecheck and build in CI. But a fork that deploys it would publish a page whose
 * QR points at nobody, so a separate check blocks the deploy.
 */

/** VPAs that ship in this repo's example and must never reach a deployed page. */
export const PLACEHOLDER_VPAS = ['yourname@bank', 'example@upi', 'name@bank', 'your.name@bank'];

/** Creator names that indicate an unedited example. */
export const PLACEHOLDER_NAMES = ['Your Name', 'Creator Name', 'Your name here'];

/**
 * @typedef {object} PlaceholderFinding
 * @property {string} path   Config path, e.g. "creator.vpa".
 * @property {string} value  The offending value.
 * @property {string} message Actionable, creator-facing.
 */

/**
 * Finds unreplaced placeholder values in a parsed config.
 *
 * Matching is case-insensitive and trims, so `  YourName@Bank ` is still caught —
 * a creator who "edited" only the capitalisation has not actually set their VPA.
 *
 * @param {unknown} config Parsed config object.
 * @returns {PlaceholderFinding[]} Empty when the config looks genuinely edited.
 */
export function findPlaceholders(config) {
  /** @type {PlaceholderFinding[]} */
  const findings = [];
  if (typeof config !== 'object' || config === null) return findings;

  const creator = /** @type {{creator?: unknown}} */ (config).creator;
  if (typeof creator !== 'object' || creator === null) return findings;

  const { vpa, name } = /** @type {{vpa?: unknown, name?: unknown}} */ (creator);

  if (typeof vpa === 'string' && PLACEHOLDER_VPAS.includes(vpa.trim().toLowerCase())) {
    findings.push({
      path: 'creator.vpa',
      value: vpa,
      message:
        `Still set to the example UPI ID "${vpa}". Replace it with YOUR UPI ID ` +
        '(UPI app → profile → "UPI ID"), or every donation goes nowhere.',
    });
  }

  if (
    typeof name === 'string' &&
    PLACEHOLDER_NAMES.some((n) => n.toLowerCase() === name.trim().toLowerCase())
  ) {
    findings.push({
      path: 'creator.name',
      value: name,
      message: `Still set to the example name "${name}". Put your own display name here.`,
    });
  }

  return findings;
}
