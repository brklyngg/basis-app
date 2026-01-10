import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";

function getRedirectUri(request: NextRequest): string {
  // Use explicit env var if set
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  // Fallback: construct from request URL
  const url = new URL(request.url);
  return `${url.origin}/api/auth/google/callback`;
}

function createOAuthClient(redirectUri: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // User ID
    const error = url.searchParams.get("error");

    console.log("[Google Callback] Starting callback processing");
    console.log("[Google Callback] code present:", !!code, "state:", state, "error:", error);

    // Handle OAuth errors
    if (error) {
      console.error("[Google Callback] OAuth error from Google:", error);
      return NextResponse.redirect(
        new URL(`/dashboard?google_error=${encodeURIComponent(error)}`, request.url)
      );
    }

    if (!code || !state) {
      console.error("[Google Callback] Missing code or state");
      return NextResponse.redirect(
        new URL("/dashboard?google_error=missing_params", request.url)
      );
    }

    // Create OAuth client with proper redirect URI
    const redirectUri = getRedirectUri(request);
    console.log("[Google Callback] Using redirect URI:", redirectUri);
    const oauth2Client = createOAuthClient(redirectUri);

    // Exchange code for tokens
    console.log("[Google Callback] Exchanging code for tokens...");
    const { tokens } = await oauth2Client.getToken(code);
    console.log("[Google Callback] Token exchange result - access_token:", !!tokens.access_token, "refresh_token:", !!tokens.refresh_token);

    if (!tokens.access_token || !tokens.refresh_token) {
      console.error("[Google Callback] Missing tokens from Google:", tokens);
      return NextResponse.redirect(
        new URL("/dashboard?google_error=missing_tokens", request.url)
      );
    }

    // Verify user is still authenticated
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    console.log("[Google Callback] User auth check - user:", user?.id, "authError:", authError?.message, "state:", state);

    if (authError || !user || user.id !== state) {
      console.error("[Google Callback] Auth mismatch - user.id:", user?.id, "state:", state, "authError:", authError);
      return NextResponse.redirect(
        new URL("/dashboard?google_error=auth_mismatch", request.url)
      );
    }

    // Calculate token expiry
    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000); // Default 1 hour

    // Upsert tokens in database
    console.log("[Google Callback] Upserting tokens for user:", user.id);
    const { error: upsertError } = await supabase
      .from("google_tokens")
      .upsert({
        user_id: user.id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id",
      });

    if (upsertError) {
      console.error("[Google Callback] Failed to save Google tokens:", upsertError);
      return NextResponse.redirect(
        new URL("/dashboard?google_error=save_failed", request.url)
      );
    }

    console.log("[Google Callback] Success! Redirecting with google_connected=true");
    // Success - redirect back to dashboard
    return NextResponse.redirect(
      new URL("/dashboard?google_connected=true", request.url)
    );
  } catch (error) {
    console.error("[Google Callback] Unexpected error:", error);
    return NextResponse.redirect(
      new URL("/dashboard?google_error=callback_failed", request.url)
    );
  }
}
