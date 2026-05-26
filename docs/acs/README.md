# ACS-F606 Face Reader · Protocol Reference

> Extracted from official PDFs received from Lilly Huang (ACS Auto) on 2026-05-26
> Source: `acs-doc-1.pdf` (70-page MQTT cloud protocol) + `acs-doc-2.pdf` (41-page HTTP LAN protocol)
> We use **doc-2 HTTP** (doc-1 MQTT would require us to run an EMQX broker · out of scope)

---

## ⚠️ Contradictions with Lilly's earlier chat (per [[acs-f606-vendor-info]])

| Lilly said | PDF actually says | Truth |
|---|---|---|
| GB2312 encoding | UTF-8 | **UTF-8** per doc-2 §1.2 |
| Cloud-only API | Local HTTP on port 8091 | LAN-direct + outbound push to our URL |
| Vendor cloud webhook | Device pushes directly to our `platformIp` | Direct |
| Has REST API | Has POST endpoints (close enough to REST) | OK |

## Connection facts

- **Protocol:** HTTP only · port 8091 default · NO HTTPS documented
- **Encoding:** UTF-8 (not GB2312)
- **Auth:** `password` field in request body (default `123456`)
- **Default user:** unspecified · password-only
- **NAT direction:**
  - Device → our server: ✅ via `platformIp` setting (device POSTs outbound)
  - Our server → device: ⚠️ needs LAN reachability (device IP must be routable)
- **First call:** `POST http://<deviceIp>:8091/deviceLogin` with `{"password":"123456"}`

## Critical endpoints

### Configure device to push events to us

```http
POST http://<deviceIp>:8091/setIdentifyCallBck
Content-Type: application/json

{
  "password": "123456",
  "platformEnable": 1,
  "platformIp": "https://pooilgroup.vercel.app/api/playland/acs/event"
}
```

Response: `{"message":"set identify callback success","result":0}`

⚠️ Vercel forces HTTPS · device docs only show `http://` examples · MAY need to test if device tolerates HTTPS or needs an HTTP-only proxy.

### Register a face (whitelist)

```http
POST http://<deviceIp>:8091/addDeviceWhiteList
Content-Type: application/json

{
  "password": "123456",
  "totalnum": 1,
  "currentnum": 1,
  "data": {
    "usertype": "white",
    "employee_number": "<our member id or member code>",
    "name": "น้องเอ",
    "sex": "female",
    "peoplestartdate": "2026-05-26",
    "peopleenddate": "2027-05-26",
    "passAlgo": false,
    "register_base64": "<JPEG base64 string>",
    "TimeGroupId": 0
  }
}
```

Response: `{"message":"Add successfully","result":0}`

### Delete a face

```http
POST http://<deviceIp>:8091/deleteDeviceWhiteList
Content-Type: application/json

{
  "password": "123456",
  "data": {
    "employee_number": "<our member id>",
    "usertype": "white"
  }
}
```

### Trigger gate open (server→device)

```http
POST http://<deviceIp>:8091/setDeviceRemoteOpen
{"password": "123456"}
```

Or set `recogRelay: 1` in device parameters so it opens locally on every successful face match.

### Recognition event push (device→our server)

Device POSTs to `platformIp` on every face recognition. Payload:

```json
{
  "id": "<uuid>",
  "Mac_addr": "<device mac · unique device id>",
  "time": "2026-05-26 14:23:45",
  "devicename": "Front gate",
  "location": "Lobby",
  "inout": 1,
  "employee_number": "<our member id we registered>",
  "name": "น้องเอ",
  "IdentifyType": 0,
  "resultStatus": 1,
  "face_base64": "<JPEG snapshot string · large>",
  "temperature": "36.5"
}
```

| Field | Meaning |
|---|---|
| `inout` | 0 = Exit, 1 = Entrance |
| `IdentifyType` | 0 face · 1 blacklist · 2 witness · 3 IC card |
| `resultStatus` | 1 = recognized · 0 = failed comparison (stranger) |
| `face_base64` | Snapshot of face at gate · use for audit/anti-fraud |

**OUR SERVER MUST REPLY:**
```json
{ "result": 0, "message": "OK" }
```
If we don't reply 0, device will re-push the same record (de-dup via `id` UUID).

## Other useful endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/deviceLogin` | POST | Initial password auth |
| `/heartBeat` | POST | Manual heartbeat poll |
| `/getDeviceParameter` | POST | Read all device config |
| `/setDeviceParameter` | POST | Write device config |
| `/getDeviceVersion` | POST | Firmware version + MAC |
| `/getDeviceSnapPicture` | POST | Get current camera frame base64 |
| `/getDeviceSnapFace` | POST | Get face-detect snapshot |
| `/setDeviceShowMessage` | POST | Display text on screen 3s |
| `/setDeviceNetwork` | POST | Set device IP/DHCP/DNS |
| `/setDeviceTime` / `/getDeviceTime` | POST | Sync clock |
| `/setDeviceOTAUpgrade` | multipart POST | Firmware update |
| `/getAllDeviceIdWhiteList` | POST | List all registered face IDs |
| `/getDeviceWhiteListDetailByIdNum` | POST | Get one person detail |
| `/deleteDeviceAllWhiteList` | POST | Wipe all faces |
| `/setDeviceRecordRevert` | POST | Replay events in date range |

## Key parameters in `setDeviceParameter`

| Key | Default | Meaning |
|---|---|---|
| `platformEnable` | 0 | Send events to platformIp (must = 1) |
| `platformIp` | `""` | Our webhook URL |
| `recogRelay` | 0 | Open relay on face match (1 = auto open gate) |
| `whitevalue` | 80 | Face match threshold 70-100 |
| `livenessEnable` | 1 | Anti-spoof (photo attack defense) |
| `livenessValue` | 5 | Liveness strictness 0-10 |
| `detectVoiceEnable` | 2 | Stranger handling 0/1/2 (2 = capture + open) |
| `inout` | 1 | Device direction 0=exit, 1=entrance |
| `heartBeatEnable` | 0 | Device auto-pings heartBeatIp |
| `heartBeatIp` | `""` | Server URL for heartbeats |
| `delayvalue` | 2 | Door open hold seconds |
| `recogSpaceTime` | 3 | Anti-double-scan seconds 2-255 |

## Open questions / risks

1. **HTTPS support** — doc shows `http://` only · Vercel won't serve HTTP · need to confirm if device accepts `https://platformIp` or we need a proxy
2. **Device IP routable** — server→device for face register requires LAN access · need VPN/tunnel for remote branches OR cashier registers via local network
3. **Snapshot bandwidth** — every face event ships full base64 JPEG · estimate 50-200KB per event · plan storage retention (R2)
4. **`employee_number` mapping** — we should use Pool member ID (UUID) or memberCode (PM-25YY-NNNN) · need to pick once and stay consistent

## What our existing code matches / mismatches

✅ Webhook endpoint `/api/playland/acs/event` direction is correct (device pushes)
❌ Webhook expected HMAC signature in header — device doesn't sign (auth via known platformIp)
❌ Webhook expected normalized payload from adapter — actual payload is doc-2 schema above
❌ mock-adapter `registerFace` is a stub · real impl needs `POST <deviceIp>/addDeviceWhiteList`
✅ Idempotency via `webhookId UNIQUE` in `playland_face_events` table — matches device `id` field

## Memory links

- [[acs-f606-vendor-info]] · vendor contact + Lilly's chat
- [[acs-architecture-confirmed]] · architecture decisions
- [[playland-workshop-decisions]] · OQ1 now resolved with this doc
