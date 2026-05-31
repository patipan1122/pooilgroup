-- ============================================================
-- HotelBook · ระบบจองโรงแรม (Pool ERP Module #11)
-- BIGFEATURE 2026-05-31 (รอบ 68) · Mix Hotel as first tenant
-- Public booking flow: web + LIFF + FB CTA
-- ============================================================

-- ── 1. hotel (org-scoped) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hotel (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug                       TEXT NOT NULL UNIQUE,
  name                       TEXT NOT NULL,
  concept                    TEXT,
  description                TEXT,
  reservation_phones         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  owner_phone                TEXT,
  google_maps_url            TEXT,
  address                    TEXT,
  email                      TEXT,
  brand_color                TEXT NOT NULL DEFAULT '#7c3aed',
  hero_image_url             TEXT,
  logo_url                   TEXT,
  check_in_time              TEXT,
  check_out_time             TEXT,
  is_24h                     BOOLEAN NOT NULL DEFAULT TRUE,
  payment_methods            TEXT[] NOT NULL DEFAULT ARRAY['cash','transfer','qr']::TEXT[],
  allows_pets                BOOLEAN NOT NULL DEFAULT FALSE,
  smoking_allowed            BOOLEAN NOT NULL DEFAULT FALSE,
  cancellation_note          TEXT,
  multi_night_discount_note  TEXT,
  amenities                  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  nearby_places              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  enabled                    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hotel_org_idx ON public.hotel(org_id);
CREATE INDEX IF NOT EXISTS hotel_slug_idx ON public.hotel(slug) WHERE enabled = TRUE;

-- ── 2. hotel_room ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hotel_room (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            UUID NOT NULL REFERENCES public.hotel(id) ON DELETE CASCADE,
  slug                TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  bed_description     TEXT,
  price_thb           NUMERIC(10, 2) NOT NULL,
  total_rooms         INT NOT NULL DEFAULT 1,
  amenities           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sort_order          INT NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  primary_image_url   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, slug)
);

CREATE INDEX IF NOT EXISTS hotel_room_hotel_idx ON public.hotel_room(hotel_id) WHERE is_active = TRUE;

-- ── 3. hotel_image ─────────────────────────────────────────
-- room_id NULL  = gallery image for hotel
-- room_id set   = room-specific image
CREATE TABLE IF NOT EXISTS public.hotel_image (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      UUID NOT NULL REFERENCES public.hotel(id) ON DELETE CASCADE,
  room_id       UUID REFERENCES public.hotel_room(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  thumbnail_url TEXT,
  alt_text      TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hotel_image_hotel_idx ON public.hotel_image(hotel_id, sort_order);
CREATE INDEX IF NOT EXISTS hotel_image_room_idx ON public.hotel_image(room_id, sort_order);

-- ── 4. hotel_booking ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hotel_booking (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          UUID NOT NULL REFERENCES public.hotel(id) ON DELETE CASCADE,
  room_id           UUID NOT NULL REFERENCES public.hotel_room(id),
  code              TEXT NOT NULL UNIQUE,
  guest_name        TEXT NOT NULL,
  guest_phone       TEXT NOT NULL,
  guest_email       TEXT,
  guest_line_id     TEXT,
  guest_fb_psid     TEXT,
  check_in_date     DATE NOT NULL,
  check_out_date    DATE NOT NULL,
  nights            INT NOT NULL,
  rooms             INT NOT NULL DEFAULT 1,
  total_amount_thb  NUMERIC(10, 2) NOT NULL,
  payment_method    TEXT,
  payment_slip_url  TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  source            TEXT NOT NULL,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (check_out_date > check_in_date),
  CHECK (nights > 0),
  CHECK (rooms > 0),
  CHECK (status IN ('pending','confirmed','cancelled','checked_in','completed','no_show')),
  CHECK (source IN ('web','liff','fb','phone','walkin','admin'))
);

CREATE INDEX IF NOT EXISTS hotel_booking_hotel_dates_idx ON public.hotel_booking(hotel_id, check_in_date);
CREATE INDEX IF NOT EXISTS hotel_booking_room_dates_idx ON public.hotel_booking(room_id, check_in_date, check_out_date) WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX IF NOT EXISTS hotel_booking_code_idx ON public.hotel_booking(code);

-- ── 5. hotel_blocked_date ─────────────────────────────────
-- Manual block (maintenance, owner-use, agency hold)
CREATE TABLE IF NOT EXISTS public.hotel_blocked_date (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES public.hotel_room(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  rooms       INT NOT NULL DEFAULT 1,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, date)
);

-- ── 6. RLS ────────────────────────────────────────────────
-- Authenticated admin tier can manage hotels in their org.
-- Public (anon) can READ hotel + hotel_room + hotel_image for enabled hotels.
-- Public can INSERT hotel_booking (booking flow). All other writes blocked.
ALTER TABLE public.hotel              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_room         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_image        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_booking      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_blocked_date ENABLE ROW LEVEL SECURITY;

-- Hotel: admin tier of same org can do all · anon reads only enabled rows
DROP POLICY IF EXISTS hotel_admin_all ON public.hotel;
CREATE POLICY hotel_admin_all ON public.hotel
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.org_id = hotel.org_id AND u.role IN ('super_admin','org_admin','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.org_id = hotel.org_id AND u.role IN ('super_admin','org_admin','admin')));

DROP POLICY IF EXISTS hotel_anon_read ON public.hotel;
CREATE POLICY hotel_anon_read ON public.hotel
  FOR SELECT TO anon
  USING (enabled = TRUE);

-- Room: same as hotel
DROP POLICY IF EXISTS hotel_room_admin_all ON public.hotel_room;
CREATE POLICY hotel_room_admin_all ON public.hotel_room
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hotel h JOIN public.users u ON u.org_id = h.org_id
    WHERE h.id = hotel_room.hotel_id AND u.id = auth.uid() AND u.role IN ('super_admin','org_admin','admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hotel h JOIN public.users u ON u.org_id = h.org_id
    WHERE h.id = hotel_room.hotel_id AND u.id = auth.uid() AND u.role IN ('super_admin','org_admin','admin')
  ));

DROP POLICY IF EXISTS hotel_room_anon_read ON public.hotel_room;
CREATE POLICY hotel_room_anon_read ON public.hotel_room
  FOR SELECT TO anon
  USING (is_active = TRUE AND EXISTS (SELECT 1 FROM public.hotel h WHERE h.id = hotel_room.hotel_id AND h.enabled = TRUE));

-- Image: read public · write admin
DROP POLICY IF EXISTS hotel_image_admin_all ON public.hotel_image;
CREATE POLICY hotel_image_admin_all ON public.hotel_image
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hotel h JOIN public.users u ON u.org_id = h.org_id
    WHERE h.id = hotel_image.hotel_id AND u.id = auth.uid() AND u.role IN ('super_admin','org_admin','admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hotel h JOIN public.users u ON u.org_id = h.org_id
    WHERE h.id = hotel_image.hotel_id AND u.id = auth.uid() AND u.role IN ('super_admin','org_admin','admin')
  ));

DROP POLICY IF EXISTS hotel_image_anon_read ON public.hotel_image;
CREATE POLICY hotel_image_anon_read ON public.hotel_image
  FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.hotel h WHERE h.id = hotel_image.hotel_id AND h.enabled = TRUE));

