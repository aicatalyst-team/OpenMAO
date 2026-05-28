import SqliteDatabase from "better-sqlite3";

import { initializeSchema } from "./schema.js";

export class Database {
  readonly connection: SqliteDatabase.Database;
  readonly path: string;

  constructor(path = ":memory:") {
    this.path = path;
    this.connection = new SqliteDatabase(path);
    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("busy_timeout = 5000");
    if (path !== ":memory:") {
      this.connection.pragma("journal_mode = WAL");
    }
  }

  initialize(): void {
    initializeSchema(this.connection);
  }

  transaction<T>(body: () => T): T {
    if (this.connection.inTransaction) {
      return body();
    }

    return this.connection.transaction(body)();
  }

  close(): void {
    this.connection.close();
  }
}
