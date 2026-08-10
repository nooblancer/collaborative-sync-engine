"use client";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
} from "@/components/ui/table";
import { InventoryRow } from "@/components/demo/inventory-row";
import type { InventoryItem } from "@/lib/types";

export interface InventoryTableProps {
  items: InventoryItem[];
  flashingItemId: string | null;
  onIncrement: (itemId: string) => void;
  onDecrement: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  disabled?: boolean;
}

export function InventoryTable({
  items,
  flashingItemId,
  onIncrement,
  onDecrement,
  onRemove,
  disabled,
}: InventoryTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead>Last Updated By</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <InventoryRow
            key={item.itemId}
            item={item}
            isFlashing={flashingItemId === item.itemId}
            onIncrement={() => onIncrement(item.itemId)}
            onDecrement={() => onDecrement(item.itemId)}
            onRemove={() => onRemove(item.itemId)}
            disabled={disabled}
          />
        ))}
      </TableBody>
    </Table>
  );
}
