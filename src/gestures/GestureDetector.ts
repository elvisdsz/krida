export interface GestureState {
  /** Confidence score between 0 and 1 indicating the likelihood that the gesture is currently being performed. */
  readonly confidence: number;

  /** Whether the gesture is currently considered active based on the confidence and any internal state. */
  readonly isActive: boolean;

  /** Whether the gesture was just activated in the current frame (i.e. transitioned from inactive to active). */
  readonly justActivated: boolean;

  /** Whether the gesture was just deactivated in the current frame (i.e. transitioned from active to inactive). */
  readonly justDeactivated: boolean;

  /** startTimeMs when last activated; -1 if inactive. */
  readonly activeSince: number;

  /** Optional position associated with the gesture, or null if not applicable. */
  readonly position: { x: number; y: number; z: number } | null;
}

export interface GestureOptions {
  /** Override the gesture name/ID. Default varies per detector. */
  name?: string;
  /** Confidence threshold to enter active state. Default varies per detector. */
  activateAt?: number;
  /** Confidence threshold to leave active state. Must not exceed activateAt. Default varies per detector. */
  deactivateAt?: number;
  /** Consecutive frames of high confidence required before activating. Default varies per detector. */
  holdFrames?: number;
}

/** Raw output of a detector's gesture-specific computation, before the state machine is applied. */
export interface GestureReading {
  confidence: number;
  position: { x: number; y: number; z: number } | null;
}

export abstract class GestureDetector<TResult extends { startTimeMs: number }> {
  readonly name: string;
  private readonly _activateAt: number;
  private readonly _deactivateAt: number;
  private readonly _holdFrames: number;

  private _isActive = false;
  private _activeSince = -1;
  private _holdCount = 0;

  constructor(
    defaultName: string,
    defaults: Required<Omit<GestureOptions, "name">>,
    options: GestureOptions = {},
  ) {
    this.name = options.name ?? defaultName;
    this._activateAt = options.activateAt ?? defaults.activateAt;
    this._deactivateAt = options.deactivateAt ?? defaults.deactivateAt;
    this._holdFrames = options.holdFrames ?? defaults.holdFrames;

    if (this._deactivateAt > this._activateAt) {
      throw new Error(
        `Gesture '${this.name}': deactivateAt (${this._deactivateAt}) must be less than or equal to activateAt (${this._activateAt})`,
      );
    }
  }

  /** Compute the raw confidence and spatial anchor for this gesture. Implemented by each concrete detector. */
  protected abstract detect(trackerResult: TResult): GestureReading;

  update(trackerResult: TResult): GestureState {
    const wasActive = this._isActive;
    const { confidence, position } = this.detect(trackerResult);

    if (this._isActive) {
      if (confidence < this._deactivateAt) {
        this._isActive = false;
        this._holdCount = 0;
      }
    } else {
      if (confidence >= this._activateAt) {
        if (++this._holdCount >= this._holdFrames) {
          this._isActive = true;
        }
      } else {
        this._holdCount = 0;
      }
    }

    const justActivated = !wasActive && this._isActive;
    const justDeactivated = wasActive && !this._isActive;

    if (justActivated) this._activeSince = trackerResult.startTimeMs;
    else if (justDeactivated) this._activeSince = -1;

    return {
      confidence,
      isActive: this._isActive,
      justActivated,
      justDeactivated,
      activeSince: this._activeSince,
      position,
    };
  }

  reset(): void {
    this._isActive = false;
    this._activeSince = -1;
    this._holdCount = 0;
  }
}
