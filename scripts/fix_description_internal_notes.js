const { query, pool } = require("../src/db");
const { splitSensitiveDescription } = require("../src/utils/sanitizePublicDescription");

function asText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function mergeInternalNotes(existing, extracted) {
  const current = asText(existing);
  const extra = asText(extracted);
  if (!extra) return current || null;
  const block = `Descricao interna: ${extra}`;

  if (!current) return block;
  if (current.includes(block)) return current;
  return `${current}\n\n${block}`;
}

async function run() {
  const rows = await query(
    `select p.id, p.description, pp.internal_notes
     from properties p
     left join property_private pp on pp.property_id = p.id
     order by p.created_at desc`
  );

  let updatedDescriptionCount = 0;
  let updatedInternalCount = 0;

  for (const row of rows.rows) {
    const originalDescription = String(row.description || "");
    const split = splitSensitiveDescription(originalDescription);
    const nextDescription = split.publicDescription;
    const nextInternal = mergeInternalNotes(row.internal_notes, split.internalDescription);

    if (nextDescription !== originalDescription) {
      await query("update properties set description = $1, updated_at = now() where id = $2", [nextDescription, row.id]);
      updatedDescriptionCount += 1;
    }

    if (nextInternal !== (row.internal_notes || null)) {
      await query(
        `insert into property_private (property_id, internal_notes, updated_at)
         values ($1, $2, now())
         on conflict (property_id) do update set internal_notes = excluded.internal_notes, updated_at = now()`,
        [row.id, nextInternal]
      );
      updatedInternalCount += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`TOTAL=${rows.rows.length} DESC_ATUALIZADA=${updatedDescriptionCount} INTERNA_ATUALIZADA=${updatedInternalCount}`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("ERRO_FIX_DESCRICAO_INTERNA", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
