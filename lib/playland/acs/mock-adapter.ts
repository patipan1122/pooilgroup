// Mock ACS adapter — works without real hardware
// Lets us build/test the entire app while waiting for ACS-F606 device + API docs
//
// Behavior:
//   • registerFace returns a fake face_id (MOCK-{memberId.slice(0,8)})
//   • deleteFace is a no-op
//   • verifyWebhook accepts any request where ?secret=<webhookSecret> matches
//   • normalizeEvent expects a simple JSON envelope:
//       { webhookId, faceId, type, direction, confidence, eventAt, snapshot? }

import type { ACSAdapter, ACSEvent, ACSDeviceConfig, RegisterFaceInput, RegisterFaceResult } from "./types";

export const mockAdapter: ACSAdapter = {
  vendor: "mock",

  async registerFace(input: RegisterFaceInput, _device: ACSDeviceConfig): Promise<RegisterFaceResult> {
    // Simulate network latency
    await new Promise((r) => setTimeout(r, 80));
    return {
      faceId: `MOCK-${input.memberId.replace(/-/g, "").slice(0, 12).toUpperCase()}`,
      syncedAt: new Date(),
    };
  },

  async deleteFace(_faceId: string, _device: ACSDeviceConfig): Promise<void> {
    await new Promise((r) => setTimeout(r, 40));
  },

  async listFaces(_device: ACSDeviceConfig) {
    return [];
  },

  verifyWebhook(_rawBody, secret, _headers, urlQuery) {
    const provided = urlQuery.get("secret") ?? urlQuery.get("token");
    return Boolean(secret) && provided === secret;
  },

  normalizeEvent(raw: unknown): ACSEvent | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const webhookId = typeof r.webhookId === "string" ? r.webhookId : typeof r.id === "string" ? r.id : null;
    if (!webhookId) return null;

    const type = (typeof r.type === "string" ? r.type : "recognized") as ACSEvent["type"];
    const direction = (typeof r.direction === "string" ? r.direction : "unknown") as ACSEvent["direction"];

    return {
      webhookId,
      faceId: typeof r.faceId === "string" ? r.faceId : null,
      type,
      direction,
      confidence: typeof r.confidence === "number" ? r.confidence : null,
      snapshotData: typeof r.snapshot === "string" ? r.snapshot : null,
      eventAt: r.eventAt ? new Date(r.eventAt as string) : new Date(),
      raw,
    };
  },

  async emergencyOpen(_device: ACSDeviceConfig): Promise<void> {
    // mock: no-op · in real adapter we POST to device baseUrl
  },
};

export const acsAutoAdapterStub: ACSAdapter = {
  // Stub for real ACS-Auto vendor · implementation pending API docs
  // For now, delegates to mock so dev can proceed
  ...mockAdapter,
  vendor: "acs-auto",
};

export function getAdapter(vendor: string): ACSAdapter {
  switch (vendor) {
    case "acs-auto":
      return acsAutoAdapterStub;
    case "mock":
    default:
      return mockAdapter;
  }
}
