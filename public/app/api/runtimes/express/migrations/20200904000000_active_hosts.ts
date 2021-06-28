import * as Knex from "knex";
export const up = async (knex: Knex) => {
  await knex.schema.createTable("active_hosts", (t) => {
    t.engine("MEMORY");
    t.string("hostAddr", 191).primary();
    t.dateTime("createdAt").defaultTo(knex.fn.now());
    t.dateTime("activeAt").defaultTo(knex.fn.now());
  });
};

export const down = async (knex: Knex) => {
  await knex.schema.dropTable("active_hosts");
};
