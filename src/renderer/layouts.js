// Liste des dispositions clavier supportees.
// Les codes HKL (8 chars hex uppercase) correspondent aux identifiants Win32.
export const LAYOUTS = [
  { hkl: "00000409", label: "Anglais US (QWERTY)" },
  { hkl: "0000040C", label: "Français (France) AZERTY" },
  { hkl: "0000080C", label: "Français (Belgique) AZERTY" },
  { hkl: "00000813", label: "Néerlandais (Belgique)" },
  { hkl: "00000407", label: "Allemand QWERTZ" },
  { hkl: "00000410", label: "Italien QWERTY" },
  { hkl: "00000809", label: "Anglais UK" },
  { hkl: "0000040A", label: "Espagnol" }
];

// Normalise un HKL arbitraire en representation canonique (8 chars hex uppercase).
export function normalizeHkl(hkl) {
  if (!hkl || typeof hkl !== "string") return null;
  const cleaned = hkl.trim().replace(/^0x/i, "").toUpperCase();
  if (!/^[0-9A-F]+$/.test(cleaned)) return null;
  return cleaned.padStart(8, "0");
}

// Retourne le label d'un HKL, ou le HKL brut (normalise) si inconnu.
export function labelForHkl(hkl) {
  const normalized = normalizeHkl(hkl);
  if (!normalized) return hkl || "—";
  const found = LAYOUTS.find((l) => l.hkl === normalized);
  return found ? found.label : normalized;
}
