import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Database } from "../persistence/index.js";

export function defaultDatabasePath(): string {
  return resolve(process.env.OPENMAO_DB ?? ".openmao/openmao.sqlite3");
}

export function openLocalDatabase(path = defaultDatabasePath()): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const database = new Database(path);
  database.initialize();
  return database;
}
