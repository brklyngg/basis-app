"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Step = "email" | "otp";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    setLoading(false);

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      setStep("otp");
      setMessage({
        type: "success",
        text: "Check your email for a 6-digit code.",
      });
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const supabase = createClient();

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otpCode,
      type: "email",
    });

    setLoading(false);

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      router.push("/dashboard");
    }
  };

  const handleBackToEmail = () => {
    setStep("email");
    setOtpCode("");
    setMessage(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Basis</CardTitle>
          <CardDescription>
            Talk to your money. Get insights without judgment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "email" ? (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending..." : "Send Code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div className="text-sm text-neutral-600 mb-2">
                Enter the 6-digit code sent to <span className="font-medium">{email}</span>
              </div>
              <div>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  required
                  disabled={loading}
                  className="text-center text-2xl tracking-widest"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || otpCode.length !== 6}>
                {loading ? "Verifying..." : "Verify Code"}
              </Button>
              <button
                type="button"
                onClick={handleBackToEmail}
                className="w-full text-sm text-neutral-500 hover:text-neutral-700"
              >
                Use a different email
              </button>
            </form>
          )}

          {message && (
            <div
              className={`mt-4 p-3 rounded-md text-sm ${
                message.type === "success"
                  ? "bg-green-50 text-green-800"
                  : "bg-red-50 text-red-800"
              }`}
            >
              {message.text}
            </div>
          )}

          {step === "email" && (
            <p className="mt-6 text-center text-sm text-neutral-500">
              We&apos;ll send you a code to sign in. No password needed.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
