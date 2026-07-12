"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { EditProfileForm } from "./edit-profile-form";

interface Props {
  defaultValues: {
    displayName: string;
    mobilePhone: string | null;
    emergencyContact: string | null;
    emergencyPhone: string | null;
    currentMainEmployer: string | null;
    idCardNumber: string | null;
    homeAddress: string | null;
    idCardImageUrl: string | null;
    idCardFileName: string | null;
  };
  children: React.ReactNode;
}

export function ProfileEditWrapper({ defaultValues, children }: Props) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-4">
        <h2 className="text-base font-semibold text-zinc-900">แก้ไขข้อมูล</h2>
        <EditProfileForm
          defaultValues={defaultValues}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="relative">
      {children}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 shadow-sm active:bg-zinc-50"
      >
        <Pencil className="h-3.5 w-3.5" /> แก้ไข
      </button>
    </div>
  );
}
