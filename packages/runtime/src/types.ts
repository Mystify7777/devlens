export interface RuntimePlugin {
  /** Attaches listeners. Calling install() while already installed is a no-op. */
  install(): void;
  /** Removes listeners. Calling uninstall() while not installed is a no-op. */
  uninstall(): void;
}