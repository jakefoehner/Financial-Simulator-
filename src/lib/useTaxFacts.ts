import { useEffect, useState } from "react";
import { api, type TaxFacts } from "./api";

let cached: Promise<TaxFacts> | null = null;

/** Current-law gift/estate figures and AFRs, loaded once from the engine's tax tables. */
export function useTaxFacts(): TaxFacts | null {
  const [facts, setFacts] = useState<TaxFacts | null>(null);
  useEffect(() => {
    cached ??= api.taxFacts();
    cached.then(setFacts).catch(() => {
      cached = null;
    });
  }, []);
  return facts;
}
