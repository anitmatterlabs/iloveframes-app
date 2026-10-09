/**
 * Release configuration. Edit these before shipping a build.
 */
export const CONFIG = {
  /** Dodo Payments environment for license calls: 'live' for real customers, 'test' while testing. */
  dodoEnv: 'live' as 'live' | 'test',
  /**
   * Optional: only accept license keys issued for this Dodo product (pdt_...).
   * Leave empty to accept any active key from your Dodo business.
   */
  dodoProductId: '',
  /** Where "Buy a license" sends people (your Dodo checkout / payment link). */
  buyUrl: 'https://iloveframes.app/buy',

  /** Free trial length from the very first launch. */
  trialMs: 24 * 60 * 60 * 1000,
  /** How long a license keeps working without reaching Dodo (offline grace). */
  offlineGraceMs: 14 * 24 * 60 * 60 * 1000,

  /** Update manifest (latest.json) produced by `npm run release`. Host it anywhere static (R2, GitHub Releases, S3...). */
  updateUrl: 'https://iloveframes.app/updates/latest.json',
  /** Ed25519 public key that every update manifest must be signed with (private key lives in keys/, never shipped). */
  updatePublicKey: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAIYiJDoWE7M1in+/7idpXzD1zbLsAaXcCTqegk1JPph4=
-----END PUBLIC KEY-----`
}
