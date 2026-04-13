// ═══════════════════════════════════════════════════════════════
// Parser para PDFs de taxas de corrosão KOH
// Extrai tabelas no formato FATEC-SP / Bariatto
// ═══════════════════════════════════════════════════════════════

/**
 * Extract text from a PDF file using pdf.js (loaded from CDN).
 * Returns array of page texts.
 */
async function extractTextFromPDF(file) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("pdf.js não carregado. Verifique a conexão com a internet.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Get items with positions for better structure parsing
    const items = content.items
      .filter(item => item.str.trim().length > 0)
      .map(item => ({
        text: item.str.trim(),
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
      }));

    pages.push(items);
  }

  return pages;
}

/**
 * Parse a number that may use comma as decimal separator.
 */
function parseNum(s) {
  if (!s || s.trim() === '') return NaN;
  // Replace comma with period
  const cleaned = s.trim().replace(',', '.');
  return parseFloat(cleaned);
}

/**
 * Group text items into rows by Y coordinate (within tolerance).
 */
function groupIntoRows(items, yTolerance = 4) {
  if (!items.length) return [];

  // Sort by Y descending (PDF Y goes up), then by X
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  let currentRow = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - currentY) <= yTolerance) {
      currentRow.push(sorted[i]);
    } else {
      // Sort row by X
      currentRow.sort((a, b) => a.x - b.x);
      rows.push(currentRow);
      currentRow = [sorted[i]];
      currentY = sorted[i].y;
    }
  }
  if (currentRow.length > 0) {
    currentRow.sort((a, b) => a.x - b.x);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Try to find concentration block headers and parse their data.
 * Looks for patterns like "XX% KOH" in the text.
 */
function parseConcentrationBlocks(pages) {
  const dataset = {
    temperatures: [],
    concentrations: [],
    siEtchRate: {},
    sio2EtchRate: {},
  };

  // Known temperatures we expect
  const expectedTemps = [20, 30, 40, 50, 60, 70, 80, 90, 100];

  for (const pageItems of pages) {
    const rows = groupIntoRows(pageItems);

    for (let ri = 0; ri < rows.length; ri++) {
      const rowText = rows[ri].map(it => it.text).join(' ');

      // Look for concentration header: "SiO2 XX% KOH" or "XX% KOH Si/SiO2"
      const concMatch = rowText.match(/(?:SiO2?\s+)?(\d+)\s*%\s*KOH/i);
      if (!concMatch) continue;

      const conc = parseInt(concMatch[1]);
      if (isNaN(conc) || conc < 1 || conc > 100) continue;

      // Look for data rows following this header
      // Skip header rows (containing "Temperatura", "Corrosão", etc.)
      const dataRows = [];
      for (let di = ri + 1; di < rows.length && dataRows.length < 12; di++) {
        const dRowText = rows[di].map(it => it.text).join(' ');

        // Skip header/label rows
        if (/temperatura|corros|rela[çc]/i.test(dRowText)) continue;

        // Check if this looks like another concentration header
        if (/\d+\s*%\s*KOH/i.test(dRowText) && !dRowText.startsWith(String(conc))) break;
        // Also break if we see "Silício" which is a section header
        if (/sil[ií]cio\s+\d+%/i.test(dRowText)) break;

        // Try to extract numbers from this row
        // We need: temperature, Si rate, SiO2 rate, selectivity (4 numbers)
        // But some rows might have extra numbers from adjacent columns in the PDF

        // Get all items from this row that are numbers
        const nums = [];
        for (const item of rows[di]) {
          const n = parseNum(item.text);
          if (!isNaN(n)) {
            nums.push({ val: n, x: item.x });
          }
        }

        // We need at least 3 numbers (temp, si_rate, sio2_rate)
        // Take the leftmost 4 numbers (or 3 if selectivity is missing)
        if (nums.length >= 3) {
          // Sort by x position to get correct order
          nums.sort((a, b) => a.x - b.x);

          const temp = nums[0].val;
          // Verify it looks like a temperature
          if (expectedTemps.includes(temp)) {
            dataRows.push({
              temp,
              siRate: nums[1].val,
              sio2Rate: nums[2].val,
              selectivity: nums.length >= 4 ? nums[3].val : null,
            });
          }
        }
      }

      // Only accept if we got reasonable data (at least 5 temperature points)
      if (dataRows.length >= 5) {
        if (!dataset.concentrations.includes(conc)) {
          dataset.concentrations.push(conc);
        }

        dataset.siEtchRate[conc] = [];
        dataset.sio2EtchRate[conc] = [];

        // Sort by temperature
        dataRows.sort((a, b) => a.temp - b.temp);

        for (const row of dataRows) {
          if (!dataset.temperatures.includes(row.temp)) {
            dataset.temperatures.push(row.temp);
          }
          dataset.siEtchRate[conc].push(row.siRate);
          dataset.sio2EtchRate[conc].push(row.sio2Rate);
        }
      }
    }
  }

  // Sort temperatures and concentrations
  dataset.temperatures.sort((a, b) => a - b);
  dataset.concentrations.sort((a, b) => a - b);

  // Validate: ensure all concentrations have the same temperature count
  const nTemps = dataset.temperatures.length;
  for (const conc of dataset.concentrations) {
    if (dataset.siEtchRate[conc]?.length !== nTemps) {
      console.warn(`Concentration ${conc}% has ${dataset.siEtchRate[conc]?.length} points, expected ${nTemps}`);
    }
  }

  return dataset;
}

/**
 * Alternative parser: look for the consolidated tables
 * (the summary tables on the right side of the PDF with all concentrations)
 */
function parseConsolidatedTables(pages) {
  // This is a fallback - look for rows that start with a concentration
  // and have 9 numbers following (one per temperature)
  const allText = pages.map(p => {
    const rows = groupIntoRows(p);
    return rows.map(r => r.map(it => it.text).join('\t'));
  }).flat();

  // Look for the pattern: a line that starts with "% KOH" followed by temperature headers
  // then lines with concentration + 9 values

  const siRates = {};
  const sio2Rates = {};
  let currentSection = null; // 'si' or 'sio2'
  let headerFound = false;

  for (const line of allText) {
    // Detect section
    if (/sil[ií]cio.*um\/hr/i.test(line) && !/[oó]xido/i.test(line)) {
      currentSection = 'si';
      headerFound = false;
      continue;
    }
    if (/[oó]xido.*sil[ií]cio.*um\/hr/i.test(line)) {
      currentSection = 'sio2';
      headerFound = false;
      continue;
    }

    if (!currentSection) continue;

    // Look for temperature header row
    if (/^\s*%\s*KOH/i.test(line) || /20\s+30\s+40\s+50/i.test(line)) {
      headerFound = true;
      continue;
    }

    if (!headerFound) continue;

    // Try to parse data row: conc val1 val2 ... val9
    const nums = line.split(/\s+/).map(s => parseNum(s)).filter(n => !isNaN(n));
    if (nums.length >= 10) { // concentration + 9 temperatures
      const conc = nums[0];
      if (conc >= 5 && conc <= 65) {
        const rates = nums.slice(1, 10);
        if (currentSection === 'si') {
          siRates[conc] = rates;
        } else {
          sio2Rates[conc] = rates;
        }
      }
    }
  }

  // If we found data, build dataset
  const siConcs = Object.keys(siRates).map(Number).sort((a, b) => a - b);
  const sio2Concs = Object.keys(sio2Rates).map(Number).sort((a, b) => a - b);

  if (siConcs.length >= 3 && sio2Concs.length >= 3) {
    const concs = [...new Set([...siConcs, ...sio2Concs])].sort((a, b) => a - b);
    return {
      temperatures: [20, 30, 40, 50, 60, 70, 80, 90, 100],
      concentrations: concs,
      siEtchRate: siRates,
      sio2EtchRate: sio2Rates,
    };
  }

  return null;
}

/**
 * Main parsing function. Tries block-based parsing first,
 * falls back to consolidated table parsing.
 */
export async function parsePDF(file) {
  const pages = await extractTextFromPDF(file);

  // Try block-based parsing first (more reliable)
  let dataset = parseConcentrationBlocks(pages);

  // Validate result
  const isGood = dataset.concentrations.length >= 3 &&
    dataset.temperatures.length >= 5;

  if (!isGood) {
    // Try consolidated table parsing
    const alt = parseConsolidatedTables(pages);
    if (alt && alt.concentrations.length >= 3) {
      dataset = alt;
    }
  }

  if (dataset.concentrations.length < 2) {
    throw new Error(
      "Não foi possível extrair dados suficientes do PDF. " +
      "Verifique se o arquivo contém tabelas de taxas de corrosão " +
      "no formato esperado (blocos por concentração com colunas " +
      "Temperatura / Corrosão Si / Corrosão SiO₂)."
    );
  }

  return dataset;
}

/**
 * Get raw text from PDF for debugging/preview.
 */
export async function getRawText(file) {
  const pages = await extractTextFromPDF(file);
  return pages.map((pageItems, i) => {
    const rows = groupIntoRows(pageItems);
    const text = rows.map(r => r.map(it => it.text).join('\t')).join('\n');
    return `=== Página ${i + 1} ===\n${text}`;
  }).join('\n\n');
}
