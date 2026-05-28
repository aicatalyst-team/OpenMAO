import { writeFileSync } from "node:fs";

import { canonicalSchemaBundle } from "../ts/src/contracts/index.js";

const schemaPath = new URL("../schemas/canonical/v0.schema.json", import.meta.url);
const schema = `${JSON.stringify(canonicalSchemaBundle(), null, 2)}\n`;

writeFileSync(schemaPath, schema);
