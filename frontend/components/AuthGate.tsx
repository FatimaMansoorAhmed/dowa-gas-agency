"use client";
import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import Shell from "./Shell";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loaded } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loaded && !user) router.push("/login");
  }, [loaded, user, router]);

  if (!loaded || !user) return null;

  return <Shell>{children}</Shell>;
}
