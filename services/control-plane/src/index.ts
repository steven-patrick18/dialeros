// Schemas + node types
export {
  NodeInputSchema,
  NodeRoleSchema,
  NodeStatusSchema,
} from './schema';
export type {
  NodeInput,
  NodeRole,
  NodeStatus,
  NodeRecord,
} from './schema';

// Provisioning
export { provisionNode } from './provisioner';
export type {
  ProvisionResult,
  ProvisionContext,
} from './provisioner';

// DB
export {
  insertNode,
  updateNodeStatus,
  listNodesFromDb,
  getNodeFromDb,
  appendProvisioningLog,
  getProvisioningLogs,
  countUsers,
  insertUser,
  getUserByUsername,
  getUserById,
  insertSession,
  getSessionById,
  deleteSession,
  deleteExpiredSessions,
  insertAuditEvent,
  listAuditEvents,
} from './db';
export type {
  ProvisioningLogRecord,
  UserRecord,
  SessionRecord,
  AuditEventRecord,
} from './db';

// Auth
export {
  RoleSchema,
  SetupInputSchema,
  LoginInputSchema,
  isSetupComplete,
  userCount,
  createFirstAdmin,
  login,
  logout,
  getUserBySession,
} from './auth';
export type {
  Role,
  SetupInput,
  LoginInput,
  LoginResult,
} from './auth';

// Audit
export { appendAudit, queryAudit } from './audit';
export type { AuditAppendInput } from './audit';

// Secrets (envelope encryption)
export { encryptSecret, decryptSecret } from './secrets';

// Carriers
export {
  CarrierTransportSchema,
  CarrierAuthModeSchema,
  CodecSchema,
  CarrierInputSchema,
  CarrierUpdateInputSchema,
  createCarrier,
  listCarriers,
  getCarrier,
  deleteCarrier,
  updateCarrier,
  parseCodecs,
} from './carrier';
export type {
  CarrierTransport,
  CarrierAuthMode,
  Codec,
  CarrierInput,
  CarrierUpdateInput,
  CarrierRecord,
  CreateCarrierResult,
} from './carrier';

// Route plans
export {
  CidStrategySchema,
  RoutePlanInputSchema,
  createRoutePlan,
  listRoutePlans,
  getRoutePlan,
  deleteRoutePlan,
  getRoutePlansForCarrier,
  parseFailoverIds,
  parseCidPool,
} from './route-plan';
export type {
  CidStrategy,
  RoutePlanInput,
  RoutePlanRecord,
  CreateRoutePlanResult,
} from './route-plan';

// Lead lists + leads
export {
  LeadListInputSchema,
  createLeadList,
  listLeadLists,
  getLeadList,
  deleteLeadList,
  leadCountFor,
  leadBreakdown,
  pageLeads,
  ingestCsv,
  normalizePhone,
} from './lead';
export type {
  LeadListInput,
  CreateLeadListResult,
  CsvIngestResult,
  LeadListRecord,
  LeadRecord,
  LeadStatusBreakdown,
} from './lead';

// Event bus
export {
  emitProvisioningEvent,
  subscribeToNode,
} from './event-bus';
export type { ProvisioningEvent, ProvisioningLevel } from './event-bus';

// Runner
export { getRunner } from './runner';
export type {
  AnsibleRunner,
  AnsibleRunnerInput,
  AnsibleRunnerResult,
} from './runner';
