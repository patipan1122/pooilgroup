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
    // เครื่องจริงส่ง IdentifyType เป็นสตริง ("3") — ต้องแปลงเป็นเลขก่อนเทียบ ไม่งั้นทุกชนิดกลายเป็น 0
    const identifyType = typeof r.IdentifyType === "number" ? r.IdentifyType
      : typeof r.IdentifyType === "string" ? Number(r.IdentifyType) : 0;
    // IdentifyType 3 = อ่านบัตร IC · เครื่องรับบาร์โค้ดจากเครื่องสแกน USB เป็น "เลขบัตร" (เฉพาะตัวเลข ≤10 หลัก)
    const icNum = typeof r.icNum === "string" ? r.icNum.trim() : typeof r.icNum === "number" ? String(r.icNum) : "";
    const cardNo = identifyType === 3 && /^\d{1,10}$/.test(icNum) ? icNum : null;

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
    else if (resultStatus === 0) type = cardNo ? "unrecognized" : "stranger"; // เลขบัตรที่ไม่อยู่ในรายชื่อ ≠ คนแปลกหน้า
    else if (identifyType === 1) type = "stranger";  // blacklist hit
    else type = "recognized";

    const employeeNumber = typeof r.employee_number === "string" ? r.employee_number
      : typeof r.employee_number === "number" ? String(r.employee_number) : null;

    // Trust the device's own clock for eventAt (it's the moment the real-world
    // scan happened, not when our webhook received it) — BUT clamp against
    // drift. Confirmed live 2026-09-30: both devices' clocks had silently
    // drifted ~1h ahead (no battery-backed RTC + nightly auto-reboot via
    // `rebootTime` param), which fed a wrong checkInAt/expiresAt straight
    // into billing (overtime fee calc) and the re-entry grace window. If the
    // device disagrees with our server by more than a few minutes, something
    // is wrong with ITS clock, not reality — fall back to server time.
    const MAX_DEVICE_CLOCK_DRIFT_MS = 5 * 60_000;
    const now = new Date();
    const timeStr = typeof r.time === "string" ? r.time : null;
    const deviceReportedAt = timeStr ? new Date(timeStr.replace(" ", "T") + "+07:00") : null;
    const driftOk = deviceReportedAt && Math.abs(deviceReportedAt.getTime() - now.getTime()) <= MAX_DEVICE_CLOCK_DRIFT_MS;
    if (deviceReportedAt && !driftOk) {
      console.warn("[playland/acs] device clock drift too large, using server time", {
        deviceReportedAt: deviceReportedAt.toISOString(),
        serverNow: now.toISOString(),
      });
    }
    const eventAt = driftOk ? (deviceReportedAt as Date) : now;

    return {
      webhookId: id,
      faceId: type === "recognized" ? employeeNumber : null,
      qrCode,
      cardNo,
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
