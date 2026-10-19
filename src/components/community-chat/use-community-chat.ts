import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import {
  policyAcceptanceRequired,
  sortRooms,
  type ChatPolicy,
  type CommunityMessage,
  type CommunityRoomSummary,
} from "@/lib/community-chat/chat";

/** Newest messages kept in the stream. Older history is not paged in yet. */
const MESSAGE_WINDOW = 100;

/**
 * Every room this member may open, newly created rooms included.
 *
 * The list is whatever the database returns: row level security filters it to
 * the rooms this member's access policy admits, so nothing here decides
 * membership and no room is hard-coded.
 */
export function useCommunityRooms() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  return useQuery({
    queryKey: ["community-rooms", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("community_rooms")
        .select("id, slug, name, description, access_policy, room_kind, sort_order")
        .eq("is_active", true);
      if (error) throw error;
      return sortRooms((data ?? []) as CommunityRoomSummary[]);
    },
    staleTime: 30_000,
  });
}

export function useCommunityRoom(slug: string) {
  const rooms = useCommunityRooms();
  return {
    ...rooms,
    room: rooms.data?.find((candidate) => candidate.slug === slug) ?? null,
  };
}

/**
 * Published messages in one room, oldest first.
 *
 * Polling is the guaranteed path; the realtime subscription is an accelerator
 * that only fires when `community_messages` is in the realtime publication.
 *
 * Supabase Realtime enforces row level security on the row being broadcast, so
 * an UPDATE that hides a message (which fails the member-read policy on its
 * new state) is not delivered to member subscribers at all — only the poll
 * catches that. The UPDATE listener below still helps: it speeds up a message
 * becoming visible again (unhide/restore), which passes RLS on its new state.
 */
export function useCommunityMessages(roomId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["community-messages", roomId],
    enabled: Boolean(roomId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("community_messages")
        .select(
          "id, room_id, user_id, body, created_at, author_display_name, author_handle, author_badge, author_avatar_url",
        )
        .eq("room_id", roomId!)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_WINDOW);
      if (error) throw error;
      return ((data ?? []) as CommunityMessage[]).slice().reverse();
    },
    // Kept short because an automated or staff hide is not delivered by the
    // realtime UPDATE listener below (see the note above); this bounds how
    // long a hidden message can still appear in an already-open room.
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`community-chat:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "community_messages",
          filter: `room_id=eq.${roomId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: ["community-messages", roomId] }),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "community_messages",
          filter: `room_id=eq.${roomId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: ["community-messages", roomId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, queryClient]);

  return query;
}

/**
 * The active chat policy and whether this member has accepted it.
 * Acceptance is per version: a new version asks everyone again.
 */
export function useChatPolicy() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  return useQuery({
    queryKey: ["community-chat-policy", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const [policyResult, acceptanceResult] = await Promise.all([
        supabase
          .from("community_chat_policy_versions")
          .select("id, version, title, summary, body_markdown")
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("community_chat_policy_acceptances")
          .select("policy_version_id")
          .eq("user_id", userId!),
      ]);
      if (policyResult.error) throw policyResult.error;
      if (acceptanceResult.error) throw acceptanceResult.error;
      const policy = (policyResult.data ?? null) as ChatPolicy | null;
      const accepted = (acceptanceResult.data ?? []).map((row) => row.policy_version_id);
      return { policy, needsAcceptance: policyAcceptanceRequired(policy, accepted) };
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * This member's own active restriction in a room, if any. The database
 * function answers only for the caller's own account.
 */
export function useMyChatRestriction(roomId: string | null) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  return useQuery({
    queryKey: ["community-chat-restriction", userId, roomId],
    enabled: Boolean(userId && roomId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("community_chat_restriction", {
        _user_id: userId!,
        _room_id: roomId!,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    staleTime: 60_000,
  });
}
