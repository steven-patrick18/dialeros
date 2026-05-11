// Schemas + node types
export {
  NodeInputSchema,
  NodeRoleSchema,
  NodeRolesSchema,
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
  updateNodeRoles,
  listNodesFromDb,
  getNodeFromDb,
  parseNodeRoles,
  nodeHasRole,
  findNodeByHost,
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
export { ensureLocalNodeRegistered } from './local-node';
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

// Permissions / ACL (iter 43)
export {
  PERMISSION_CATALOG,
  ALL_PERMISSION_SLUGS,
  defaultPermissionsForRole,
  effectivePermissions,
  parsePermissions,
  serializePermissions,
  userHasPermission,
} from './permissions';
export type { PermissionSlug } from './permissions';

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
  latestUndisposedIntentForUser,
  getDialIntentById,
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

// App settings (iter 28: encrypted key/value)
export {
  setAppSetting,
  getAppSetting,
  hasAppSetting,
  clearAppSetting,
  APP_SETTING_KEYS,
  RECORDING_RETENTION_DEFAULT_DAYS,
  getRecordingRetentionDays,
} from './app-settings';

// Recording retention (iter 56)
export {
  ensureRecordingRetentionSweep,
  sweepOnce as sweepRecordingsOnce,
} from './recording-retention';

// Remote agents (iter 57 — external SIP endpoints in the pacing pool)
export {
  RemoteAgentInputSchema,
  RemoteAgentUpdateInputSchema,
  createRemoteAgent,
  updateRemoteAgent,
  listRemoteAgents,
  getRemoteAgent,
  deleteRemoteAgent,
  remoteLineCapacity,
  listRemoteAgentsWithCapacity,
} from './remote-agent';
export { inFlightForRemoteAgent } from './db';
export type {
  RemoteAgentInput,
  RemoteAgentUpdateInput,
  RemoteAgentRecord,
  CreateRemoteAgentResult,
} from './remote-agent';

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
  parseDialPrefixes,
  carrierAcceptsDestination,
  parseDialPlanRules,
  findMatchingDialPlanRule,
  applyDialPlanRule,
  applyDialPlanRules,
  DialPlanRuleSchema,
} from './carrier';
export type { DialPlanRule } from './carrier';
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
  LeadListUpdateInputSchema,
  createLeadList,
  listLeadLists,
  getLeadList,
  updateLeadList,
  deleteLeadList,
  leadCountFor,
  leadBreakdown,
  leadTimezoneBreakdown,
  pageLeads,
  ingestCsv,
  moveLeadList,
  leadListsForCampaign,
  setLeadListsForCampaign,
  normalizePhone,
} from './lead';
export {
  inferLeadTimezone,
  hourInTimezone,
  localTimeInTimezone,
} from './timezones';
export type {
  LeadListInput,
  LeadListUpdateInput,
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
  DialModeSchema,
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
  rotateDialPlanCursor,
} from './pacing';
export type { PacingTickResult, DialIntentRecord } from './pacing';

// SIP extensions (iter 39 — shared user→extension derivation)
export { extensionForUser } from './sip-extensions';

// Phones (iter 40 — per-user SIP credentials)
export {
  PhoneInputSchema,
  PhoneUpdateInputSchema,
  createPhone,
  updatePhone,
  removePhone,
  listPhones,
  getPhone,
  getPrimaryPhone,
} from './phone';
export type {
  PhoneInput,
  PhoneUpdateInput,
  PhoneRecord,
  CreatePhoneResult,
} from './phone';

// Agent status (iter 40 — pause / resume)
export {
  getStatus as getAgentStatus,
  pauseAgent,
  resumeAgent,
} from './agent-status';
export type { AgentStatusValue, AgentStatusRecord } from './agent-status';

// Pacer-helper that filters out paused agents (iter 40)
export { getAvailableAgentsForCampaign } from './db';

// DNC list (iter 64)
export {
  DncInputSchema,
  addDnc,
  bulkAddDnc,
  removeDnc,
  isDnc,
  listDnc,
  countDnc,
} from './dnc';
export type { DncInput, DncPhoneRecord } from './dnc';

// Hopper (iter 49 — pre-load queue per campaign)
export {
  hopperSize,
  refillHopper,
  popHopperLead,
} from './db';

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
