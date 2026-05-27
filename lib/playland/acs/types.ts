// Playland · ACS device adapter interface
//
// Why adapter pattern: ACS-F606 may be replaced by other face-reader vendors
// (Hikvision, ZKTeco, Dahua). Each speaks different protocol but the app needs
// 4 capabilities: register face · delete face · receive recognition events ·
// trigger emergency open.
//
// Per [[acs-architecture-confirmed]]: device dials OUT to our public webhook ·
// for Version C devices we PUSH faces via TCP or HTTP polling.
// HTTPS NOT supported · auth via shared secret in URL query (no HMAC).

export type ACSDirection = "in" | "out" | "unknown";

export type ACSEventType =
  | "recognized"
  | "unrecognized"
  | "tailgate"
  | "stranger"
  | "door_open"
  | "heartbeat"
  | "qr_scan"
  | "error";

/** Normalized event after vendor-specific payload is decoded. */
export interface ACSEvent {
  /** Unique per-event ID from device · used for idempotency in DB. */
  webhookId: string;
  /** Vendor's internal face ID (string). null = unrecognized face. */
  faceId: string | null;
  /** Raw QR text from QR scanner (only set when type === "qr_scan"). */
  qrCode: string | null;
  type: ACSEventType;
  direction: ACSDirection;
  /** 0-100 confidence score · null if N/A. */
  confidence: number | null;
  /** Snapshot image (base64 or URL) the device captured · for audit. */
  snapshotData: string | null;
  /** Timestamp from the device (may be ahead/behind our clock). */
  eventAt: Date;
  /** Raw vendor payload for debugging. */
  raw: unknown;
}

export interface RegisterFaceInput {
  /** Local member ID (our DB) — adapter returns vendor face_id after success. */
  memberId: string;
  /** Photo file buffer (JPEG/PNG). */
  photo: Buffer;
  /** Optional metadata vendor accepts (name, validUntil, accessGroup). */
  metadata?: Record<string, unknown>;
}

export interface RegisterFaceResult {
  faceId: string;
  syncedAt: Date;
}

export interface ACSAdapter {
  readonly vendor: string;

  /** Push a new face to the device · returns vendor face_id. */
  registerFace(input: RegisterFaceInput, device: ACSDeviceConfig): Promise<RegisterFaceResult>;

  /** Remove a face from the device (member deactivated/deleted). */
  deleteFace(faceId: string, device: ACSDeviceConfig): Promise<void>;

  /** Optional: list all faces currently on the device for reconciliation. */
  listFaces?(device: ACSDeviceConfig): Promise<Array<{ faceId: string; memberRef?: string }>>;

  /** Verify an inbound webhook payload (signature check or shared secret in URL). */
  verifyWebhook(rawBody: string, secret: string, headers: Record<string, string>, urlQuery: URLSearchParams): boolean;

  /** Decode vendor payload → normalized event. Returns null if not parseable. */
  normalizeEvent(rawPayload: unknown): ACSEvent | null;

  /** Optional: trigger emergency door open from server (TCP push). */
  emergencyOpen?(device: ACSDeviceConfig): Promise<void>;
}

export interface ACSDeviceConfig {
  id: string;
  deviceId: string;
  baseUrl: string | null;
  protocol: "http" | "tcp";
  modelVersion: "B" | "C";
  webhookSecret: string;
  /** Decrypted device API token if vendor requires auth. */
  apiToken?: string;
}
