// ═══════════════════════════════════════════════════════════════
// Taxas de Corrosão Si e SiO₂ em KOH
// Fonte: "Taxas de Corrosão Si e SiO2.pdf" — FATEC-SP (Bariatto, 2026)
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_DATASET = {
  id: "fatec-sp-2026",
  name: "Taxas de Corrosão Si e SiO₂ — FATEC-SP (Bariatto, 2026)",
  source: "Tabela fornecida pelo professor — dados padrão do sistema",
  createdAt: "2026-01-01T00:00:00.000Z",
  isDefault: true,
  temperatures: [20, 30, 40, 50, 60, 70, 80, 90, 100],
  concentrations: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
  siEtchRate: {
    10:  [1.49, 3.2, 6.7, 13.3, 25.2, 46, 82, 140, 233],
    15:  [1.56, 3.4, 7, 14, 26.5, 49, 86, 147, 245],
    20:  [1.57, 3.4, 7.1, 14, 26.7, 49, 86, 148, 246],
    25:  [1.53, 3.3, 6.9, 13.6, 25.9, 47, 84, 144, 239],
    30:  [1.44, 3.1, 6.5, 12.8, 24.4, 45, 79, 135, 225],
    35:  [1.32, 2.9, 5.9, 11.8, 22.3, 41, 72, 124, 206],
    40:  [1.17, 2.5, 5.3, 10.5, 19.9, 36, 64, 110, 184],
    45:  [1.01, 2.2, 4.6, 9, 17.1, 31, 55, 95, 158],
    50:  [0.84, 1.8, 3.8, 7.5, 14.2, 26, 46, 79, 131],
    55:  [0.66, 1.4, 3, 5.9, 11.2, 21, 36, 62, 104],
    60:  [0.5, 1.1, 2.2, 4.4, 8.4, 15, 27, 47, 78],
  },
  sio2EtchRate: {
    10:  [0.0004, 0.00122, 0.0035, 0.0092, 0.023, 0.054, 0.123, 0.266, 0.551],
    15:  [0.00063, 0.00191, 0.0054, 0.0144, 0.036, 0.085, 0.193, 0.416, 0.862],
    20:  [0.00088, 0.00266, 0.0075, 0.02, 0.05, 0.118, 0.268, 0.578, 1.2],
    25:  [0.00114, 0.00346, 0.0098, 0.026, 0.065, 0.154, 0.348, 0.752, 1.56],
    30:  [0.00142, 0.00432, 0.0122, 0.0325, 0.081, 0.193, 0.435, 0.94, 1.95],
    35:  [0.00144, 0.00437, 0.0124, 0.0328, 0.082, 0.195, 0.44, 0.949, 1.97],
    40:  [0.00133, 0.00403, 0.0114, 0.0303, 0.076, 0.18, 0.406, 0.876, 1.82],
    45:  [0.00121, 0.00367, 0.0104, 0.0275, 0.069, 0.163, 0.369, 0.797, 1.65],
    50:  [0.00108, 0.00328, 0.0093, 0.0246, 0.062, 0.146, 0.33, 0.713, 1.48],
    55:  [0.00095, 0.00287, 0.0081, 0.0216, 0.054, 0.128, 0.289, 0.624, 1.29],
    60:  [0.00081, 0.00245, 0.0069, 0.0184, 0.046, 0.109, 0.246, 0.532, 1.1],
  },
};

// Load saved datasets from localStorage
export function loadDatasets() {
  try {
    const raw = localStorage.getItem("koh-datasets");
    if (!raw) return [DEFAULT_DATASET];
    const saved = JSON.parse(raw);
    // Always include default as first
    const withoutDefault = saved.filter(d => d.id !== DEFAULT_DATASET.id);
    return [DEFAULT_DATASET, ...withoutDefault];
  } catch {
    return [DEFAULT_DATASET];
  }
}

// Save datasets to localStorage (excluding default)
export function saveDatasets(datasets) {
  const toSave = datasets.filter(d => !d.isDefault);
  localStorage.setItem("koh-datasets", JSON.stringify(toSave));
}

// Load active dataset ID
export function loadActiveId() {
  return localStorage.getItem("koh-active-dataset") || DEFAULT_DATASET.id;
}

// Save active dataset ID
export function saveActiveId(id) {
  localStorage.setItem("koh-active-dataset", id);
}
