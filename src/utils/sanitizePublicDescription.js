function normalizeMultiline(text) {
  return String(text || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sensitiveStartRegex() {
  return new RegExp(
    [
      "DESCRI(?:C|Ç)[AÃ]O\\s+INTERNA",
      "OBSERVA(?:C|Ç)[AÃ]O(?:ES)?\\s+INTERNA(?:S)?",
      "PROPRIET(?:A|Á)?RI[OA]",
      "CAPTA(?:DOR(?:A)?|[ÇC][AÃÁÀÂ]O)",
      "CORRETOR(?:A)?",
      "CLIENTE",
      "PARCEIR[AO]",
      "PARCERIA",
      "COMISS(?:A|Ã|Á)O",
      "CONTATO(?:\\s+EXCLUSIVO)?",
      "WHATSAPP?",
      "WA\\.ME\\/",
      "\\+55\\s*\\d",
      "(?:\\(?\\d{2}\\)?\\s*)?\\d{4,5}-?\\d{4}",
      "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}",
      "\\bREIS\\b",
      "\\bANDREIA\\b",
      "\\bTEIXEIRA\\b"
    ].join("|"),
    "iu"
  );
}

function cleanInternalPrefix(text) {
  return String(text || "")
    .replace(/^\s*(?:descri(?:c|ç)[aã]o|observa(?:c|ç)[aã]o(?:es)?)\s+interna(?:s)?\s*[:\-]?\s*/iu, "")
    .trim();
}

function stripAdSummarySegment(text) {
  return String(text || "")
    .replace(/(?:^|\s*[|]\s*|\n)\s*resumo\s*(?:do|de)?\s*an[uú]ncio\s*:\s*[\s\S]*$/iu, "")
    .trim();
}

function sanitizeInternalNotesText(text) {
  const noPrefix = String(text || "")
    .replace(/\bdescri(?:c|ç)[aã]o\s+interna\s*:\s*/giu, "")
    .replace(/\bobserva(?:c|ç)[aã]o(?:es)?\s+interna(?:s)?\s*:\s*/giu, "")
    .trim();

  const noSummary = stripAdSummarySegment(noPrefix);
  return normalizeMultiline(noSummary)
    .replace(/\s*[|]\s*$/g, "")
    .trim();
}

function splitSensitiveDescription(value) {
  const text = String(value || "");
  if (!text.trim()) return { publicDescription: "", internalDescription: "" };

  const match = sensitiveStartRegex().exec(text);
  const publicDescription = normalizeMultiline(match ? text.slice(0, match.index) : text);
  const internalRaw = match ? text.slice(match.index) : "";
  const internalDescription = sanitizeInternalNotesText(cleanInternalPrefix(internalRaw));

  return { publicDescription, internalDescription };
}

function sanitizePublicDescription(value) {
  return splitSensitiveDescription(value).publicDescription;
}

module.exports = { sanitizePublicDescription, splitSensitiveDescription, sanitizeInternalNotesText };
