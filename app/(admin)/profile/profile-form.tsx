"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { User, Phone, Mail, Lock } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";

interface Props {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
}

export function ProfileForm(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(props.name);
  const [phone, setPhone] = useState(props.phone ?? "");
  const [oldPwd, setOldPwd] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");

  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "อัปเดตไม่ได้");
        return;
      }
      toast.success("บันทึกโปรไฟล์แล้ว");
      router.refresh();
    });
  }

  function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!oldPwd) {
      toast.error("กรุณาระบุรหัสผ่านปัจจุบัน");
      return;
    }
    if (pwd.length < 8) {
      toast.error("รหัสผ่านอย่างน้อย 8 ตัว");
      return;
    }
    if (pwd !== pwd2) {
      toast.error("รหัสผ่านไม่ตรงกัน");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: oldPwd, password: pwd }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "เปลี่ยนรหัสผ่านไม่ได้");
        return;
      }
      toast.success("เปลี่ยนรหัสผ่านสำเร็จ");
      setOldPwd("");
      setPwd("");
      setPwd2("");
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={saveProfile}>
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>ข้อมูลทั่วไป</CardTitle>
            <Badge tone="brand">{ROLE_LABEL[props.role] ?? props.role}</Badge>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label="ชื่อ-นามสกุล" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                prefixSlot={<User className="size-4" />}
                required
              />
            </Field>
            <Field label="อีเมล" hint="เปลี่ยนต้องผ่าน Admin">
              <Input
                value={props.email ?? ""}
                disabled
                prefixSlot={<Mail className="size-4" />}
              />
            </Field>
            <Field label="เบอร์โทร" optional>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                prefixSlot={<Phone className="size-4" />}
              />
            </Field>
            <Button
              type="submit"
              loading={pending}
              disabled={
                pending ||
                (name.trim() === props.name && phone.trim() === (props.phone ?? ""))
              }
            >
              บันทึก
            </Button>
          </CardBody>
        </Card>
      </form>

      <form onSubmit={changePassword}>
        <Card className="animate-fade-up delay-100">
          <CardHeader>
            <CardTitle>เปลี่ยนรหัสผ่าน</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label="รหัสผ่านปัจจุบัน" required>
              <Input
                type="password"
                autoComplete="current-password"
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                prefixSlot={<Lock className="size-4" />}
                required
              />
            </Field>
            <Field label="รหัสผ่านใหม่" required hint="อย่างน้อย 8 ตัว">
              <Input
                type="password"
                autoComplete="new-password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                prefixSlot={<Lock className="size-4" />}
                minLength={8}
                required
              />
            </Field>
            <Field label="ยืนยันรหัสผ่าน" required>
              <Input
                type="password"
                autoComplete="new-password"
                value={pwd2}
                onChange={(e) => setPwd2(e.target.value)}
                prefixSlot={<Lock className="size-4" />}
                minLength={8}
                invalid={pwd2.length > 0 && pwd2 !== pwd}
                required
              />
            </Field>
            <Button
              type="submit"
              loading={pending}
              disabled={pending || !oldPwd || !pwd || !pwd2}
            >
              เปลี่ยนรหัสผ่าน
            </Button>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  branch_manager: "ผู้จัดการสาขา",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};
