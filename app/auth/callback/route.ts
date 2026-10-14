import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Callback OAuth / verifikasi email Supabase.
 * Menukar `code` menjadi sesi lalu mengarahkan ke tujuan.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Cegah open-redirect: hanya path internal yang diizinkan sebagai tujuan.
  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  if (code) {
    const response = NextResponse.redirect(`${origin}${next}`);
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.headers
              .get("cookie")
              ?.split(";")
              .map((c) => {
                const i = c.indexOf("=");
                return {
                  name: c.slice(0, i).trim(),
                  value: decodeURIComponent(c.slice(i + 1)),
                };
              }) ?? [];
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=verifikasi-gagal`);
    }
    return response;
  }

  return NextResponse.redirect(`${origin}/login`);
}
