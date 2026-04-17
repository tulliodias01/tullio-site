const { query, pool } = require("../src/db");
const { sanitizeInternalNotesText } = require("../src/utils/sanitizePublicDescription");

function toStoredInternalNotes(raw) {
  const clean = sanitizeInternalNotesText(raw);
  return clean ? `Descricao interna: ${clean}` : null;
}

async function run() {
  const rows = await query(
    "select property_id, internal_notes from property_private where internal_notes is not null and btrim(internal_notes) <> ''"
  );

  let updated = 0;
  for (const row of rows.rows) {
    const next = toStoredInternalNotes(row.internal_notes);
    const prev = row.internal_notes;
    if ((next || null) === (prev || null)) continue;

    await query("update property_private set internal_notes = $1, updated_at = now() where property_id = $2", [next, row.property_id]);
    updated += 1;
  }

  // eslint-disable-next-line no-console
  console.log(`TOTAL=${rows.rows.length} INTERNAL_NOTES_ATUALIZADAS=${updated}`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("ERRO_CLEANUP_INTERNAL_NOTES", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
