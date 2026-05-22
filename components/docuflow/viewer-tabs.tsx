"use client";

// DocuFlow · Viewer Tabs (client component)
// ────────────────────────────────────────────────────────────────────
// Tabs that the DesktopViewer canvas demands: Preview / Data / History /
// Comments. Preview embeds PDF/image; Data shows metadata table; History
// shows renewal events; Comments shows shared discussion (placeholder).
// ────────────────────────────────────────────────────────────────────

import { useState } from "react";
import {
  Eye,
  FileText,
  Clock,
  MessageCircle,
} from "lucide-react";

interface MetaItem {
  k: string;
  v: string;
}

interface HistoryEvent {
  at: string;
  by: string;
  label: string;
  detail?: string;
}

interface Comment {
  by: string;
  at: string;
  body: string;
}

interface Props {
  downloadUrl: string | null;
  mimeType: string | null;
  docName: string;
  meta: MetaItem[];
  history: HistoryEvent[];
  comments?: Comment[];
}

type Tab = "preview" | "data" | "history" | "comments";

export function ViewerTabs({
  downloadUrl,
  mimeType,
  docName,
  meta,
  history,
  comments = [],
}: Props) {
  const [tab, setTab] = useState<Tab>("preview");
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType?.startsWith("image/") ?? false;

  return (
    <div>
      {/* Tab bar */}
      <div
        style={{
          padding: "12px 18px",
          borderBottom: "1px solid var(--df-line)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--df-surface)",
        }}
      >
        <div className="df-seg" role="tablist">
          <button
            className={tab === "preview" ? "df-on" : undefined}
            onClick={() => setTab("preview")}
          >
            <Eye size={13} /> Preview
          </button>
          <button
            className={tab === "data" ? "df-on" : undefined}
            onClick={() => setTab("data")}
          >
            <FileText size={13} /> ข้อมูล
          </button>
          <button
            className={tab === "history" ? "df-on" : undefined}
            onClick={() => setTab("history")}
          >
            <Clock size={13} /> ประวัติ
            {history.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--df-muted)",
                  marginLeft: 4,
                }}
                className="df-tnum"
              >
                {history.length}
              </span>
            )}
          </button>
          <button
            className={tab === "comments" ? "df-on" : undefined}
            onClick={() => setTab("comments")}
          >
            <MessageCircle size={13} /> Comments
            {comments.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--df-muted)",
                  marginLeft: 4,
                }}
                className="df-tnum"
              >
                {comments.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div
        style={{
          minHeight: 480,
        }}
      >
        {tab === "preview" && (
          <div
            style={{
              background: "#E8E1D2",
              minHeight: 480,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 18,
            }}
          >
            {downloadUrl && isPdf && (
              <iframe
                src={downloadUrl}
                title={docName}
                style={{
                  width: "100%",
                  height: 640,
                  border: "none",
                  borderRadius: 6,
                  background: "#fff",
                  boxShadow: "0 10px 40px -10px rgba(0,0,0,0.25)",
                }}
              />
            )}
            {downloadUrl && isImage && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={downloadUrl}
                alt={docName}
                style={{
                  maxWidth: "100%",
                  maxHeight: 640,
                  objectFit: "contain",
                  boxShadow: "0 10px 40px -10px rgba(0,0,0,0.25)",
                }}
              />
            )}
            {(!downloadUrl || (!isPdf && !isImage)) && (
              <div
                style={{
                  padding: 40,
                  textAlign: "center",
                  color: "var(--df-muted)",
                }}
              >
                <FileText
                  size={28}
                  style={{ display: "block", margin: "0 auto 10px" }}
                />
                <p style={{ marginTop: 10, fontSize: 14 }}>
                  ไฟล์นี้ไม่รองรับ Preview
                  <br />
                  กด &ldquo;ดาวน์โหลด&rdquo; ด้านบนเพื่อเปิดไฟล์
                </p>
              </div>
            )}
          </div>
        )}

        {tab === "data" && (
          <div style={{ padding: 22 }}>
            <h3
              className="df-serif"
              style={{ fontSize: 17, marginTop: 0, marginBottom: 14 }}
            >
              Metadata เอกสาร
            </h3>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {meta.map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom:
                      i < meta.length - 1
                        ? "1px solid var(--df-line-soft)"
                        : "none",
                    fontSize: 13,
                    gap: 12,
                  }}
                >
                  <span
                    style={{ color: "var(--df-muted)", flexShrink: 0 }}
                  >
                    {m.k}
                  </span>
                  <span
                    style={{
                      fontWeight: 600,
                      textAlign: "right",
                      color: "var(--df-ink)",
                    }}
                  >
                    {m.v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "history" && (
          <div style={{ padding: 22 }}>
            <h3
              className="df-serif"
              style={{ fontSize: 17, marginTop: 0, marginBottom: 14 }}
            >
              ประวัติเอกสาร
            </h3>
            {history.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "var(--df-muted)",
                  fontSize: 13,
                }}
              >
                ยังไม่มีประวัติเหตุการณ์
              </div>
            ) : (
              <div
                style={{
                  position: "relative",
                  paddingLeft: 24,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 9,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    background: "var(--df-line)",
                  }}
                />
                {history.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      position: "relative",
                      paddingBottom: i < history.length - 1 ? 18 : 0,
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: -20,
                        top: 4,
                        width: 16,
                        height: 16,
                        borderRadius: 99,
                        background:
                          i === 0 ? "var(--df-brand)" : "var(--df-surface)",
                        border: `2px solid ${i === 0 ? "var(--df-brand)" : "var(--df-line)"}`,
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <div
                          style={{ fontSize: 13, fontWeight: 600 }}
                        >
                          {e.label}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--df-muted)",
                            marginTop: 2,
                          }}
                        >
                          {e.at} · โดย {e.by}
                        </div>
                        {e.detail && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--df-ink-2)",
                              marginTop: 6,
                              fontStyle: "italic",
                            }}
                          >
                            “{e.detail}”
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "comments" && (
          <div style={{ padding: 22 }}>
            <h3
              className="df-serif"
              style={{ fontSize: 17, marginTop: 0, marginBottom: 14 }}
            >
              Comments
            </h3>
            {comments.length === 0 ? (
              <div
                style={{
                  padding: 32,
                  textAlign: "center",
                  color: "var(--df-muted)",
                  fontSize: 13,
                  background: "var(--df-surface-soft)",
                  borderRadius: 12,
                }}
              >
                <MessageCircle
                  size={28}
                  style={{
                    display: "block",
                    margin: "0 auto 10px",
                    color: "var(--df-muted-2)",
                  }}
                />
                ยังไม่มี comment
                <br />
                <span style={{ fontSize: 11 }}>
                  Comment feature จะเปิดเมื่อมีการ share เอกสารกับทีม
                </span>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {comments.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: "var(--df-surface-soft)",
                      border: "1px solid var(--df-line-soft)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {c.by}
                      </span>
                      <span
                        className="df-tnum"
                        style={{
                          fontSize: 11,
                          color: "var(--df-muted)",
                        }}
                      >
                        {c.at}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 13,
                        color: "var(--df-ink-2)",
                        lineHeight: 1.55,
                        margin: 0,
                      }}
                    >
                      {c.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
