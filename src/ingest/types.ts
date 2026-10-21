/** Forma normalizada de una creadora recién ingerida, independiente del proveedor. */
export interface IngestedPost {
  id: string;
  kind: "post" | "reel" | "video" | "story";
  posted_at: string | null;
  caption: string | null;
  transcript?: string | null;
  media_urls?: string[];
  likes?: number;
  comments?: number;
  views?: number;
  raw?: unknown;
}

export interface IngestedCreator {
  platform: "instagram" | "tiktok" | "youtube";
  handle: string;
  display_name?: string | null;
  bio?: string | null;
  followers?: number | null;
  following?: number | null;
  posts_count?: number | null;
  posts: IngestedPost[];
  discovered_via: string;
}
