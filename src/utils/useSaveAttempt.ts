import { useRef, useState } from "react";

export function useSaveAttempt() {
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);

  async function save(write: () => Promise<boolean>) {
    if (pending.current) return false;
    pending.current = true;
    setSaving(true);
    try {
      return await write();
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return { pending, saving, save };
}
