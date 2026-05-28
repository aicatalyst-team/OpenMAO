import { zodToJsonSchema } from "zod-to-json-schema";

import { schemaDefinitions } from "./models.js";

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected JSON object");
  }

  return value as JsonObject;
}

function extractDefinition(name: string, converted: unknown): JsonObject {
  const root = asJsonObject(converted);
  const definitions = root.definitions ?? root.$defs;

  if (definitions && typeof definitions === "object" && !Array.isArray(definitions)) {
    const definition = (definitions as JsonObject)[name];
    if (definition) {
      return asJsonObject(definition);
    }
  }

  const { $schema: _schema, definitions: _definitions, $defs: _defs, ...definition } = root;
  return definition;
}

export function canonicalSchemaBundle(): JsonObject {
  const defs = Object.fromEntries(
    Object.entries(schemaDefinitions).map(([name, schema]) => {
      const converted = zodToJsonSchema(schema, {
        name,
        $refStrategy: "none",
        target: "jsonSchema7",
      });

      return [name, extractDefinition(name, converted)];
    }),
  );

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "OpenMAO v0 Canonical Contracts",
    description: "Generated JSON Schema bundle for the OpenMAO v0 canonical type system.",
    $defs: defs,
  };
}
