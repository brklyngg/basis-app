"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createClient();

      // Check if we have a session already (from the hash fragment auto-parsed by Supabase)
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error("Session error:", sessionError);
        setError(sessionError.message);
        return;
      }

      if (session) {
        // Successfully authenticated
        router.push("/dashboard");
        return;
      }

      // If no session, try to get the code from URL params (PKCE flow)
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          console.error("Exchange error:", exchangeError);
          setError(exchangeError.message);
          return;
        }
        router.push("/dashboard");
        return;
      }

      // Check hash fragment for tokens (implicit flow)
      const hash = window.location.hash;
      if (hash) {
        // Supabase client should auto-handle this, but let's verify
        const { data: { session: hashSession } } = await supabase.auth.getSession();
        if (hashSession) {
          router.push("/dashboard");
          return;
        }
      }

      // No auth data found
      setError("No authentication data found. Please try logging in again.");
    };

    handleCallback();
  }, [router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Authentication Error</h1>
          <p className="text-red-600 mb-4">{error}</p>
          <a href="/login" className="text-blue-600 underline">
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="text-neutral-500">Completing sign in...</div>
    </div>
  );
}
