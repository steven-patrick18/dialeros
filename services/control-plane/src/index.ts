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
export {
  appendAudit,
  queryAudit,
  queryAuditFiltered,
  queryAuditTargetTypes,
} from './audit';
export type { AuditAppendInput, AuditQueryFilter } from './audit';

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
  listActiveCalls,
  liveCampaignSnapshot,
  liveAgentSnapshot,
} from './db';
export type {
  AgentIntentRecord,
  ActiveCallRecord,
  CampaignLiveRow,
  AgentLiveRow,
} from './db';

// Lead disposition (iter 18)
export {
  countDispositionsTodayForUser,
} from './db';

// Agent scoreboard (iter 98)
export { agentTodayScoreboard } from './db';
// iter 129 — supervisors browse audit + intent activity per user
// from /users/[id]; expose listAuditEventsFiltered so the page
// can pull this user's audit trail without a new helper.
// AuditEventRecord is re-exported once near the top of this file.
export { listAuditEventsFiltered } from './db';
export type { AgentTodayScoreboard } from './db';

// Campaign disposition mix (iter 99)
export { campaignDispositionMix } from './db';
export type { CampaignDispositionRow } from './db';

// AMD breakdown (iter 122)
export { amdBreakdownForCampaignToday } from './db';
export type { AmdBreakdownRow } from './db';

// Pause-reason analytics (iter 130)
export { pauseReasonAnalytics } from './db';
export type { PauseReasonRow } from './db';

// Daily summary report (iter 131)
export { buildDailySummary } from './reports';
export type { DailySummary } from './reports';

// CSV exports (iter 126)
export {
  listCampaignCallHistoryForExport,
  listFloorCallHistory,
  getCallDetail,
  clearRecordingPathsForFiles,
  applyAutoDisposition,
  listAutoDispositionCandidates,
  getCampaignAbandonRate,
  getCampaignFromDb,
  listLeadsInList,
} from './db';
export type { CampaignCallHistoryRow } from './db';
export type {
  FloorCallHistoryRow,
  FloorCallHistoryFilters,
  CallDetailRow,
} from './db';

// Floor disposition mix (iter 103)
export { floorDispositionMixToday } from './db';
export { floorDispositionMixSince } from './db';

// Callback queue (iter 104)
export { listScheduledCallbacks } from './db';
export type { ScheduledCallbackRow } from './db';

// Inbound whitelist lookup (iter 107)
export {
  findInboundReturnMatch,
  INBOUND_WHITELIST_STATUSES,
} from './db';
export type { InboundReturnMatch } from './db';

// Agent leaderboard (iter 100)
export { agentLeaderboardToday } from './db';
export type { AgentLeaderboardRow } from './db';
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
  setRecordingRetentionDays,
  getRecordingRetentionEnabled,
  setRecordingRetentionEnabled,
  // Iter 134 — pacing-recommendation curve
  PACING_THRESHOLDS_DEFAULT,
  getPacingThresholds,
  setPacingThresholds,
  clearPacingThresholds,
} from './app-settings';
export type { PacingThresholdStep } from './app-settings';

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
  provisionUserForRemoteAgent,
  unlinkRemoteAgentUser,
  getRemoteAgentUser,
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
  PlanCarrierRowSchema,
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
  parseCidGroupIds,
  listCarriersForRoutePlan,
  setRoutePlanCarriers,
} from './route-plan';
export type { PlanCarrierRow } from './route-plan';
export {
  inFlightForCarrier,
  inFlightForCampaign,
  countRoutePlansPerCarrier,
  reapStaleDialIntents,
  campaignThroughput,
  carrierLiveSnapshot,
  cidUsageForGroup,
  floorThroughputSnapshot,
  topCampaignsToday,
} from './db';
export type {
  CampaignThroughputSnapshot,
  CarrierLiveRow,
  CidUsageRow,
  FloorThroughputSnapshot,
  CampaignTodayRow,
} from './db';
export type { RoutePlanCarrierRecord } from './db';

// CID groups (iter 72)
export {
  CidGroupStrategySchema,
  CID_GROUP_STRATEGY_HINTS,
  CidGroupInputSchema,
  CidGroupUpdateInputSchema,
  createCidGroup,
  listCidGroups,
  getCidGroup,
  updateCidGroup,
  deleteCidGroup,
  listCidsInGroup,
  countCidsInGroup,
  addCidsToGroup,
  removeCidFromGroup,
  parseCidNumberBlob,
} from './cid-group';
export { listRoutePlansUsingCidGroup } from './db';
export type {
  CidGroupStrategy,
  CidGroupInput,
  CidGroupUpdateInput,
  AddCidsResult,
  CreateCidGroupResult,
  CidGroupRecord,
  CidGroupNumberRecord,
} from './cid-group';
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
  leadCauseBreakdown,
  leadTimezoneBreakdown,
  pageLeads,
  pageLeadsFiltered,
  ingestCsv,
  moveLeadList,
  leadListsForCampaign,
  setLeadListsForCampaign,
  normalizePhone,
  getLead,
  updateLead,
  deleteLead,
  leadCallHistory,
  LeadUpdateInputSchema,
  findOrCreateLeadForManualDial,
} from './lead';
export type { LeadCallHistoryRow, LeadUpdateInput } from './lead';
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
  cloneCampaign,
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
export { parseDialableStatuses, bulkResetLeadsInList } from './db';
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
  isUserRegistered,
  emitIntentUpdate,
} from './pacing';
export { insertDialIntent, getDialIntentByCorrelationId } from './db';
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
// Iter 119 — hard-phone REGISTER via FS mod_xml_curl. The
// directory endpoint queries by extension to build the FS
// directory XML response on demand.
export { getPhoneByExtension } from './db';
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

