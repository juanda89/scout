import { readFileSync } from "node:fs";
import type { IngestedCreator, IngestedPost } from "./types.js";

export function loadFixtureCreators(file: string): IngestedCreator[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
  return raw.map((c) => ({
    platform: (c.platform as IngestedCreator["platform"]) ?? "instagram",
    handle: String(c.handle),
    display_name: (c.display_name as string) ?? null,
    bio: (c.bio as string) ?? null,
    followers: (c.followers as number) ?? null,
    following: (c.following as number) ?? null,
    posts_count: (c.posts_count as number) ?? null,
    discovered_via: `fixture:${file.split("/").pop()}`,
    posts: ((c.posts as Array<Record<string, unknown>>) ?? []).map((p): IngestedPost => ({
      id: String(p.id),
      kind: (p.kind as IngestedPost["kind"]) ?? "post",
      posted_at: (p.posted_at as string) ?? null,
      caption: (p.caption as string) ?? null,
      likes: p.likes as number | undefined,
      comments: p.comments as number | undefined,
      raw: p,
    })),
  }));
}
