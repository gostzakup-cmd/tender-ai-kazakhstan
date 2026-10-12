/** Pure offline gate. Registry must come from a separately reviewed source adapter,
 * never Sheets/K-column/user JSON. No production adapter is approved by this PR. */
function assessTenderNationalEvidence(lot, proof, policy, nowIso) {
  const hold = function (reason) { return {decision: 'HOLD_NATIONAL', allowedResearch: false, reason: reason}; };
  const time = function (value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? Date.parse(value) : NaN; };
  const id = function (value) { return typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number(value) <= 2147483647; };
  const now = time(nowIso);
  if (!lot || !Number.isFinite(now) || !policy || policy.approved !== true ||
      !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || !Array.isArray(policy.sources)) return hold('POLICY_UNVERIFIED');
  if (!proof || proof.kind !== 'OFFICIAL_PER_LOT' || !['YES','NO'].includes(proof.restriction)) return hold('PROOF_MISSING');
  if (!id(lot.id) || !id(lot.announcementId) || !/^[a-f0-9]{64}$/.test(lot.revisionHash || '') ||
      !['lotNumber','announcementNumber','statusCode'].every(function (key) { return typeof lot[key] === 'string' && !!lot[key]; }) ||
      !Number.isInteger(lot.plannedMethodId) || lot.plannedMethodId < 1 || !Number.isInteger(lot.actualMethodId) || lot.actualMethodId < 1) return hold('LOT_IDENTITY_INVALID');
  const sameContext = function (a,b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };
  const source = policy.sources.find(function (s) {
    return s && s.approved === true && s.adapterId === proof.adapterId &&
      Array.isArray(s.artifacts) && s.artifacts.some(function (a) {
        return a && a.url === proof.url && a.sha256 === proof.sha256 && a.version === proof.version &&
          a.restriction === proof.restriction && a.observedAt === proof.observedAt &&
          sameContext(a.context,proof.context) &&
          a.allPlanRowsVerified === true && a.methodAndExceptionsVerified === true;
      });
  });
  if (!source || !/^https:\/\//.test(proof.url || '') || !/^[a-f0-9]{64}$/.test(proof.sha256 || '') ||
      typeof proof.version !== 'string' || !proof.version) return hold('SOURCE_NOT_APPROVED');
  const observed = time(proof.observedAt), verified = time(lot.verifiedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(verified) || observed > now || verified > now ||
      now - observed > policy.maxAgeMs || now - verified > policy.maxAgeMs) return hold('STALE_OR_UNKNOWN_TIME');
  const keys = ['id','lotNumber','announcementId','announcementNumber','statusCode',
    'plannedMethodId','actualMethodId','revisionHash','amountKzt','quantity',
    'applicationStart','deadline','isGoods','planCoverageVerified','active'];
  if (!proof.context || keys.some(function (key) {
    return lot[key] === undefined || lot[key] === null || lot[key] === '' || proof.context[key] !== lot[key];
  })) return hold('CONTEXT_MISMATCH');
  if (lot.unit !== undefined && proof.context.unit !== lot.unit) return hold('UNIT_CONTEXT_MISMATCH');
  if (!Array.isArray(lot.planIds) || !lot.planIds.length || !Array.isArray(proof.context.planIds) ||
      !lot.planIds.every(id) || new Set(lot.planIds).size !== lot.planIds.length ||
      JSON.stringify(lot.planIds.slice().sort()) !== JSON.stringify(proof.context.planIds.slice().sort()) ||
      proof.allPlanRowsVerified !== true || proof.methodAndExceptionsVerified !== true) return hold('SCOPE_UNVERIFIED');
  if (proof.restriction === 'YES') return {decision: 'SKIP', allowedResearch: false, reason: 'VERIFIED_RESTRICTION'};
  if (lot.isGoods !== true || lot.planCoverageVerified !== true || lot.active !== true ||
      typeof lot.amountKzt !== 'number' || !Number.isFinite(lot.amountKzt) || lot.amountKzt < 0 || lot.amountKzt > 10000000 ||
      !Number.isFinite(lot.quantity) || lot.quantity <= 0 ||
      !Number.isFinite(time(lot.applicationStart)) || !Number.isFinite(time(lot.deadline)) ||
      time(lot.applicationStart) > now || time(lot.deadline) <= now) return hold('LOT_NOT_ELIGIBLE');
  return {decision: 'PASS_TO_TS', allowedResearch: true, reason: 'VERIFIED_CURRENT_ABSENCE'};
}
