import * as Knex from "knex";
export const up = async (knex: Knex) => {
  await knex.schema.createTable("ips", (t) => {
    t.string("ip", 45);
    t.string("orgId", 36);
    t.bigInteger("createdAt").notNullable();
    t.bigInteger("lastRequestAt").notNullable();
    t.index(["orgId", "createdAt", "lastRequestAt"]);

    t.primary(["ip", "orgId"]);
  });
};

export const down = async (knex: Knex) => {
  await knex.schema.dropTable("ips");
};
