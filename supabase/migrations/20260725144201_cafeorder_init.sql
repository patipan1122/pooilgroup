-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "cafeorder";

-- CreateEnum
CREATE TYPE "cafeorder"."CafeBrand" AS ENUM ('amazon', 'punthai');

-- CreateEnum
CREATE TYPE "cafeorder"."CafeTemp" AS ENUM ('hot', 'iced', 'blended');

-- CreateEnum
CREATE TYPE "cafeorder"."CafeSize" AS ENUM ('regular', 'large');

-- CreateEnum
CREATE TYPE "cafeorder"."CafeItemKind" AS ENUM ('drink', 'food');

-- CreateEnum
CREATE TYPE "cafeorder"."CafeOptionSelect" AS ENUM ('single', 'multi');

-- CreateEnum
CREATE TYPE "cafeorder"."CafePointKind" AS ENUM ('earn', 'redeem', 'adjust', 'expire', 'reverse');

-- CreateTable
CREATE TABLE "cafeorder"."cafe_shops" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "brand" "cafeorder"."CafeBrand" NOT NULL,
    "shop_slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "accepting_orders" BOOLEAN NOT NULL DEFAULT true,
    "eta_minutes" INTEGER,
    "queue_cap" INTEGER,
    "promptpay_id" TEXT,
    "min_order_cents" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cafe_shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_categories" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "brand" "cafeorder"."CafeBrand" NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cafe_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_menu_items" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "brand" "cafeorder"."CafeBrand" NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_key" TEXT,
    "kind" "cafeorder"."CafeItemKind" NOT NULL DEFAULT 'drink',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cafe_menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_item_variants" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "temp" "cafeorder"."CafeTemp",
    "size" "cafeorder"."CafeSize" NOT NULL DEFAULT 'regular',
    "price_cents" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cafe_item_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_option_groups" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "brand" "cafeorder"."CafeBrand",
    "name" TEXT NOT NULL,
    "select_type" "cafeorder"."CafeOptionSelect" NOT NULL DEFAULT 'single',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER,
    "visible_when_temp" "cafeorder"."CafeTemp",
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cafe_option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_option_choices" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "price_delta_cents" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cafe_option_choices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_item_option_groups" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "option_group_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cafe_item_option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_branch_items" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "price_override_cents" INTEGER,
    "sold_out_until" TIMESTAMPTZ(6),

    CONSTRAINT "cafe_branch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_branch_choice_stock" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "option_choice_id" UUID NOT NULL,
    "sold_out_until" TIMESTAMPTZ(6),

    CONSTRAINT "cafe_branch_choice_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_point_policies" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "earn_per_cup" INTEGER NOT NULL DEFAULT 1,
    "redeem_points_per_cup" INTEGER NOT NULL DEFAULT 10,
    "expiry_months" INTEGER,
    "cross_brand" BOOLEAN NOT NULL DEFAULT true,
    "free_cup_cap_per_branch_month" INTEGER,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cafe_point_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_members" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "google_sub" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phone_verified_at" TIMESTAMPTZ(6),
    "display_name" TEXT,
    "member_code" TEXT NOT NULL,
    "consent_at" TIMESTAMPTZ(6),
    "marketing_consent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cafe_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafeorder"."cafe_point_entries" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "kind" "cafeorder"."CafePointKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "cups" INTEGER NOT NULL DEFAULT 0,
    "order_id" UUID,
    "actor_user_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cafe_point_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cafe_shops_shop_slug_key" ON "cafeorder"."cafe_shops"("shop_slug");

-- CreateIndex
CREATE INDEX "cafe_shops_org_id_idx" ON "cafeorder"."cafe_shops"("org_id");

-- CreateIndex
CREATE INDEX "cafe_shops_branch_id_idx" ON "cafeorder"."cafe_shops"("branch_id");

-- CreateIndex
CREATE INDEX "cafe_categories_org_id_brand_idx" ON "cafeorder"."cafe_categories"("org_id", "brand");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_categories_org_id_brand_name_key" ON "cafeorder"."cafe_categories"("org_id", "brand", "name");

-- CreateIndex
CREATE INDEX "cafe_menu_items_org_id_brand_category_id_idx" ON "cafeorder"."cafe_menu_items"("org_id", "brand", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_menu_items_org_id_brand_name_key" ON "cafeorder"."cafe_menu_items"("org_id", "brand", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_item_variants_item_id_temp_size_key" ON "cafeorder"."cafe_item_variants"("item_id", "temp", "size");

-- CreateIndex
CREATE INDEX "cafe_option_groups_org_id_idx" ON "cafeorder"."cafe_option_groups"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_option_groups_org_id_name_key" ON "cafeorder"."cafe_option_groups"("org_id", "name");

-- CreateIndex
CREATE INDEX "cafe_option_choices_group_id_idx" ON "cafeorder"."cafe_option_choices"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_item_option_groups_item_id_option_group_id_key" ON "cafeorder"."cafe_item_option_groups"("item_id", "option_group_id");

-- CreateIndex
CREATE INDEX "cafe_branch_items_shop_id_idx" ON "cafeorder"."cafe_branch_items"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_branch_items_shop_id_item_id_key" ON "cafeorder"."cafe_branch_items"("shop_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_branch_choice_stock_shop_id_option_choice_id_key" ON "cafeorder"."cafe_branch_choice_stock"("shop_id", "option_choice_id");

-- CreateIndex
CREATE INDEX "cafe_point_policies_org_id_effective_from_idx" ON "cafeorder"."cafe_point_policies"("org_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cafe_members_google_sub_key" ON "cafeorder"."cafe_members"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_members_member_code_key" ON "cafeorder"."cafe_members"("member_code");

-- CreateIndex
CREATE INDEX "cafe_members_org_id_idx" ON "cafeorder"."cafe_members"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_members_org_id_phone_key" ON "cafeorder"."cafe_members"("org_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_point_entries_idempotency_key_key" ON "cafeorder"."cafe_point_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "cafe_point_entries_member_id_created_at_idx" ON "cafeorder"."cafe_point_entries"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "cafe_point_entries_org_id_created_at_idx" ON "cafeorder"."cafe_point_entries"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "cafeorder"."cafe_menu_items" ADD CONSTRAINT "cafe_menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "cafeorder"."cafe_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafeorder"."cafe_item_variants" ADD CONSTRAINT "cafe_item_variants_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "cafeorder"."cafe_menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafeorder"."cafe_option_choices" ADD CONSTRAINT "cafe_option_choices_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "cafeorder"."cafe_option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafeorder"."cafe_item_option_groups" ADD CONSTRAINT "cafe_item_option_groups_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "cafeorder"."cafe_menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafeorder"."cafe_item_option_groups" ADD CONSTRAINT "cafe_item_option_groups_option_group_id_fkey" FOREIGN KEY ("option_group_id") REFERENCES "cafeorder"."cafe_option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafeorder"."cafe_branch_items" ADD CONSTRAINT "cafe_branch_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "cafeorder"."cafe_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafeorder"."cafe_branch_items" ADD CONSTRAINT "cafe_branch_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "cafeorder"."cafe_menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafeorder"."cafe_branch_choice_stock" ADD CONSTRAINT "cafe_branch_choice_stock_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "cafeorder"."cafe_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafeorder"."cafe_branch_choice_stock" ADD CONSTRAINT "cafe_branch_choice_stock_option_choice_id_fkey" FOREIGN KEY ("option_choice_id") REFERENCES "cafeorder"."cafe_option_choices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafeorder"."cafe_point_entries" ADD CONSTRAINT "cafe_point_entries_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "cafeorder"."cafe_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

