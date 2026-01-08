import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const error = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  // Debug: Log all cookies to see what's available
  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  console.log("Auth callback - cookies received:", allCookies.map(c => c.name));
  console.log("Auth callback - code param:", code ? "present" : "missing");

  // Use configured app URL or fall back to request origin
  const origin = process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin;

  // Handle OAuth errors from Supabase
  if (error) {
    console.error("Auth callback error:", error, errorDescription);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription || error)}`
    );
  }

  // Exchange code for session
  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error("Session exchange error:", exchangeError.message);
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`
      );
    }

    // Success - redirect to dashboard
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  // No code provided - redirect to login
  return NextResponse.redirect(`${origin}/login`);
}
