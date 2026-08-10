"use client";

import { Badge } from "@/components/ui/badge";
import type { UserPresence } from "@/lib/types";

export interface PresenceBarProps {
  users: UserPresence[];
  currentUserId: string;
}

export function PresenceBar({ users, currentUserId }: PresenceBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {users.map((user) => (
        <Badge
          key={user.userId}
          variant={user.userId === currentUserId ? "default" : "secondary"}
        >
          {user.displayName}
        </Badge>
      ))}
    </div>
  );
}
