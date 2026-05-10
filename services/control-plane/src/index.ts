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
  getActiveAgentsForCampaign,
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

// Reports / aggregate queries (iter 15)
export {
  dialIntentsByHour,
  totalDialIntents,
  globalLeadStatusBreakdown,
  topCampaignsByIntents,
  auditCountsByAction,
  loginActivityRollup,
} from './db';

// Agent console (iter 17)
export {
  listDialIntentsForUser,
  countDialIntentsForUser,
} from './db';
export type { AgentIntentRecord } from './db';

// Lead disposition (iter 18)
export {
  countDispositionsTodayForUser,
} from './db';
export {
  DispositionSchema,
  DisposeInputSchema,
  disposeAgentIntent,
} from './disposition';
export type { Disposition, DisposeInput, DisposeResult } from './disposition';

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
  RoutePlanUpdateInputSchema,
  createRoutePlan,
  listRoutePlans,
  getRoutePlan,
  deleteRoutePlan,
  updateRoutePlan,
  getRoutePlansForCarrier,
  parseFailoverIds,
  parseCidPool,
} from './route-plan';
export type {
  CidStrategy,
  RoutePlanInput,
  RoutePlanUpdateInput,
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
  CampaignUpdateInputSchema,
  createCampaign,
  listCampaigns,
  getCampaign,
  getCampaignLeadLists,
  getCampaignInGroups,
  setCampaignInGroupAttachment,
  deleteCampaign,
  updateCampaign,
  setCampaignStatus,
  getCampaignsForRoutePlan,
  getCampaignsForLeadList,
} from './campaign';
export {
  listCampaignsUsingInGroup,
  getInGroupsForAgent,
} from './db';
export type {
  CampaignType,
  CampaignStatus,
  CampaignInput,
  CampaignUpdateInput,
  CreateCampaignResult,
  CampaignRecord,
} from './campaign';

// Pacing engine (iter 11 — simulation, no real telephony yet)
export {
  paceCampaignOnce,
  startPacer,
  stopPacer,
  isPacing,
  isCampaignWithinCallWindow,
  listPacingCampaignIds,
  subscribeToIntents,
  subscribeToAllIntents,
  resumeActivePacers,
  listIntentsForCampaign,
  totalIntentsFor,
} from './pacing';
export type { PacingTickResult, DialIntentRecord } from './pacing';

// DIDs (iter 22) — standalone management
export {
  SingleDidInputSchema,
  BulkDidInputSchema,
  DidNumberSchema,
  parseDidBlob,
  addDid,
  bulkAddDids,
  cloneDidSettings,
  moveDid,
  removeDid,
  listAllDids,
  getDidWithOwner,
} from './did';
export type {
  SingleDidInput,
  BulkDidInput,
  BulkDidResult,
  DidWithOwner,
} from './did';

// In-Groups
export {
  InGroupTypeSchema,
  WhitelistModeSchema,
  RoutingStrategySchema,
  OffListActionSchema,
  InGroupInputSchema,
  InGroupUpdateInputSchema,
  DidInputSchema,
  createInGroup,
  listInGroups,
  getInGroup,
  deleteInGroup,
  updateInGroup,
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
  InGroupUpdateInput,
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
