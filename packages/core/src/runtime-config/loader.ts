/**
 * Local config loader — filesystem-only, JSON-only, fail-closed.
 *
 * {@link RuntimeConfigLoader} reads a single local JSON file, validates it into
 * an immutable {@link RuntimeConfigSnapshot}, and optionally watches it for
 * local hot-reload. It is the ONLY component that touches the filesystem for
 * configuration.
 *
 * Hard constraints (Sprint 16 MVP):
 *   - filesystem-local only — `fs.readFileSync` / `fs.watch`, nothing else
 *   - JSON only — no YAML, no URL, no `fetch`, no remote source
 *   - no websocket, no daemon, no cloud sync, no auth, no telemetry
 *   - hot reload is local-only and fail-safe: a bad reload keeps the previous
 *     snapshot active and reports a `config_reload_failed` lifecycle event
 *
 * The loader never stores or surfaces secrets, tokens, or raw request input;
 * lifecycle events carry only minimal metadata (path, version, checksum,
 * reason).
 */

import { readFileSync, watch, FSWatcher } from 'node:fs';
import { RuntimeConfig, RuntimeConfigSnapshot } from './types.js';
import { createSnapshot } from './snapshot.js';
import {
  RuntimeConfigValidationError,
  RuntimeConfigValidationReason,
  parseRuntimeConfig,
  validateRuntimeConfig
} from './validator.js';

/** The lifecycle moments the loader reports. */
export type RuntimeConfigEventType =
  | 'config_loaded'
  | 'config_reloaded'
  | 'config_reload_failed'
  | 'config_validation_failed';

/**
 * A single, secret-free lifecycle event emitted by the loader.
 *
 * `version` / `checksum` are present for successful (re)loads; `reason` is
 * present for failures. `message` is a short, non-sensitive description. The
 * event NEVER carries the file's raw contents.
 */
export interface RuntimeConfigEvent {
  type: RuntimeConfigEventType;
  path?: string;
  version?: number;
  checksum?: string;
  reason?: RuntimeConfigValidationReason | 'read_error';
  message: string;
}

/** Options for a {@link RuntimeConfigLoader}. */
export interface RuntimeConfigLoaderOptions {
  /** Injectable clock for deterministic `loadedAt` timestamps in tests. */
  now?: () => number;
  /** Receives every lifecycle event. Must not throw; errors are swallowed. */
  onEvent?: (event: RuntimeConfigEvent) => void;
}

/**
 * Deterministic, local-only loader for the GRL runtime configuration.
 *
 * It keeps exactly one active snapshot in memory and remembers the path it was
 * loaded from so {@link RuntimeConfigLoader.reload} and the file watcher can
 * re-read the same file.
 */
export class RuntimeConfigLoader {
  private readonly now: () => number;
  private readonly onEvent?: (event: RuntimeConfigEvent) => void;
  private snapshot: RuntimeConfigSnapshot | undefined;
  private path: string | undefined;
  private watcher: FSWatcher | undefined;

  constructor(options: RuntimeConfigLoaderOptions = {}) {
    this.now = options.now ?? Date.now;
    this.onEvent = options.onEvent;
  }

  /** Emit a lifecycle event; a throwing listener never breaks the loader. */
  private emit(event: RuntimeConfigEvent): void {
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch {
      // Lifecycle observation must never break config loading.
    }
  }

  /**
   * Validate an already-parsed value into a typed {@link RuntimeConfig}.
   *
   * Fail-closed: a structurally invalid value throws a
   * {@link RuntimeConfigValidationError} and emits `config_validation_failed`.
   */
  validate(config: unknown): RuntimeConfig {
    try {
      return validateRuntimeConfig(config);
    } catch (error) {
      this.emit({
        type: 'config_validation_failed',
        path: this.path,
        reason:
          error instanceof RuntimeConfigValidationError
            ? error.reason
            : 'invalid_schema',
        message: 'Runtime config validation failed.'
      });
      throw error;
    }
  }

