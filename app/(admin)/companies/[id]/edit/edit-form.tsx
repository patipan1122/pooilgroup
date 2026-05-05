"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Phone, MapPin, IdCard, Image as ImageIcon } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Company {
  id: string;
  code: string;
  name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  brand_color: string | null;
  is_active: boolean;
}

export function CompanyEditForm({ company }: { company: Company }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(company.name);
  const [taxId, setTaxId] = useState(company.tax_id ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [address, setAddress] = useState(company.address ?? "");
  const [logoUrl, setLogoUrl] = useState(company.logo_url ?? "");
  const [brandColor, setBrandColor] = useState(company.brand_color ?? "");

  const dirty =
    name !== company.name ||
    taxId !== (company.tax_id ?? "") ||
    phone !== (company.phone ?? "") ||
    address !== (company.address ?? "") ||
    logoUrl !== (company.logo_url ?? "") ||
    brandColor !== (company.brand_color ?? "");

  function save() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          taxId: taxId.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
          logoUrl: logoUrl.trim() || null,
          brandColor: brandColor.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกเรียบร้อย");
      router.push(`/companies/${company.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>ข้อมูลบริษัท</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field
            label="รหัสบริษัท"
            hint="แก้รหัสไม่ได้ (system identifier)"
          >
            <Input value={company.code} disabled />
          </Field>
          <Field label="ชื่อบริษัท" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              prefixSlot={<Building2 className="size-4" />}
              placeholder="เช่น Pooil Oil"
              required
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="เลขประจำตัวผู้เสียภาษี" optional>
              <Input
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                prefixSlot={<IdCard className="size-4" />}
                placeholder="เช่น 0105550000000"
                inputMode="numeric"
              />
            </Field>
            <Field label="เบอร์โทร" optional>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                prefixSlot={<Phone className="size-4" />}
                placeholder="เช่น 02-123-4567"
              />
            </Field>
          </div>
          <Field label="ที่อยู่" optional>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              prefixSlot={<MapPin className="size-4" />}
              placeholder="เช่น 123 ถ.พหลโยธิน เขตจตุจักร กรุงเทพฯ 10900"
            />
          </Field>
        </CardBody>
      </Card>

      <Card className="animate-fade-up delay-150">
        <CardHeader>
          <CardTitle>แบรนด์ (สำหรับ invoice + dashboard)</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Logo URL" optional hint="ลิงก์รูป (ภายหลังเปลี่ยนเป็น Upload)">
            <Input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              prefixSlot={<ImageIcon className="size-4" />}
              placeholder="https://..."
            />
          </Field>
          <Field
            label="Brand Color"
            optional
            hint="สีหลักของบริษัท (hex เช่น #2A5BFF) — แสดงบน invoice + dashboard เฉพาะบริษัท"
          >
            <div className="flex items-center gap-3">
              <Input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#2A5BFF"
                className="font-mono"
              />
              {brandColor && (
                <div
                  className="size-12 rounded-xl border-2 border-zinc-200 shrink-0"
                  style={{ background: brandColor }}
                  aria-label="Color preview"
                />
              )}
            </div>
          </Field>
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2 pt-2 animate-fade-up delay-200">
        <Button
          variant="ghost"
          onClick={() => router.push(`/companies/${company.id}`)}
          disabled={pending}
        >
          ยกเลิก
        </Button>
        <Button
          size="lg"
          onClick={save}
          loading={pending}
          disabled={!dirty || !name.trim()}
        >
          บันทึก
        </Button>
      </div>
    </div>
  );
}
