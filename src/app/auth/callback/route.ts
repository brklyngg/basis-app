import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const error = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");
  const origin = process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin;

  // Handle OAuth errors
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription || error)}`
    );
  }

  // Exchange code for session (used by OAuth flows)
  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`
      );
    }

    return NextResponse.redirect(`${origin}/dashboard`);
  }

  return NextResponse.redirect(`${origin}/login`);
}
