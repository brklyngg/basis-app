"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Completing sign in...");

  useEffect(() => {
    const supabase = createClient();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("Auth event:", event, session);

        if (event === "SIGNED_IN" && session) {
          setStatus("Success! Redirecting...");
          router.push("/dashboard");
        } else if (event === "TOKEN_REFRESHED" && session) {
          router.push("/dashboard");
        }
      }
    );

    // Also check if we're already signed in (for PKCE code flow)
    const checkAuth = async () => {
      // Check URL for code parameter (PKCE flow)
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const errorParam = params.get("error");
      const errorDescription = params.get("error_description");

      if (errorParam) {
        setError(errorDescription || errorParam);
        return;
      }

      if (code) {
        setStatus("Exchanging code...");
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          console.error("Exchange error:", exchangeError);
          setError(exchangeError.message);
          return;
        }
        // The onAuthStateChange will handle the redirect
        return;
      }

      // Check if session already exists (hash was auto-parsed)
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setStatus("Session found! Redirecting...");
        router.push("/dashboard");
        return;
      }

      // If we have a hash but no session yet, wait a moment for Supabase to parse it
      if (window.location.hash) {
        setStatus("Processing authentication...");
        // Give Supabase a moment to parse the hash
        setTimeout(async () => {
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          if (retrySession) {
            router.push("/dashboard");
          } else {
            setError("Failed to establish session. Please try logging in again.");
          }
        }, 1000);
        return;
      }

      // No auth data at all
      setError("No authentication data found. Please try logging in again.");
    };

    checkAuth();

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-bold mb-2">Authentication Error</h1>
          <p className="text-red-600 mb-4">{error}</p>
          <a
            href="/login"
            className="inline-block px-4 py-2 bg-neutral-900 text-white rounded-md"
          >
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="text-center">
        <div className="text-neutral-500 mb-2">{status}</div>
        <div className="animate-pulse text-sm text-neutral-400">Please wait...</div>
      </div>
    </div>
  );
}
