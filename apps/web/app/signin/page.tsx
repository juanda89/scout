import { redirect } from "next/navigation";
import { auth, authMode, signIn } from "@/auth";
import { Wordmark } from "@/components/Logo";
import { Orb } from "@/components/Orb";
import { HudRings } from "@/components/HudRings";
import { AmbientField } from "@/components/AmbientField";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/scoutings");
  const sp = await searchParams;
  const callbackUrl = sp.callbackUrl ?? "/scoutings";
  return (
    <div style={{ position: "relative", minHeight: "100vh", padding: "40px 16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#F4F4F6", overflow: "hidden" }}>
      <AmbientField fx={0.5} fy={0.34} intensity={1.1} />
      <main style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div className="bloom" style={{ position: "relative", width: 300, height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0 }}><HudRings px={300} /></div>
          <div style={{ position: "relative" }}><Orb mode="breathing" px={112} /></div>
        </div>
        <section className="rise" aria-labelledby="h-sign" style={{ width: "100%", padding: "28px 32px 26px", display: "flex", flexDirection: "column", alignItems: "center", gap: 22, background: "var(--glass)", backdropFilter: "blur(18px) saturate(1.5)", WebkitBackdropFilter: "blur(18px) saturate(1.5)", border: "1px solid var(--glass-line)", borderRadius: 20, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(16,16,24,0.04), 0 16px 48px rgba(16,16,24,0.07)", animationDelay: ".35s" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
          <Wordmark size={18} />
          <h1 id="h-sign" style={{ margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600, letterSpacing: "-0.02em" }}>Sign in</h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--ink-3)" }}>Find the creators that fit your brief.</p>
        </div>
        {sp.error && <p role="alert" style={{ margin: 0, padding: "10px 12px", width: "100%", borderRadius: 10, background: "var(--orange-bg)", color: "var(--orange-ink)", fontSize: 13 }}>{sp.error === "AccessDenied" ? "This account is not on the allowed list. Ask your admin to add it." : "Sign-in failed. Please try again."}</p>}
        {authMode === "google" && (
          <form style={{ width: "100%" }} action={async () => { "use server"; await signIn("google", { redirectTo: callbackUrl }); }}>
            <button type="submit" className="gsi" style={{ width: "100%", height: 40, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, border: "1px solid #747775", borderRadius: 20, background: "#fff", color: "#1F1F1F", fontFamily: "Roboto, Arial, sans-serif", fontSize: 14, fontWeight: 500, letterSpacing: "0.25px", cursor: "pointer" }}>
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              <span>Continue with Google</span>
            </button>
          </form>
        )}
        {authMode === "dev" && (
          <form style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }} action={async (fd: FormData) => { "use server"; await signIn("dev", { email: String(fd.get("email") ?? ""), redirectTo: callbackUrl }); }}>
            <input name="email" type="email" required placeholder="you@agency.com" className="in" aria-label="Email" />
            <button type="submit" className="btn btn-lg" style={{ width: "100%" }}>Continue (development sign-in)</button>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Google sign-in appears here once GOOGLE_CLIENT_ID is configured.</p>
          </form>
        )}
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--muted)", textAlign: "center", textWrap: "pretty" }}>By continuing you agree to the <a href="#" style={{ textDecoration: "underline" }}>Terms</a> and <a href="#" style={{ textDecoration: "underline" }}>Privacy Policy</a>.</p>
        </section>
      </main>
    </div>
  );
}
