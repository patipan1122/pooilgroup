"use server";

// Public booking server action. No auth required — RLS allows anon INSERT
// only into hotel_booking with enabled hotel id. We go through createBooking()
// which validates input + computes total server-side (client value ignored).

import { createBooking, type BookingInput, type BookingResult } from "@/lib/hotelbook/booking";

export async function actPublicCreateBooking(input: BookingInput): Promise<BookingResult> {
  // Force public source unless explicitly liff (LIFF page also calls this with source='liff')
  if (input.source !== "liff" && input.source !== "fb") input.source = "web";
  return createBooking(input);
}
