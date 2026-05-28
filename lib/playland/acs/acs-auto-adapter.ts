// Real ACS-Auto adapter (ACS-F606 face reader · HTTP LAN protocol)
// Spec: /docs/acs/README.md (extracted from official PDFs · 2026-05-26)
// Memory: [[acs-f606-api-spec-received]]
//
// Direction matrix:
//   • Server→Device: this adapter POSTs to http://<deviceIp>:8091/<endpoint>
//                    REQUIRES LAN reachability (NAT may block from cloud)
//   • Device→Server: device POSTs to platformIp (configured in
//                    /setIdentifyCallBck) · we receive at /api/playland/acs/event
//
// Auth: password in body (default 123456 · stored encrypted in
// playland_acs_devices.secretEncrypted). No signature in webhook · trust based
// on caller IP / known platformIp + optional ?secret= URL param.

import type {
  ACSAdapter,
  ACSDeviceConfig,
  ACSEvent,
  RegisterFaceInput,
  RegisterFaceResult,
} from "./types";

const DEFAULT_TIMEOUT_MS = 8_000;

async function deviceFetch(device: ACSDeviceConfig, path: string, body: unknown): Promise<unknown> {
  if (!device.baseUrl) throw new Error("device baseUrl not configured · cannot reach device");
  const password = device.apiToken ?? "123456";
  const url = `${device.baseUrl.replace(/\/$/, "")}/${path}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, ...(typeof body === "object" && body ? body : {}) }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ACS ${path} HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export const acsAutoAdapter: ACSAdapter = {
  vendor: "acs-auto",

  /**
   * Register a face on the device's whitelist.
   * We use Pool member.id as `employee_number` so the device's recognition
   * event payload carries our id directly · no extra lookup needed.
   */
  async registerFace(input: RegisterFaceInput, device: ACSDeviceConfig): Promise<RegisterFaceResult> {
    const photoBase64 = input.photo.toString("base64");
    const meta = (input.metadata ?? {}) as Record<string, unknown>;
    await deviceFetch(device, "addDeviceWhiteList", {
      totalnum: 1,
      currentnum: 1,
      data: {
        usertype: "white",
        employee_number: input.memberId,
        name: meta.name ?? "",
        sex: meta.sex ?? "",
        peoplestartdate: meta.startDate ?? new Date().toISOString().slice(0, 10),
        peopleenddate: meta.endDate ?? "",
        passAlgo: false,
        TimeGroupId: 0,
        register_base64: photoBase64,
      },
    });
    // Device returns no faceId · our memberId IS the face_id we track
    return { faceId: input.memberId, syncedAt: new Date() };
  },

  async deleteFace(faceId: string, device: ACSDeviceConfig): Promise<void> {
    await deviceFetch(device, "deleteDeviceWhiteList", {
      data: { employee_number: faceId, usertype: "white" },
    });
  },

  async listFaces(device: ACSDeviceConfig) {
    const res = await deviceFetch(device, "getAllDeviceIdWhiteList", {}) as { data?: string };
    if (!res?.data) return [];
    try {
      const parsed = JSON.parse(res.data) as { idList?: string[] };
      return (parsed.idList ?? []).map((id) => ({ faceId: id }));
    } catch {
      return [];
    }
  },

  /**
   * Device push has no signature · auth is "knowledge of platformIp" + we
   * optionally check ?secret= URL query (set when pairing). Reject if our
   * configured webhookSecret is set AND query mismatches · accept otherwise.
   */
  verifyWebhook(_rawBody: string, secret: string, _headers: Record<string, string>, urlQuery: URLSearchParams): boolean {
    if (!secret) return true;
    const provided = urlQuery.get("secret") ?? urlQuery.get("token");
    return provided === secret;
  },

  /**
   * Normalize the doc-2 recognition event into our generic ACSEvent shape.
   * Doc-2 schema: id · Mac_addr · time · employee_number · name · inout ·
   * IdentifyType · resultStatus · face_base64 · temperature
   */
  normalizeEvent(raw: unknown): ACSEvent | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;

    const id = typeof r.id === "string" ? r.id : null;
    if (!id) return null;

    const resultStatus = typeof r.resultStatus === "number" ? r.resultStatus
      : typeof r.resultStatus === "string" ? Number(r.resultStatus) : 1;
    const inout = typeof r.inout === "number" ? r.inout
      : typeof r.inout === "string" ? Number(r.inout) : 1;
    const identifyType = typeof r.IdentifyType === "number" ? r.IdentifyType : 0;

    // QR scan detection · field name TBC by Lily (likely qrCode/qr/barcode/QRCode)
    const qrCode =
      typeof r.qrCode === "string" ? r.qrCode :
      typeof r.qr === "string" ? r.qr :
      typeof r.QRCode === "string" ? r.QRCode :
      typeof r.barcode === "string" ? r.barcode :
      null;

    // Map type: QR scan wins · then face match outcomes
    let type: ACSEvent["type"];
    if (qrCode) type = "qr_scan";
    else if (resultStatus === 0) type = "stranger";
    else if (identifyType === 1) type = "stranger";  // blacklist hit
    else type = "recognized";

    const employeeNumber = typeof r.employee_number === "string" ? r.employee_number
      : typeof r.employee_number === "number" ? String(r.employee_number) : null;

    const timeStr = typeof r.time === "string" ? r.time : null;
    const eventAt = timeStr ? new Date(timeStr.replace(" ", "T") + "+07:00") : new Date();

    return {
      webhookId: id,
      faceId: type === "recognized" ? employeeNumber : null,
      qrCode,
      type,
      direction: inout === 0 ? "out" : inout === 1 ? "in" : "unknown",
      confidence: null,                         // doc doesn't expose match score in event
      snapshotData: typeof r.face_base64 === "string" ? r.face_base64 : null,
      eventAt,
      raw,
    };
  },

  async emergencyOpen(device: ACSDeviceConfig): Promise<void> {
    await deviceFetch(device, "setDeviceRemoteOpen", {});
  },
};

// Convenience: configure device to push events to our webhook (called once at pairing)
export async function bindDeviceToWebhook(
  device: ACSDeviceConfig,
  webhookUrl: string,
): Promise<void> {
  await deviceFetch(device, "setIdentifyCallBck", {
    platformEnable: 1,
    platformIp: webhookUrl,
  });
}

// Convenience: read device firmware + parameters (pairing verification)
export async function getDeviceInfo(device: ACSDeviceConfig): Promise<{
  version: { device_name?: string; firmware_version?: string; macaddr?: string; model?: string } | null;
  parameters: Record<string, unknown> | null;
}> {
  const [versionRes, paramRes] = await Promise.all([
    deviceFetch(device, "getDeviceVersion", {}).catch(() => null) as Promise<{ data?: Record<string, unknown> } | null>,
    deviceFetch(device, "getDeviceParameter", {}).catch(() => null) as Promise<{ data?: Record<string, unknown> } | null>,
  ]);
  return {
    version: (versionRes?.data ?? null) as { device_name?: string; firmware_version?: string; macaddr?: string; model?: string } | null,
    parameters: paramRes?.data ?? null,
  };
}