-- Booking: admin tier full · anon can INSERT only (public booking)
DROP POLICY IF EXISTS hotel_booking_admin_all ON public.hotel_booking;
CREATE POLICY hotel_booking_admin_all ON public.hotel_booking
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hotel h JOIN public.users u ON u.org_id = h.org_id
    WHERE h.id = hotel_booking.hotel_id AND u.id = auth.uid() AND u.role IN ('super_admin','org_admin','admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hotel h JOIN public.users u ON u.org_id = h.org_id
    WHERE h.id = hotel_booking.hotel_id AND u.id = auth.uid() AND u.role IN ('super_admin','org_admin','admin')
  ));

DROP POLICY IF EXISTS hotel_booking_anon_insert ON public.hotel_booking;
CREATE POLICY hotel_booking_anon_insert ON public.hotel_booking
  FOR INSERT TO anon
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel h WHERE h.id = hotel_booking.hotel_id AND h.enabled = TRUE));

DROP POLICY IF EXISTS hotel_booking_anon_read ON public.hotel_booking;
CREATE POLICY hotel_booking_anon_read ON public.hotel_booking
  FOR SELECT TO anon
  USING (FALSE);  -- public cannot read other bookings · only their own via code lookup endpoint

-- Blocked dates: admin only
DROP POLICY IF EXISTS hotel_blocked_date_admin_all ON public.hotel_blocked_date;
CREATE POLICY hotel_blocked_date_admin_all ON public.hotel_blocked_date
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hotel_room r JOIN public.hotel h ON h.id = r.hotel_id JOIN public.users u ON u.org_id = h.org_id
    WHERE r.id = hotel_blocked_date.room_id AND u.id = auth.uid() AND u.role IN ('super_admin','org_admin','admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hotel_room r JOIN public.hotel h ON h.id = r.hotel_id JOIN public.users u ON u.org_id = h.org_id
    WHERE r.id = hotel_blocked_date.room_id AND u.id = auth.uid() AND u.role IN ('super_admin','org_admin','admin')
  ));

