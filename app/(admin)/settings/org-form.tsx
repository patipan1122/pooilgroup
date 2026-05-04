"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Globe, DollarSign, Image as ImageIcon } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  orgId: string;
  slug: string;
  initial: {
    name: string;
    logoUrl: string;
    timezone: string;
    currency: string;
  };
}

export function OrgInfoForm({ slug, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [currency, setCurrency] = useState(initial.currency);
  const dirty =
    name !== initial.name ||
    logoUrl !== initial.logoUrl ||
    timezone !== initial.timezone ||
    currency !== initial.currency;

  function save() {
    startTransition(async () => {
      const res = await fetch("/api/admin/settings/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          logoUrl: logoUrl.trim() || null,
          settings: { timezone, currency },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกข้อมูลองค์กรแล้ว");
      router.refresh();
    });
  }

  return (
    <Card className="animate-fade-up delay-100">
      <CardHeader>
        <CardTitle>ข้อมูลองค์กร</CardTitle>
        <Badge tone="brand">{slug}</Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <Field label="ชื่อองค์กร" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pooilgroup"
            prefixSlot={<Building2 className="size-4" />}
          />
        </Field>
        <Field
          label="Logo URL"
          optional
          hint="ลิงก์รูปโลโก้ (ภายหลังเปลี่ยนเป็น Upload R2)"
        >
          <Input
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://..."
            prefixSlot={<ImageIcon className="size-4" />}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Timezone">
            <Input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              prefixSlot={<Globe className="size-4" />}
            />
          </Field>
          <Field label="สกุลเงิน">
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              prefixSlot={<DollarSign className="size-4" />}
            />
          </Field>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={save}
            loading={pending}
            disabled={!dirty || !name.trim()}
          >
            บันทึก
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
