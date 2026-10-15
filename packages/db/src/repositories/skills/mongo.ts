import { randomUUID } from "node:crypto";
import { ensureCollection, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import type { Skill, SkillRepository, TenantSkill } from "./types.js";

// A skill's `_id` is its own id ("workspace", "reminders"), as SQL keys it; a tenant switch's `_id` is a UUID string.
type SkillDoc = Omit<Skill, "id"> & { _id: string };
type TenantSkillDoc = Omit<TenantSkill, "id"> & { _id: string };

export const skillMigrations: MongoMigration[] = [
  {
    id: "0200-skills",
    async up(db) {
      await ensureCollection(db, "skills");
      // The same unique switch per tenant and skill that the tenants step creates; repeating it is a no-op.
      const switches = await ensureCollection(db, "tenant_skills");
      await switches.createIndex({ tenantId: 1, skillId: 1 }, { unique: true, name: "tenant_skills_unique" });
    },
  },
];

/** Skills and tenant skill switches on MongoDB. */
export function createMongoSkillRepository({ db }: MongoConnection): SkillRepository {
  const skills = db.collection<SkillDoc>("skills");
  const switches = db.collection<TenantSkillDoc>("tenant_skills");
  const change = async (tenantId: string, skillId: string, values: Partial<TenantSkillDoc>) => {
    const doc = await switches.findOneAndUpdate({ tenantId, skillId }, { $set: { ...values, updatedAt: new Date() } }, { returnDocument: "after" });
    return doc ? toTenantSkill(doc) : null;
  };
  /** The tenant's switches matching `filter`, each with its skill, by skill id; a switch whose skill is gone is left out. */
  const listings = async (tenantId: string, filter: Partial<TenantSkillDoc> = {}) => {
    const states = await switches.find({ tenantId, ...filter }).toArray();
    const byId = new Map((await skills.find({ _id: { $in: states.map((s) => s.skillId) } }).toArray()).map((doc) => [doc._id, toSkill(doc)]));
    return states.flatMap((state) => {
      const skill = byId.get(state.skillId);
      return skill ? [{ skill, state: toTenantSkill(state) }] : [];
    }).sort((a, b) => (a.skill.id < b.skill.id ? -1 : a.skill.id > b.skill.id ? 1 : 0));
  };

  return {
    async register({ id, name, description, toolDefinitions, defaultEnabled, handlerType, config }) {
      const now = new Date();
      const result = await skills.updateOne(
        { _id: id },
        { $set: { name, description, toolDefinitions, updatedAt: now }, $setOnInsert: { defaultEnabled, handlerType, config, createdAt: now } },
        { upsert: true },
      );
      return result.upsertedCount > 0;
    },
    async list() {
      return (await skills.find().sort({ _id: 1 }).toArray()).map(toSkill);
    },
    async seedTenant(tenantId) {
      for (const skill of await skills.find().toArray()) {
        await switches.updateOne(
          { tenantId, skillId: skill._id },
          { $setOnInsert: { _id: randomUUID(), isEnabled: skill.defaultEnabled, config: skill.config ?? {}, updatedAt: new Date() } },
          { upsert: true },
        );
      }
    },
    listForTenant: (tenantId) => listings(tenantId),
    async listEnabled(tenantId) {
      return (await listings(tenantId, { isEnabled: true })).map((l) => l.skill);
    },
    async getForTenant(tenantId, skillId) {
      const doc = await switches.findOne({ tenantId, skillId });
      return doc ? toTenantSkill(doc) : null;
    },
    setEnabled: (tenantId, skillId, isEnabled) => change(tenantId, skillId, { isEnabled }),
    setConfig: (tenantId, skillId, config) => change(tenantId, skillId, { config }),
    async enable(tenantId, skillId) {
      if (!await skills.findOne({ _id: skillId }, { projection: { _id: 1 } })) return false;
      // The unique switch per tenant and skill turns a second upsert into an update, so two callers never both add one.
      const now = new Date();
      await switches.updateOne({ tenantId, skillId }, { $setOnInsert: { _id: randomUUID(), isEnabled: true, config: {}, updatedAt: now } }, { upsert: true });
      await switches.updateOne({ tenantId, skillId, isEnabled: false }, { $set: { isEnabled: true, updatedAt: now } });
      return true;
    },
  };
}

function toSkill({ _id, ...doc }: SkillDoc): Skill {
  return { id: _id, name: doc.name, description: doc.description, defaultEnabled: doc.defaultEnabled, toolDefinitions: doc.toolDefinitions ?? [], handlerType: doc.handlerType, config: doc.config ?? {}, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
}

function toTenantSkill({ _id, ...doc }: TenantSkillDoc): TenantSkill {
  return { id: _id, tenantId: doc.tenantId, skillId: doc.skillId, isEnabled: doc.isEnabled, config: doc.config ?? {}, updatedAt: doc.updatedAt };
}
