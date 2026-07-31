# Foundation pilot generator v1

Create exactly one private Dime Foundation authoring record from the supplied
scenario specification and immutable source context.

Requirements:

- Preserve the preassigned route, scenario identity, shard, and split.
- Use only the supplied source context.
- Do not introduce current sports facts, odds, injuries, scores, identities,
  credentials, private user data, or unsupported numeric claims.
- For changing facts, require authoritative retrieval, validation, and
  abstention when evidence is unavailable.
- Keep reasoning private; emit only the reviewable record fields.
- The generator must not critique, approve, or adjudicate its own record.
