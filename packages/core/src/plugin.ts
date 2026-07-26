/**
 * The shared lifecycle every first-party DevLens plugin implements
 * (Runtime, Console, Network, React, ...). Discovered from building
 * Runtime, not speculated in advance — Console is the second real
 * consumer, which is what justifies extracting this now.
 *
 * Both methods must be idempotent: calling install() while already
 * installed, or uninstall() while not installed, is a no-op rather
 * than an error or a duplicate registration.
 */
export interface Plugin {
  install(): void;
  uninstall(): void;
}