-- ── 7. Code generator ─────────────────────────────────────
-- Format: MX-YYNN-NNNN (MX = Mix · YYNN = year-month suffix · NNNN = sequential)
-- Pool convention: try fairly simple seed via row count for now.
CREATE OR REPLACE FUNCTION public.hotelbook_next_code(p_hotel_slug TEXT)
RETURNS TEXT AS $$
DECLARE
  prefix TEXT;
  yy TEXT;
  next_n INT;
BEGIN
  prefix := upper(substr(replace(p_hotel_slug, '-', ''), 1, 2));
  yy := to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YY');
  SELECT COALESCE(MAX(substring(code from '\d+$')::int), 0) + 1
    INTO next_n
    FROM public.hotel_booking
   WHERE code LIKE prefix || '-' || yy || '%';
  RETURN prefix || '-' || yy || lpad(extract(month from now() AT TIME ZONE 'Asia/Bangkok')::text, 2, '0') || '-' || lpad(next_n::text, 4, '0');
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ── 8. Seed Mix Hotel + 5 rooms ───────────────────────────
-- Pooilgroup org (single tenant for now)
DO $$
DECLARE
  v_org_id UUID;
  v_hotel_id UUID;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'No organization found · skipping seed';
    RETURN;
  END IF;

  INSERT INTO public.hotel (
    org_id, slug, name, concept, description,
    reservation_phones, owner_phone, google_maps_url,
    brand_color, check_in_time, check_out_time, is_24h,
    payment_methods, allows_pets, smoking_allowed,
    multi_night_discount_note, amenities, nearby_places
  )
  VALUES (
    v_org_id,
    'mix-hotel',
    'Mix Hotel',
    'โรงแรมบัดเจท 3 ดาว · เปิด 24 ชั่วโมง',
    'พักสบาย ราคาประหยัด ใจกลางเมือง · มีห้องให้เลือก 5 แบบ เริ่มต้น 300 บาท/คืน',
    ARRAY['044-244-700', '092-154-1234'],
    '086-980-1234',
    'https://maps.app.goo.gl/q2YVKwu6cjsGrjVK6',
    '#7c3aed',
    '12:00',
    '12:00',
    TRUE,
    ARRAY['cash','transfer','qr'],
    FALSE,
    FALSE,
    'จองหลายห้อง/หลายคืน เหมาเป็นกลุ่ม โทร 086-980-1234',
    ARRAY['Wi-Fi','TV','ตู้เย็น','AC','เครื่องเป่าผม (ยืมที่ reception)','24 ชั่วโมง'],
    ARRAY['7-Eleven (เดินถึง)','ร้านกาแฟ','Grab Food ส่งถึงห้อง']
  )
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
  RETURNING id INTO v_hotel_id;

  IF v_hotel_id IS NULL THEN
    SELECT id INTO v_hotel_id FROM public.hotel WHERE slug = 'mix-hotel';
  END IF;

  INSERT INTO public.hotel_room (hotel_id, slug, name, description, bed_description, price_thb, total_rooms, amenities, sort_order)
  VALUES
    (v_hotel_id, 'standard-compact', 'Standard Compact Single', 'ห้องมาตรฐาน ขนาดเล็ก (ไม่มีตู้เย็น)', 'เตียงเดี่ยว 6 ฟุต', 300, 1, ARRAY['Wi-Fi','TV','AC'], 1),
    (v_hotel_id, 'standard-single',  'Standard Single',         'ห้องมาตรฐาน ห้องยอดนิยม',           'เตียงเดี่ยว 6 ฟุต', 400, 20, ARRAY['Wi-Fi','TV','ตู้เย็น','AC'], 2),
    (v_hotel_id, 'standard-double',  'Standard Double',         'ห้องมาตรฐาน เตียงคู่',               'เตียงคู่ 3.5 ฟุต',   450, 1, ARRAY['Wi-Fi','TV','ตู้เย็น','AC'], 3),
    (v_hotel_id, 'standard-large',   'Standard Large Single',   'ห้องมาตรฐาน ขนาดใหญ่ + โซฟา',        'เตียงเดี่ยว 6 ฟุต + โซฟา', 450, 1, ARRAY['Wi-Fi','TV','ตู้เย็น','AC','โซฟา'], 4),
    (v_hotel_id, 'vip-family',       'VIP Family Room',         'ห้อง VIP สำหรับครอบครัว · มีอ่างอาบน้ำ', 'เตียงใหญ่ 1 + เตียงเล็ก 1', 550, 4, ARRAY['Wi-Fi','TV','ตู้เย็น','AC','อ่างอาบน้ำ'], 5)
  ON CONFLICT (hotel_id, slug) DO UPDATE SET name = EXCLUDED.name, price_thb = EXCLUDED.price_thb, updated_at = NOW();
END $$;