  /**
   * Load and validate the config from a local JSON file, replacing the active
   * snapshot. Emits `config_loaded` on success.
   *
   * A read failure (e.g. missing file) throws the underlying Node error
   * (`error.code === 'ENOENT'` for a missing file). A malformed file throws a
   * {@link RuntimeConfigValidationError} and emits `config_validation_failed`.
   */
  loadFromFile(path: string): RuntimeConfigSnapshot {
    const text = this.readFile(path);
    let config: RuntimeConfig;
    try {
      config = parseRuntimeConfig(text);
    } catch (error) {
      this.emit({
        type: 'config_validation_failed',
        path,
        reason:
          error instanceof RuntimeConfigValidationError
            ? error.reason
            : 'invalid_schema',
        message: 'Runtime config validation failed.'
      });
      throw error;
    }
    const snapshot = createSnapshot(config, this.now());
    this.snapshot = snapshot;
    this.path = path;
    this.emit({
      type: 'config_loaded',
      path,
      version: snapshot.version,
      checksum: snapshot.checksum,
      message: 'Runtime config loaded.'
    });
    return snapshot;
  }

  /**
   * Re-read the previously loaded file and replace the active snapshot.
   *
   * Fail-safe: if the re-read or validation fails, the PREVIOUS snapshot is kept
   * active, a `config_reload_failed` event is emitted, and the error is
   * re-thrown so the caller can report it. On success a fresh immutable snapshot
   * replaces the active one and `config_reloaded` is emitted.
   */
  reload(): RuntimeConfigSnapshot {
    if (this.path === undefined) {
      throw new Error('No runtime config file has been loaded to reload.');
    }
    const path = this.path;
    let text: string;
    try {
      text = this.readFile(path);
    } catch (error) {
      this.emit({
        type: 'config_reload_failed',
        path,
        reason: 'read_error',
        message: 'Runtime config reload failed: file could not be read.'
      });
      throw error;
    }
    let config: RuntimeConfig;
    try {
      config = parseRuntimeConfig(text);
    } catch (error) {
      this.emit({
        type: 'config_reload_failed',
        path,
        reason:
          error instanceof RuntimeConfigValidationError
            ? error.reason
            : 'invalid_schema',
        message: 'Runtime config reload failed: validation error.'
      });
      throw error;
    }
    const snapshot = createSnapshot(config, this.now());
    this.snapshot = snapshot;
    this.emit({
      type: 'config_reloaded',
      path,
      version: snapshot.version,
      checksum: snapshot.checksum,
      message: 'Runtime config reloaded.'
    });
    return snapshot;
  }

  /** Return the active snapshot, or `undefined` if nothing has been loaded. */
  getSnapshot(): RuntimeConfigSnapshot | undefined {
    return this.snapshot;
  }

  /** The path the active snapshot was loaded from, if any. */
  getPath(): string | undefined {
    return this.path;
  }

  /**
   * Watch the loaded (or supplied) file for local changes and hot-reload.
   *
   * Uses `fs.watch` ONLY — no websocket, no remote push, no external daemon. On
   * every change the file is reloaded; a failed reload is fully contained (the
   * previous snapshot stays active and `config_reload_failed` is emitted), so
   * the watcher never throws into the host process.
   */
  watch(path?: string): void {
    const target = path ?? this.path;
    if (target === undefined) {
      throw new Error('No runtime config file to watch.');
    }
    this.path = target;
    this.stopWatching();
    this.watcher = watch(target, () => {
      try {
        this.reload();
      } catch {
        // Already reported via config_reload_failed; never crash the watcher.
      }
    });
  }

  /** Stop watching the config file, if a watcher is active. */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }

  /**
   * Clear all in-memory state: drop the active snapshot, forget the loaded
   * path, and stop any active watcher. Purely in-memory — no file is deleted.
   */
  clear(): void {
    this.stopWatching();
    this.snapshot = undefined;
    this.path = undefined;
  }

  /** Read a local file as UTF-8 text. The only filesystem read the loader does. */
  private readFile(path: string): string {
    return readFileSync(path, 'utf8');
  }
}
