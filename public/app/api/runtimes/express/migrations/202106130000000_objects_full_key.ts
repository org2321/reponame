import * as Knex from "knex";
import { pool } from "../../../shared/src/db";

export const up = async (knex: Knex) => {
  await knex.schema.alterTable("objects", (t) => {
    t.string("fullKey", 382).notNullable().index();
  });

  console.log("Added fullKey column. Now adding fullKey to existing rows...");

  await pool.query(`UPDATE objects SET fullKey = CONCAT_WS("|",pkey, skey);`);
};

export const down = async (knex: Knex) => {
  await knex.schema.alterTable("objects", (t) => {
    t.dropColumn("fullKey");
  });
};
