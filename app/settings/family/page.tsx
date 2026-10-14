import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-server";
import { PageShell } from "@/components/layout";
import { LogoutButton } from "@/components/logout-button";
import {
  InviteList,
  InvitePanel,
  LeaveFamilyButton,
  type InviteRow,
} from "@/components/family-card";
import { Card, Alert } from "@/components/ui";
import type { Family } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export default async function FamilySettingsPage() {
  const { supabase, user } = await getAuthContext();
  if (!user || !supabase) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,full_name")
    .eq("id", user.id)
    .maybeSingle();

  const { data: membership } = await supabase
    .from("family_members")
    .select("family_id,role,status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const m = membership as { family_id: string; role: string } | null;

  let family: Family | null = null;
  let members: { user_id: string; role: string; joined_at: string }[] = [];
  let invites: InviteRow[] = [];

  if (m) {
    const { data: fam } = await supabase
      .from("families")
      .select("id,name,currency,created_by,created_at,updated_at")
      .eq("id", m.family_id)
      .maybeSingle();
    family = (fam as Family | null) ?? null;
    const { data: memberRows } = await supabase
      .from("family_members")
      .select("user_id,role,joined_at")
      .eq("family_id", m.family_id)
      .eq("status", "active")
      .order("joined_at", { ascending: true });
    members = (memberRows ?? []) as typeof members;
    if (m.role === "owner") {
      const { data: inviteRows } = await supabase.rpc("list_family_invites", {
        p_family_id: m.family_id,
      });
      invites = (inviteRows ?? []) as InviteRow[];
    }
  }

  return (
    <PageShell email={user.email} action={<LogoutButton />}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Keluarga</h1>
          <p className="mt-1 text-sm text-stone-600">
            Kelola workspace keluarga dan undangan pasangan.
          </p>
        </div>

        <Card title="Profil saya" description={user.email ?? undefined}>
          <p className="text-sm text-stone-700">
            Nama:{" "}
            <strong>
              {(profile as { full_name?: string } | null)?.full_name ?? "—"}
            </strong>
          </p>
        </Card>

        {!family || !m ? (
          <Card
            title="Belum tergabung dalam keluarga"
            description="Buat keluarga baru dari dasbor, atau gabung memakai tautan undangan dari pasangan."
          >
            <div className="flex flex-wrap gap-3">
              <a
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                Buat keluarga
              </a>
              <a
                href="/join"
                className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:border-teal-600 hover:text-teal-800"
              >
                Gabung dengan undangan
              </a>
            </div>
          </Card>
        ) : (
          <>
            <Card
              title={family.name}
              description={`Mata uang ${family.currency} • Peran Anda: ${
                m.role === "owner" ? "Pemilik" : "Anggota"
              }`}
            >
              <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                {members.map((row) => (
                  <li
                    key={row.user_id}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-stone-600">
                      {row.user_id.slice(0, 8)}…
                      {row.user_id === user.id ? " (Anda)" : ""}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.role === "owner"
                          ? "bg-teal-700/10 text-teal-800"
                          : "bg-stone-100 text-stone-700"
                      }`}
                    >
                      {row.role === "owner" ? "Pemilik" : "Anggota"}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {m.role === "owner" ? (
              <>
                <InvitePanel familyId={family.id} />
                <InviteList familyId={family.id} invites={invites} />
              </>
            ) : (
              <Alert kind="info">
                Hanya pemilik keluarga yang dapat membuat dan mencabut undangan.
              </Alert>
            )}

            <Card title="Zona berbahaya" description="Keluar dari workspace keluarga.">
              <LeaveFamilyButton />
            </Card>
          </>
        )}
      </div>
    </PageShell>
  );
}
