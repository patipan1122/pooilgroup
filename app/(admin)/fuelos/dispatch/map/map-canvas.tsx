"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import type { FleetVehicle } from "@/lib/fuelos/gps/types";

const THAI_CENTER: LatLngExpression = [13.9, 100.9];

// สีตามสถานะรถ
export function statusColor(v: FleetVehicle): string {
  if (v.moving) return "#16a34a"; // วิ่ง = เขียว
  if (v.engineOn) return "#f59e0b"; // ติดเครื่องจอด = ส้ม
  if (v.engineOn === false) return "#9ca3af"; // ดับ = เทา
  return "#64748b"; // ไม่ทราบ
}

// fit แผนที่ให้เห็นรถทุกคัน — ทำครั้งเดียวตอนมีข้อมูลรอบแรก (ไม่รีเซ็ตทุกการ refresh)
function FitBounds({ vehicles }: { vehicles: FleetVehicle[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    const pts = vehicles
      .filter((v) => v.lat != null && v.lng != null)
      .map((v) => [v.lat as number, v.lng as number] as [number, number]);
    if (pts.length === 0) return;
    done.current = true;
    if (pts.length === 1) map.setView(pts[0], 13);
    else map.fitBounds(pts, { padding: [40, 40] });
  }, [vehicles, map]);
  return null;
}

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapCanvas({
  vehicles,
  destination,
  onMapClick,
  highlight,
  onSelect,
}: {
  vehicles: FleetVehicle[];
  destination: { lat: number; lng: number } | null;
  onMapClick: (lat: number, lng: number) => void;
  highlight: Set<string>;
  onSelect?: (name: string) => void;
}) {
  return (
    <MapContainer center={THAI_CENTER} zoom={6} scrollWheelZoom className="h-full w-full">
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds vehicles={vehicles} />
      <ClickHandler onClick={onMapClick} />

      {vehicles.map((v) =>
        v.lat != null && v.lng != null ? (
          <CircleMarker
            key={v.name}
            center={[v.lat, v.lng]}
            radius={highlight.has(v.name) ? 10 : 6}
            pathOptions={{
              color: highlight.has(v.name) ? "#2563eb" : statusColor(v),
              weight: highlight.has(v.name) ? 3 : 1.5,
              fillColor: statusColor(v),
              fillOpacity: 0.85,
            }}
            eventHandlers={{ click: () => onSelect?.(v.name) }}
          >
            <Tooltip direction="top">{v.plate ?? v.name}</Tooltip>
            <Popup>
              <div className="text-[13px] leading-relaxed">
                <div className="font-bold">{v.plate ?? v.name}</div>
                {v.driverName && <div>คนขับ: {v.driverName}</div>}
                <div>
                  สถานะ: {v.moving ? "กำลังวิ่ง" : v.engineOn ? "จอดติดเครื่อง" : v.engineOn === false ? "ดับเครื่อง" : "ไม่ทราบ"}
                  {v.speedKmh != null && ` · ${Math.round(v.speedKmh)} กม./ชม.`}
                </div>
                {v.address && <div className="text-zinc-500">{v.address}</div>}
                {v.groupName && <div className="text-zinc-400">{v.groupName}</div>}
              </div>
            </Popup>
          </CircleMarker>
        ) : null,
      )}

      {destination && (
        <CircleMarker
          center={[destination.lat, destination.lng]}
          radius={9}
          pathOptions={{ color: "#dc2626", weight: 3, fillColor: "#fecaca", fillOpacity: 0.9 }}
        >
          <Tooltip permanent direction="top">
            จุดส่ง
          </Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
