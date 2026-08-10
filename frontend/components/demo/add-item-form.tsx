"use client";

import * as React from "react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface AddItemFormProps {
  onSubmit: (name: string, quantity: number) => void;
  disabled?: boolean;
}

export function AddItemForm({ onSubmit, disabled = false }: AddItemFormProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [quantityError, setQuantityError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQuantityError(null);

    const formData = new FormData(e.currentTarget);
    const name = (formData.get("name") as string).trim();
    const quantityRaw = formData.get("quantity") as string;
    const quantity = Math.floor(Number(quantityRaw));

    if (!name) {
      nameInputRef.current?.focus();
      return;
    }

    if (isNaN(quantity) || quantity < 0 || quantity > 10000) {
      setQuantityError("Quantity must be between 0 and 10,000");
      return;
    }

    onSubmit(name, quantity);

    // Reset form
    e.currentTarget.reset();
    setQuantityError(null);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-start gap-2">
      <Input
        ref={nameInputRef}
        name="name"
        type="text"
        placeholder="Item name..."
        disabled={disabled}
        aria-label="Item name"
      />
      <div className="flex flex-col">
        <Input
          name="quantity"
          type="number"
          placeholder="Qty"
          defaultValue={1}
          disabled={disabled}
          error={!!quantityError}
          aria-label="Quantity"
          className="w-24"
        />
        {quantityError && (
          <p className="text-xs text-destructive mt-1">{quantityError}</p>
        )}
      </div>
      <Button type="submit" disabled={disabled}>
        Add Item
      </Button>
    </form>
  );
}
