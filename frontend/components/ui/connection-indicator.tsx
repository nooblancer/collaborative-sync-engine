import * as React from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface ConnectionIndicatorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Current connection status */
  status: ConnectionStatus;
  /** Optional text label displayed next to the indicator */
  label?: string;
  /** Show icon alongside the dot (default false) */
  showIcon?: boolean;
  /** Size of the status dot (default "default") */
  size?: "sm" | "default" | "lg";
}

const dotSizeClasses = {
  sm: "h-2 w-2",
  default: "h-2.5 w-2.5",
  lg: "h-3 w-3",
} as const;

const statusConfig = {
  connected: {
    dotColor: "bg-success",
    ringColor: "ring-success/30",
    label: "Connected",
    Icon: Wifi,
  },
  reconnecting: {
    dotColor: "bg-warning",
    ringColor: "ring-warning/30",
    label: "Reconnecting",
    Icon: RefreshCw,
  },
  disconnected: {
    dotColor: "bg-destructive",
    ringColor: "ring-destructive/30",
    label: "Disconnected",
    Icon: WifiOff,
  },
} as const;

const ConnectionIndicator = React.forwardRef<
  HTMLDivElement,
  ConnectionIndicatorProps
>(({ className, status, label, showIcon = false, size = "default", ...props }, ref) => {
  const config = statusConfig[status];
  const Icon = config.Icon;

  return (
    <div
      ref={ref}
      className={cn("inline-flex items-center gap-2", className)}
      role="status"
      aria-label={label || config.label}
      {...props}
    >
      <span className="relative inline-flex">
        <span
          className={cn(
            "rounded-full ring-2",
            dotSizeClasses[size],
            config.dotColor,
            config.ringColor,
            status === "reconnecting" && "animate-pulse"
          )}
        />
      </span>
      {showIcon && (
        <Icon
          className={cn(
            "h-3.5 w-3.5 text-foreground-muted",
            status === "reconnecting" && "animate-spin"
          )}
          aria-hidden="true"
        />
      )}
      {label && (
        <span className="text-sm text-foreground-muted">{label}</span>
      )}
    </div>
  );
});
ConnectionIndicator.displayName = "ConnectionIndicator";

export { ConnectionIndicator };
