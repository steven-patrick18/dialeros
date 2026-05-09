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
  SetupInput,
  LoginInput,
  LoginResult,
} from './auth';

// User management (admin-managed users; iter 12)
export {
  RoleSchema,
  SkillTierSchema,
  CreateUserInputSchema,
  UpdateUserInputSchema,
  createUser,
  updateUser,
  deactivate as deactivateUser,
  reactivate as reactivateUser,
  listUsers,
  getUser,
} from './user-mgmt';

// User attachments (iter 13: user ↔ campaigns / in-groups)
export {
  getUserCampaignIds,
  getUserInGroupIds,
  getCampaignAllowedUserIds,
  getInGroupAllowedUserIds,
  setUserCampaigns,
  setUserInGroups,
} from './db';
export type {
  Role,
  SkillTier,
  CreateUserInput,
  UpdateUserInput,
  CreateUserResult,
  UpdateUserResult,
} from './user-mgmt';

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

// Campaigns
export {
  CampaignTypeSchema,
  CampaignStatusSchema,
  CampaignInputSchema,
  createCampaign,
  listCampaigns,
  getCampaign,
  getCampaignLeadLists,
  deleteCampaign,
  setCampaignStatus,
  getCampaignsForRoutePlan,
  getCampaignsForLeadList,
} from './campaign';
export type {
  CampaignType,
  CampaignStatus,
  CampaignInput,
  CreateCampaignResult,
  CampaignRecord,
} from './campaign';

// Pacing engine (iter 11 — simulation, no real telephony yet)
export {
  paceCampaignOnce,
  startPacer,
  stopPacer,
  isPacing,
  listPacingCampaignIds,
  subscribeToIntents,
  resumeActivePacers,
  listIntentsForCampaign,
  totalIntentsFor,
} from './pacing';
export type { PacingTickResult, DialIntentRecord } from './pacing';

// In-Groups
export {
  InGroupTypeSchema,
  WhitelistModeSchema,
  RoutingStrategySchema,
  OffListActionSchema,
  InGroupInputSchema,
  DidInputSchema,
  createInGroup,
  listInGroups,
  getInGroup,
  deleteInGroup,
  getInGroupDids,
  parseStaticWhitelist,
  addDidToInGroup,
  removeDidFromInGroup,
} from './in-group';
export type {
  InGroupType,
  WhitelistMode,
  RoutingStrategy,
  OffListAction,
  InGroupInput,
  DidInput,
  CreateInGroupResult,
  AddDidResult,
  InGroupRecord,
} from './in-group';

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
