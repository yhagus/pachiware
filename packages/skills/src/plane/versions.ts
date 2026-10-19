/**
 * The Plane versions the Plane skill supports, hard-coded because each needs its own tool code (ADR 0016). A Plane account names
 * one: it decides the headers every request carries and which Plane tools the account offers. An entry that has shipped keeps
 * its meaning, so a Plane release that changes the API gets a new entry, and accounts still on the older release keep working.
 */

export interface PlaneVersion {
  /** Stored on the Plane account; never reused for another meaning. */
  id: string;
  label: string;
  /** The Plane releases this entry was written for: from `from`, up to but not including `before`. */
  releases: { from: string; before: string };
  /** The Plane release its tools were checked against. */
  checkedAgainst: string;
  /** The credential an admin gives for an account on this version. */
  auth: "api-key";
  /** The headers that carry the account's credential on every request. */
  headers(secret: string): Record<string, string>;
}

/** Oldest first; the last entry is the newest. */
export const PLANE_VERSIONS: readonly PlaneVersion[] = [
  {
    id: "1.3", label: "Plane 1.3", releases: { from: "1.3.0", before: "1.4.0" }, checkedAgainst: "v1.3.1",
    auth: "api-key", headers: (key) => ({ "X-Api-Key": key }),
  },
];

export const findPlaneVersion = (id: string, versions: readonly PlaneVersion[] = PLANE_VERSIONS): PlaneVersion | null =>
  versions.find((v) => v.id === id) ?? null;

export const newestPlaneVersion = (versions: readonly PlaneVersion[] = PLANE_VERSIONS): PlaneVersion => versions[versions.length - 1]!;

/** True when a Plane tool exists on the version: its policy lists that version, or lists none. An unknown version has no tools. */
export const versionHasTool = (version: PlaneVersion | null, policy?: { versions?: string[] }): boolean =>
  !!version && (!policy?.versions || policy.versions.includes(version.id));

type Named = { name: string; planeVersion: string };

/** An account's Plane version in words, after its name: "is on Plane 1.3", or that this server does not know the one it stores. */
export function onPlaneVersion(account: Named, versions: readonly PlaneVersion[] = PLANE_VERSIONS): string {
  const version = findPlaneVersion(account.planeVersion, versions);
  return version ? `is on ${version.label}` : `is set to Plane version "${account.planeVersion}", which this server does not know`;
}

export const CHOOSE_PLANE_VERSION = "An admin can choose a supported version in the console.";

/** The refusal for an account whose stored version this server does not know, e.g. after going back to an older Pachiware. */
export const unknownPlaneVersion = (account: Named) => `Plane account "${account.name}" ${onPlaneVersion(account)}. ${CHOOSE_PLANE_VERSION}`;

/** A Plane release as Plane names it (`v1.3.1`, `1.3.1`, `v1.3.2-ce`) read as major, minor and patch; null when it is not one. */
export function parseRelease(text: string | null | undefined): [number, number, number] | null {
  const m = /^\s*v?(\d+)\.(\d+)(?:\.(\d+))?/i.exec(text ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

const before = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The Plane version whose releases cover this release, or null when none does. */
export function versionForRelease(release: string | null | undefined, versions: readonly PlaneVersion[] = PLANE_VERSIONS): PlaneVersion | null {
  const r = parseRelease(release);
  if (!r) return null;
  return versions.find((v) => before(r, parseRelease(v.releases.from)!) >= 0 && before(r, parseRelease(v.releases.before)!) < 0) ?? null;
}

/**
 * What the console says when the release the Plane server last reported falls outside the account's Plane version, naming the
 * version that covers it when there is one; null when they agree, or when either is unknown.
 */
export function versionNote(account: { baseUrl: string | null; planeVersion: string; planeServerVersion: string | null }, versions: readonly PlaneVersion[] = PLANE_VERSIONS): string | null {
  const chosen = findPlaneVersion(account.planeVersion, versions);
  if (!chosen || !parseRelease(account.planeServerVersion)) return null;
  const covering = versionForRelease(account.planeServerVersion, versions);
  if (covering?.id === chosen.id) return null;
  const where = account.baseUrl ? `Plane at ${new URL(account.baseUrl).host}` : "Plane's cloud";
  return `${where} reports ${account.planeServerVersion}; this account is set to ${chosen.label} (checked against ${chosen.checkedAgainst}). ${covering ? `Choose ${covering.label}.` : "Some tools may fail."}`;
}
