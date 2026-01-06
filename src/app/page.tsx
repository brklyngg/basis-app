import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string; error_description?: string }>;
}) {
  const params = await searchParams;

  // If there's an auth code, redirect to callback to handle it
  if (params.code) {
    redirect(`/auth/callback?code=${params.code}`);
  }

  // If there's an auth error, redirect to login with error
  if (params.error) {
    redirect(`/login?error=${params.error_description || params.error}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  } else {
    redirect("/login");
  }
}
