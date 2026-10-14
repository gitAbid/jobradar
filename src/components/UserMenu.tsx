import Link from "next/link";
import { connection } from "next/server";
import { signOut } from "@/auth";
import { getSessionUser } from "@/lib/authz";
import { auth } from "@/auth";

async function logout() {
  "use server";
  await signOut({ redirectTo: "/signin" });
}

/** Header user area; reads the session, so render it inside <Suspense>. */
export async function UserMenu() {
  await connection();
  const user = await getSessionUser();
  if (!user) {
    return (
      <Link href="/signin" className="text-sm font-medium text-primary hover:underline">
        Sign in
      </Link>
    );
  }
  const image = (await auth())?.user?.image;
  return (
    <div className="flex items-center gap-2 text-sm">
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" width={24} height={24} referrerPolicy="no-referrer" className="h-6 w-6 rounded-full" />
      )}
      <span className="max-w-40 truncate text-muted" title={user.email}>{user.email}</span>
      <form action={logout}>
        <button type="submit" className="font-medium text-foreground hover:underline">Sign out</button>
      </form>
    </div>
  );
}
