"use client";

import { Plus, Minus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableRow, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { InventoryItem } from "@/lib/types";

export interface InventoryRowProps {
  item: InventoryItem;
  isFlashing: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  disabled?: boolean;
}

export function InventoryRow({
  item,
  isFlashing,
  onIncrement,
  onDecrement,
  onRemove,
  disabled,
}: InventoryRowProps) {
  const isRemoved = item.removedAt !== null;
  const actionsDisabled = disabled || isRemoved;

  return (
    <TableRow
      className={cn(
        isFlashing && "bg-primary/10 transition-colors duration-1000"
      )}
    >
      <TableCell
        className={cn(isRemoved && "line-through opacity-50")}
      >
        {item.name}
      </TableCell>
      <TableCell
        className={cn(isRemoved && "line-through opacity-50")}
      >
        {item.quantity}
      </TableCell>
      <TableCell>{item.lastUpdatedBy}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Increment quantity"
            disabled={actionsDisabled}
            onClick={onIncrement}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Decrement quantity"
            disabled={actionsDisabled}
            onClick={onDecrement}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove item"
            disabled={actionsDisabled}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
