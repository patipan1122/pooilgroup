"use client";

// Smart header button: shows "เปิดกะ" if no open shift · "ปิดกะ" with sales total if open
// Solves QA issue: "ปิดกะ button confuses cashier who hasn't opened one yet"

import Link from "next/link";
import { Clock, Play } from "lucide-react";
import { thb } from "@/lib/playland/format";

interface Props {
  branchId: string;
  openShift: { id: string; totalSalesCents: number } | null;
}

export function CashierHeaderActions({ branchId, openShift }: Props) {
  if (!openShift) {
    return (
      <Link href={`/playland/shifts?branch=${branchId}`} className="pl-btn pl-btn-primary">
        <Play size={14} /> เปิดกะใหม่
      </Link>
    );
  }
  return (
    <Link href={`/playland/shifts?branch=${branchId}`} className="pl-btn pl-btn-primary">
      <Clock size={14} /> ปิดกะ · <span className="pl-num">{thb(openShift.totalSalesCents)}</span>
    </Link>
  );
}