// DNC list (iter 64; iter 106 added lookupDnc)
export {
  DncInputSchema,
  addDnc,
  bulkAddDnc,
  removeDnc,
  isDnc,
  listDnc,
  countDnc,
  lookupDnc,
} from './dnc';
export type { DncInput, DncPhoneRecord } from './dnc';

// Hopper (iter 49 — pre-load queue per campaign)
export {
  hopperSize,
  refillHopper,
  popHopperLead,
  clearHopper,
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

// Iter 114-117 — inbound routing primitives. findDidOwner +
// pickAvailableAgentForInGroup feed the /api/internal/inbound-route
// hook that Kamailio queries on every inbound INVITE.
// listRecentInboundDecisions powers the supervisor audit card.
// enqueue/dispatch/expire + listActiveQueuedCalls drive the iter
// 116 hold-queue state machine. pickAvailableAgentsForInGroup
// (plural, iter 117) returns N targets for true ring_all forking.
export {
  findDidOwner,
  pickAvailableAgentForInGroup,
  pickAvailableAgentsForInGroup,
  listRecentInboundDecisions,
  enqueueInboundCall,
  getQueuedCallByCallId,
  dispatchQueuedCall,
  expireQueuedCall,
  expireStaleQueuedCalls,
  listActiveQueuedCalls,
} from './db';
export type {
  InGroupAgentPick,
  InboundDecisionRow,
  InboundQueueRow,
  SupervisorQueueRow,
} from './db';

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

// Predictive pacing data layer (iter 132)
export {
  answerRateByHourWeekday,
  answerRateForCurrentBucket,
  recommendDialLevel,
} from './db';
export type { AnswerRateBucket, AnswerRateSummary } from './db';

// AI pipeline (iter 135)
export { listAiPendingIntents, applyAiResult } from './db';
export type { AiPendingIntent } from './db';

// Transcript search (iter 138 — FTS5)
export { searchTranscripts } from './db';
export type { TranscriptHit } from './db';

// Iter 140 — per-campaign VM tuning
export {
  getVoicemailConfig,
  VOICEMAIL_CONFIG_DEFAULTS,
  VoicemailConfigSchema,
} from './campaign';
export type { VoicemailConfig } from './campaign';

// Iter 146 — auto-disposition
export { inferAutoDisposition } from './auto-disposition';
export type {
  AutoDispoIntent,
  AutoDispoCampaign,
} from './auto-disposition';
export type { AutoDispositionCandidate } from './db';

// Iter 149 — Call Menu (IVR)
export {
  createCallMenu,
  listCallMenus,
  getCallMenu,
  getCallMenuOptions,
  updateCallMenu,
  deleteCallMenu,
  CallMenuInputSchema,
  CallMenuOptionInputSchema,
  CallMenuActionTypeSchema,
} from './call-menu';
export type {
  CallMenuInput,
  CallMenuOptionInput,
  CallMenuActionType,
} from './call-menu';
export type {
  CallMenuRecord,
  CallMenuOptionRecord,
} from './db';

// Iter 150 — Sound Board
export {
  AudioCategorySchema,
  AudioSourceSchema,
  AudioFileMetaSchema,
  AUDIO_LIBRARY_ROOT,
  audioFilePath,
  newAudioFileId,
  registerAudioFile,
  listAudioFiles,
  getAudioFile,
  deleteAudioFile,
} from './audio-library';
export type {
  AudioCategory,
  AudioSource,
  AudioFileMeta,
} from './audio-library';
export type { AudioFileRecord } from './db';

// Iter 152 — Call Menu dialplan generator + deploy
export {
  buildCallMenuDialplanXml,
  callMenuDialplanPath,
} from './call-menu-dialplan';
export type { DialplanInputs } from './call-menu-dialplan';
export {
  deployCallMenuDialplan,
  removeCallMenuDialplan,
} from './call-menu-deploy';

// Iter 153 — DTMF press log
export { insertCallMenuLog } from './db';

// Iter 155 — per-call-menu analytics
export { getCallMenuStats } from './db';
export type { CallMenuStatsRow } from './db';

// Iter 157 — Per-campaign short survey
export {
  SurveyInputSchema,
  SurveyQuestionInputSchema,
  SurveyQuestionTypeSchema,
  saveCampaignSurvey,
  getCampaignSurvey,
  deleteCampaignSurvey,
  parseSurveyOptions,
} from './survey';
export type {
  SurveyInput,
  SurveyQuestionInput,
  SurveyQuestionType,
  SurveyWithQuestions,
} from './survey';
export type {
  SurveyRecord,
  SurveyQuestionRecord,
  SurveyAnswerRecord,
} from './db';
export {
  insertSurveyAnswers,
  listSurveyAnswersForIntent,
} from './db';

// Iter 159 — Survey reporting
export {
  getSurveyResponseStats,
  listSurveyResponsesForExport,
} from './db';
export type {
  SurveyResponseStatsRow,
  SurveyResponseExportRow,
} from './db';

// Iter 163 — Wrap-up enforcement
export {
  getWrapupEnforcementEnabled,
  setWrapupEnforcementEnabled,
} from './app-settings';

// Iter 165 — TCPA compliance reporting
export {
  getRollingTcpaMetrics,
  getDailyDialMetrics,
  getPerCampaignTcpaMetrics,
  getTcpaAuditActivity,
} from './db';
export type {
  TcpaWindowMetrics,
  TcpaDailyRow,
  TcpaCampaignRow,
  TcpaDncActivity,
} from './db';

// Iter 166 — Per-lead frequency cap
export {
  FREQ_CAP_DEFAULT_COUNT,
  FREQ_CAP_DEFAULT_WINDOW_HOURS,
  getFreqCapEnabled,
  setFreqCapEnabled,
  getFreqCapLeadCount,
  setFreqCapLeadCount,
  getFreqCapLeadWindowHours,
  setFreqCapLeadWindowHours,
} from './app-settings';
export { countRecentDialsForPhone } from './db';

// Iter 167 — Per-CID frequency cap + recording notice
export {
  FREQ_CAP_CID_DEFAULT_COUNT,
  FREQ_CAP_CID_DEFAULT_WINDOW_HOURS,
  getFreqCapCidCount,
  setFreqCapCidCount,
  getFreqCapCidWindowHours,
  setFreqCapCidWindowHours,
} from './app-settings';
export { countRecentDialsForCid } from './db';

// Iter 168 — Consent records
export {
  ConsentTypeSchema,
  ConsentSourceSchema,
  ConsentRecordInputSchema,
  ConsentRevokeInputSchema,
  createConsentRecord,
  listConsentRecords,
  getConsentRecord,
  revokeConsentRecord,
  deleteConsentRecord,
  hasActiveConsent,
} from './consent';
export type {
  ConsentType,
  ConsentSource,
  ConsentRecordInput,
  ConsentRevokeInput,
} from './consent';
export type { ConsentRecord } from './db';

// Iter 169 — SMTP relay config
export {
  getSmtpConfig,
  setSmtpConfig,
  renderMsmtprc,
  MSMTPRC_PATH,
} from './app-settings';
export type { SmtpConfig } from './app-settings';

// Iter 170 — Backup verification
export {
  listBackupVerifications,
  getLatestBackupVerification,
} from './db';
export type { BackupVerificationRecord } from './db';

// Iter 172 — FS event listener state
export { getFsEventListenerState } from './fs-events';

// Iter 173 — Agent productivity
export {
  getAgentProductivity,
  listAgentProductivity,
} from './db';
export type { AgentProductivityRow } from './db';

// Iter 174 — Per-campaign disposition palette
export {
  CampaignDispositionInputSchema,
  CampaignDispositionPaletteSchema,
  LEAD_STATUS_TARGETS,
  LeadStatusTargetSchema,
  saveCampaignDispositionPalette,
  getCampaignDispositionPalette,
  hasCustomDispositionPalette,
  resolvePaletteLeadStatus,
} from './campaign-disposition';
export type {
  CampaignDispositionInput,
  CampaignDispositionPalette,
  LeadStatusTarget,
} from './campaign-disposition';
export type { CampaignDispositionRecord } from './db';

// Iter 175 — Skill-based routing
export {
  SkillCodeSchema,
  UserSkillsInputSchema,
  CampaignSkillsInputSchema,
  saveUserSkills,
  getUserSkills,
  saveCampaignRequiredSkills,
  getCampaignRequiredSkills,
  listAllSkillsInUse,
} from './skills';
export type {
  UserSkillsInput,
  CampaignSkillsInput,
} from './skills';
export type { UserSkillRecord, CampaignSkillRecord } from './db';

// Iter 176 — QA flag
export {
  setDialIntentQaFlag,
  clearDialIntentQaFlag,
  listFlaggedCalls,
} from './db';
export type { FlaggedCallRow } from './db';

// Iter 177 — Queue position announce
export {
  getQueueAnnounceEnabled,
  setQueueAnnounceEnabled,
} from './app-settings';
export { getInboundQueuePosition } from './db';
export type { InboundQueuePosition } from './db';
