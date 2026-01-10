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

// Scopes needed for Google Sheets
// Using only drive.file (recommended/non-sensitive) instead of spreadsheets (sensitive)
// drive.file allows creating and editing files the app creates, which is sufficient
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
];

export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validate required env vars
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error("Missing Google OAuth credentials:", {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
      });
      return NextResponse.json(
        { error: "Google OAuth not configured" },
        { status: 500 }
      );
    }

    // Create OAuth client with proper redirect URI
    const redirectUri = getRedirectUri(request);
    const oauth2Client = createOAuthClient(redirectUri);

    // Generate OAuth URL with state parameter (user ID for callback)
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      state: user.id, // Pass user ID to callback
      prompt: "consent", // Force consent to get refresh token
    });

    // Debug logging
    console.log("Google OAuth URL generated:", {
      redirectUri,
      clientIdPrefix: clientId.substring(0, 20) + "...",
      authUrlPrefix: authUrl.substring(0, 100) + "...",
    });

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("Google OAuth initiation error:", error);
    return NextResponse.json(
      { error: "Failed to initiate Google OAuth" },
      { status: 500 }
    );
  }
}

// Check if user has Google connected
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has valid Google tokens
    const { data: tokens, error: tokensError } = await supabase
      .from("google_tokens")
      .select("expires_at")
      .eq("user_id", user.id)
      .single();

    if (tokensError || !tokens) {
      return NextResponse.json({ connected: false });
    }

    // Check if token is expired
    const isExpired = new Date(tokens.expires_at) < new Date();

    return NextResponse.json({
      connected: true,
      needsRefresh: isExpired,
    });
  } catch (error) {
    console.error("Google OAuth status check error:", error);
    return NextResponse.json(
      { error: "Failed to check Google OAuth status" },
      { status: 500 }
    );
  }
}
