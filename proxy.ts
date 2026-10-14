import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 `proxy` (pengganti middleware klasik).
 * Tugasnya: sinkronkan sesi Supabase lewat cookie di setiap request.
 * Otorisasi halaman proteksi tetap divalidasi di server component (getUser).
 */
export default async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
